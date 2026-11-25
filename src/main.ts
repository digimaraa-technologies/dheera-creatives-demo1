import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { join } from 'node:path';
import { serveAdmin } from './admin/admin.static';
import { AppModule } from './app.module';
import { assetRoot } from './common/runtime-paths';
import { hardenApp } from './common/security-headers';
import { serveUploads } from './uploads/uploads.static';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  const isProduction = config.get<string>('NODE_ENV') === 'production';
  if (!isProduction) {
    new Logger('Bootstrap').warn(
      'NODE_ENV is not "production": Secure cookies and HSTS are disabled.',
    );
  }

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

  // The admin dashboard may also be served from another origin in development;
  // only configured origins may call the API with cookies. No wildcard is
  // possible when credentials are enabled.
  const allowedOrigins = (config.get<string>('ADMIN_FRONTEND_ORIGIN') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (allowedOrigins.length > 0) {
    app.enableCors({
      origin: allowedOrigins,
      credentials: true,
      methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
      maxAge: 600,
    });
  }

  const port = Number(config.get('PORT')) || 3000;
  // Explicit host so the app does not silently listen on every interface in
  // production. Development defaults to 0.0.0.0 (see env.validation.ts).
  const host = config.get<string>('BIND_HOST') ?? '0.0.0.0';
  if (isProduction && (host === '0.0.0.0' || host === '::')) {
    new Logger('Bootstrap').warn(
      `Listening on ${host}: the app is reachable on every network interface. Ensure this matches the managed runtime/proxy configuration.`,
    );
  }
  await app.listen(port, host);
}

void bootstrap();
