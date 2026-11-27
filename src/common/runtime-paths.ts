import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

/**
 * Hostinger deploys dist/ as the application root; locally the same entry point
 * sits in <repo>/dist. Prefer entry-relative roots so a source-like cwd holding
 * public/ cannot shadow the compiled assets next to main.js.
 */
export function assetRoot(entryDir: string): string {
  const candidates = [resolve(entryDir), resolve(entryDir, '..'), process.cwd()];
  return (
    candidates.find((directory) =>
      existsSync(join(directory, 'public', 'index.html')),
    ) ?? process.cwd()
  );
}

/** Resolve UPLOAD_DIR under the asset root unless an absolute path is given. */
export function uploadDir(entryDir: string): string {
  const configured = process.env.UPLOAD_DIR ?? 'uploads';
  return isAbsolute(configured)
    ? configured
    : join(assetRoot(entryDir), configured);
}
