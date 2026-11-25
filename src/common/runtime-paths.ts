import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

/**
 * Hostinger deploys dist/ as the application root; locally the same entry point
 * sits in <repo>/dist. Find the root that holds the copied public/ assets.
 */
export function assetRoot(entryDir: string): string {
  const candidates = [process.cwd(), resolve(entryDir, '..'), resolve(entryDir)];
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
