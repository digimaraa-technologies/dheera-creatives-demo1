import { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Serves the built admin dashboard at /admin, same origin as the API in
 * production. Client-side routes fall back to index.html so a refresh on
 * /admin/products keeps working.
 *
 * Returns false when admin/dist has not been built (the Vite dev server serves
 * the dashboard in development).
 */
export function serveAdmin(app: NestExpressApplication): boolean {
  const directory = resolve(process.cwd(), 'admin', 'dist');
  const indexFile = join(directory, 'index.html');
  if (!existsSync(indexFile)) return false;

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
