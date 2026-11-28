import { Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { assetRoot } from '../common/runtime-paths';

const ADMIN_LOGIN_ALIASES = new Set(['/login', '/login/', '/admin-login', '/admin-login/']);

/**
 * Serves the built admin dashboard at /admin, same origin as the API in
 * production. Client-side routes fall back to index.html so a refresh on
 * /admin/products keeps working. Also redirects /login and /admin-login to
 * /admin/login for convenient production access.
 *
 * Returns false when admin/dist has not been built (the Vite dev server serves
 * the dashboard in development).
 */
export function serveAdmin(app: NestExpressApplication): boolean {
  const directory = join(assetRoot(__dirname), 'admin', 'dist');
  const indexFile = join(directory, 'index.html');
  if (!existsSync(indexFile)) {
    new Logger('AdminStatic').error(
      `Admin dashboard build not found at ${indexFile}; /admin routes will return 404.`,
    );
    return false;
  }

  app.use((request: Request, response: Response, next: NextFunction) => {
    if (
      (request.method === 'GET' || request.method === 'HEAD') &&
      ADMIN_LOGIN_ALIASES.has(request.path)
    ) {
      response.redirect(302, '/admin/login');
      return;
    }
    next();
  });

  app.use(
    '/admin',
    express.static(directory, {
      index: 'index.html',
      // Hashed assets are safe to cache; the HTML must always be revalidated so
      // a deploy is picked up without a hard refresh.
      setHeaders: (response, filePath) => {
        if (filePath.endsWith('.html')) {
          response.setHeader('Cache-Control', 'no-store');
        }
      },
    }),
  );

  app.use(
    '/admin',
    (request: Request, response: Response, next: NextFunction) => {
      // Only route-like paths fall back to the SPA; a missing asset stays a 404.
      if (
        (request.method !== 'GET' && request.method !== 'HEAD') ||
        /\.[a-z0-9]+$/i.test(request.path)
      ) {
        next();
        return;
      }
      response.setHeader('Cache-Control', 'no-store');
      response.sendFile(indexFile);
    },
  );

  return true;
}
