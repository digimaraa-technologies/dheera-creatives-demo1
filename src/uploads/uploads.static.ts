import { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import { mkdirSync } from 'node:fs';
import { uploadDir } from '../common/runtime-paths';

/**
 * Serves uploads/ at /uploads. Only this directory is exposed; express.static
 * resolves paths inside it, refuses dotfiles and never lists directories.
 */
export function serveUploads(app: NestExpressApplication): void {
  // Read at call time so tests can redirect UPLOAD_DIR to a temp directory.
  const directory = uploadDir(__dirname);
  // Production uploads are disabled by UploadsService, so never create a
  // directory on the managed filesystem during startup.
  if (process.env.NODE_ENV !== 'production') {
    mkdirSync(directory, { recursive: true });
  }

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
