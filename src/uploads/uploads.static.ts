import { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Serves uploads/ at /uploads. Only this directory is exposed; express.static
 * resolves paths inside it, refuses dotfiles and never lists directories.
 */
export function serveUploads(app: NestExpressApplication): void {
  // Read at call time so tests can redirect UPLOAD_DIR to a temp directory.
  const directory = resolve(process.env.UPLOAD_DIR ?? 'uploads');
  mkdirSync(directory, { recursive: true });

  app.use(
    '/uploads',
    express.static(directory, {
      index: false,
      redirect: false,
      dotfiles: 'deny',
      fallthrough: true,
      maxAge: '7d',
      // Filenames are random UUIDs and never reused, so a long cache is safe.
      immutable: true,
      setHeaders: (response) => {
        // Images are data, never documents: stop MIME sniffing and scripting.
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        response.setHeader('Content-Security-Policy', "default-src 'none'");
      },
    }),
  );
}
