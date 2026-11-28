import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';
import { serveAdmin } from './admin/admin.static';
import { normalizeOrigin } from './auth/guards/login-origin.guard';
import { assetRoot } from './common/runtime-paths';
import { hardenApp } from './common/security-headers';
import { serveUploads } from './uploads/uploads.static';

/**
 * Applies production security hardening, static asset handlers, admin SPA
 * routing, and normalized CORS origins to the Nest Express app.
 */
export function configureApp(
  app: NestExpressApplication,
  config: ConfigService,
): { isProduction: boolean } {
  const isProduction = config.get<string>('NODE_ENV') === 'production';

  // Trusts exactly the configured number of proxy hops so the login limiter
  // sees the real client IP instead of the proxy's.
  hardenApp(app, {
    isProduction,
    trustProxy: config.get<number | boolean>('TRUST_PROXY') ?? 0,
  });

  // The frontend is unchanged; it is served as-is from public/.
  app.useStaticAssets(join(assetRoot(__dirname), 'public'), { index: 'index.html' });

  // The admin dashboard shares the API origin in production: /admin.
  serveAdmin(app);

  // Uploaded product/service images, served read-only from uploads/.
  serveUploads(app);

  // Normalize origins consistently with LoginOriginGuard so trailing slashes or
  // mixed-case hostnames never silently fail CORS.
  const allowedOrigins = (config.get<string>('ADMIN_FRONTEND_ORIGIN') ?? '')
    .split(',')
    .map(normalizeOrigin)
    .filter((origin): origin is string => origin !== null);

  if (allowedOrigins.length > 0) {
    app.enableCors({
      origin: allowedOrigins,
      credentials: true,
      methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
      maxAge: 600,
    });
  } else if (isProduction) {
    new Logger('Bootstrap').warn(
      'No valid ADMIN_FRONTEND_ORIGIN configured; credentialed CORS is disabled.',
    );
  }

  return { isProduction };
}
