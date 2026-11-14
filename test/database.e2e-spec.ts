import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Database (e2e)', () => {
  let prisma: PrismaService;

  before(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    prisma = moduleRef.get(PrismaService);
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it('connects to the real PostgreSQL database', async () => {
    const [row] = await prisma.$queryRaw<
      Array<{ database: string; version: string }>
    >`SELECT current_database() AS database, current_setting('server_version') AS version`;

    assert.equal(row.database, 'dheera_creatives_db');
    assert.match(row.version, /^17\./);
  });

  it('has every migration applied', async () => {
    const migrations = await prisma.$queryRaw<
      Array<{ migration_name: string; finished_at: Date | null }>
    >`SELECT migration_name, finished_at FROM _prisma_migrations`;

    assert.ok(migrations.length > 0);
    assert.ok(migrations.every((migration) => migration.finished_at !== null));
  });

  it('has the admins, products and services tables', async () => {
    const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('admins', 'products', 'services')
      ORDER BY table_name
    `;

    assert.deepEqual(
      rows.map((row) => row.table_name),
      ['admins', 'products', 'services'],
    );
  });

  it('has unique slug indexes and non-negative price constraints', async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename IN ('products', 'services')
    `;
    const indexNames = indexes.map((index) => index.indexname);
    assert.ok(indexNames.includes('products_slug_key'));
    assert.ok(indexNames.includes('services_slug_key'));

    const checks = await prisma.$queryRaw<Array<{ constraint_name: string }>>`
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE constraint_schema = 'public' AND constraint_type = 'CHECK'
    `;
    const checkNames = checks.map((check) => check.constraint_name);
    assert.ok(checkNames.includes('products_price_non_negative'));
    assert.ok(checkNames.includes('services_price_non_negative'));
  });

  it('has nullable imageFilename columns on products and services', async () => {
    const columns = await prisma.$queryRaw<
      Array<{ table_name: string; is_nullable: string }>
    >`
      SELECT table_name, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'imageFilename'
      ORDER BY table_name
    `;

    assert.deepEqual(
      columns.map((column) => column.table_name),
      ['products', 'services'],
    );
    assert.ok(columns.every((column) => column.is_nullable === 'YES'));
  });

  it('rejects duplicate slugs and negative prices', async () => {
    const slug = `__test-${randomUUID()}`;
    const data = {
      name: 'Test product',
      slug,
      description: 'Created by the database e2e test.',
      category: 'test',
      imageUrl: 'https://example.com/test.webp',
      price: '10.00',
    };

    await prisma.product.create({ data });

    try {
      await assert.rejects(
        prisma.product.create({ data }),
        (error: unknown) =>
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002',
      );

      await assert.rejects(
        prisma.product.create({
          data: { ...data, slug: `${slug}-negative`, price: '-1' },
        }),
        /products_price_non_negative|23514/,
      );
    } finally {
      await prisma.product.deleteMany({
        where: { slug: { startsWith: '__test-' } },
      });
    }
  });
});
