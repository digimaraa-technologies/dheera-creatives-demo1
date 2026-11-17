import { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

// The public site has no inline scripts and no inline styles in its HTML. Google
// Fonts is the only third-party origin. `style-src 'unsafe-inline'` keeps the
// existing design working (styles set from script.js) without weakening scripts.
const PUBLIC_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

// Vite's production build is a single external module + stylesheet, so no
// inline script is needed. `blob:` is for local image previews in the form.
const ADMIN_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const NON_DOCUMENT_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";

function isDocumentPath(path: string): boolean {
  return path === '/' || path === '/index.html';
}

/**
 * Sets the headers that stop clickjacking, MIME sniffing and referrer leakage,
 * and a CSP per response kind. HSTS is only emitted in production because
 * browsers ignore it over plain HTTP and it would break local development.
 */
export function securityHeaders(isProduction: boolean): RequestHandler {
  const publicPolicy = isProduction
    ? `${PUBLIC_CSP}; upgrade-insecure-requests`
    : PUBLIC_CSP;
  const adminPolicy = isProduction
    ? `${ADMIN_CSP}; upgrade-insecure-requests`
    : ADMIN_CSP;

  return (request: Request, response: Response, next: NextFunction): void => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=()',
    );

    if (isProduction) {
      response.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains',
      );
    }

    // Authenticated admin data and public catalogue data must never be reused
    // from a browser or intermediary cache: deactivation takes effect at once
    // and admin responses never leak between sessions.
    if (request.path === '/api' || request.path.startsWith('/api/')) {
      response.setHeader('Cache-Control', 'no-store');
    }

    const policy = request.path.startsWith('/admin')
      ? adminPolicy
      : isDocumentPath(request.path)
        ? publicPolicy
        : NON_DOCUMENT_CSP;

    response.setHeader('Content-Security-Policy', policy);
    next();
  };
}

/**
 * Express-level hardening shared by the real server and the tests: hides the
 * framework banner, trusts exactly the configured proxy hops (so the login
 * limiter sees real client IPs) and installs the security headers.
 */
export function hardenApp(
  app: NestExpressApplication,
  options: { isProduction: boolean; trustProxy: number | boolean },
): void {
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.set('trust proxy', options.trustProxy);
  app.use(securityHeaders(options.isProduction));
}
