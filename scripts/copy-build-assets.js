const { cpSync, existsSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const dist = join(root, 'dist');

// Hostinger deploys dist/ as the runtime root, so every non-compiled asset the
// server reads must live inside it. These copy into the existing compiled trees.
const assets = [
  ['public', join(dist, 'public')],
  [join('admin', 'dist'), join(dist, 'admin', 'dist')],
  [join('prisma', 'schema.prisma'), join(dist, 'prisma', 'schema.prisma')],
  [join('prisma', 'migrations'), join(dist, 'prisma', 'migrations')],
];

for (const [relativeSource, destination] of assets) {
  const source = join(root, relativeSource);
  if (!existsSync(source)) {
    throw new Error(`Missing build asset: ${relativeSource}`);
  }
  mkdirSync(join(destination, '..'), { recursive: true });
  cpSync(source, destination, { recursive: true });
}
