import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import {
  AdminSession,
  TestContext,
  adminHeaders,
  createTestContext,
} from './helpers/admin-session';

const ADMIN = '/api/admin/products';
const PUBLIC = '/api/products';
const NAME = `__test_product_${randomUUID().slice(0, 8)}`;
const SLUG = `test-product-${randomUUID().slice(0, 8)}`;
const IMAGE = `/uploads/products/${randomUUID()}.webp`;

function productBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: NAME,
    slug: SLUG,
    description: 'Hand-embroidered blouse with aari work',
    category: 'Blouses',
    imageUrl: IMAGE,
    imageFilename: IMAGE.split('/').pop(),
    price: 1250.5,
    displayOrder: 2,
    isActive: true,
    ...overrides,
  };
}

describe('Products API (e2e)', () => {
  let ctx: TestContext;
  let session: AdminSession;
  let uploadDir: string;
  let createdId: string;
  let inactiveSlug: string;

  before(async () => {
    uploadDir = await mkdtemp(join(tmpdir(), 'dheera-products-'));
    ctx = await createTestContext({ uploadDir });
    session = await ctx.login();
  });

  after(async () => {
    await ctx.prisma.product.deleteMany({
      where: { name: { startsWith: '__test_', not: { startsWith: '__test_upload_' } } },
    });
    await ctx.close();
    await rm(uploadDir, { recursive: true, force: true });
  });

  it('rejects unauthenticated admin requests', async () => {
    await request(ctx.app.getHttpServer()).get(ADMIN).expect(401);
    await request(ctx.app.getHttpServer()).post(ADMIN).send(productBody()).expect(401);
  });

  it('rejects state-changing requests without a CSRF token', async () => {
    await request(ctx.app.getHttpServer())
      .post(ADMIN)
      .set('Cookie', session.cookie)
      .send(productBody())
      .expect(403);
  });

  it('creates a product', async () => {
    const response = await request(ctx.app.getHttpServer())
      .post(ADMIN)
      .set(adminHeaders(session))
      .send(productBody())
      .expect(201);

    createdId = response.body.id;
    assert.equal(response.body.name, NAME);
    assert.equal(response.body.slug, SLUG);
    assert.equal(response.body.price, 1250.5);
    assert.equal(response.body.isActive, true);
    assert.equal(response.body.imageFilename, IMAGE.split('/').pop());
    assert.equal('passwordHash' in response.body, false);

    const stored = await ctx.prisma.product.findUnique({ where: { id: createdId } });
    assert.ok(stored);
    assert.equal(stored.slug, SLUG);
  });

  it('generates a slug from the name when none is provided', async () => {
    const name = `__test_product_slug_${randomUUID().slice(0, 8)}`;
    const response = await request(ctx.app.getHttpServer())
      .post(ADMIN)
      .set(adminHeaders(session))
      .send(productBody({ name, slug: undefined }))
      .expect(201);

    assert.match(response.body.slug, /^test-product-slug-[a-z0-9-]+$/);
  });

  it('rejects duplicate slugs', async () => {
    const response = await request(ctx.app.getHttpServer())
      .post(ADMIN)
      .set(adminHeaders(session))
      .send(productBody({ name: `${NAME}_dup` }))
      .expect(409);

    assert.match(response.body.message, /slug/i);
  });

  it('rejects negative prices', async () => {
    await request(ctx.app.getHttpServer())
      .post(ADMIN)
      .set(adminHeaders(session))
      .send(productBody({ slug: `${SLUG}-negative`, price: -5 }))
      .expect(400);
  });

  it('rejects unknown fields', async () => {
    await request(ctx.app.getHttpServer())
      .post(ADMIN)
      .set(adminHeaders(session))
      .send(productBody({ slug: `${SLUG}-extra`, isFeatured: true }))
      .expect(400);
  });

  it('lists, searches, filters, sorts and paginates', async () => {
    const prefix = `test-list-${randomUUID().slice(0, 6)}`;
    const first = await request(ctx.app.getHttpServer())
      .post(ADMIN)
      .set(adminHeaders(session))
      .send(productBody({ name: `__test_${prefix}_a`, slug: `${prefix}-a`, displayOrder: 3 }))
      .expect(201);
    await request(ctx.app.getHttpServer())
      .post(ADMIN)
      .set(adminHeaders(session))
      .send(
        productBody({
          name: `__test_${prefix}_b`,
          slug: `${prefix}-b`,
          displayOrder: 1,
          isActive: false,
          category: 'Sarees',
        }),
      )
      .expect(201);

    const search = await request(ctx.app.getHttpServer())
      .get(ADMIN)
      .query({ search: prefix })
      .set('Cookie', session.cookie)
      .expect(200);
    assert.equal(search.body.total, 2);

    const inactive = await request(ctx.app.getHttpServer())
      .get(ADMIN)
      .query({ search: prefix, isActive: 'false' })
      .set('Cookie', session.cookie)
      .expect(200);
    assert.equal(inactive.body.total, 1);
    assert.equal(inactive.body.items[0].isActive, false);

    const category = await request(ctx.app.getHttpServer())
      .get(ADMIN)
      .query({ search: prefix, category: 'Sarees' })
      .set('Cookie', session.cookie)
      .expect(200);
    assert.equal(category.body.total, 1);
    assert.ok(category.body.categories.includes('Sarees'));

    const sorted = await request(ctx.app.getHttpServer())
      .get(ADMIN)
      .query({ search: prefix, sortBy: 'displayOrder', sortDir: 'asc' })
      .set('Cookie', session.cookie)
      .expect(200);
    assert.deepEqual(
      sorted.body.items.map((item: { displayOrder: number }) => item.displayOrder),
      [1, 3],
    );

    const paged = await request(ctx.app.getHttpServer())
      .get(ADMIN)
      .query({ search: prefix, page: 2, pageSize: 1, sortBy: 'name', sortDir: 'desc' })
      .set('Cookie', session.cookie)
      .expect(200);
    assert.equal(paged.body.total, 2);
    assert.equal(paged.body.totalPages, 2);
    assert.equal(paged.body.items.length, 1);
    assert.equal(paged.body.items[0].id, first.body.id);
  });

  it('updates a product', async () => {
    const response = await request(ctx.app.getHttpServer())
      .patch(`${ADMIN}/${createdId}`)
      .set(adminHeaders(session))
      .send({ name: `${NAME}_updated`, price: 999, isActive: false })
      .expect(200);

    assert.equal(response.body.name, `${NAME}_updated`);
    assert.equal(response.body.price, 999);
    assert.equal(response.body.isActive, false);

    const read = await request(ctx.app.getHttpServer())
      .get(`${ADMIN}/${createdId}`)
      .set('Cookie', session.cookie)
      .expect(200);
    assert.equal(read.body.price, 999);
  });

  it('rejects a negative price on update', async () => {
    await request(ctx.app.getHttpServer())
      .patch(`${ADMIN}/${createdId}`)
      .set(adminHeaders(session))
      .send({ price: -1 })
      .expect(400);
  });

  it('only exposes active products publicly', async () => {
    // createdId was deactivated by the update test.
    const inactiveSlugResponse = await request(ctx.app.getHttpServer())
      .get(`${ADMIN}/${createdId}`)
      .set('Cookie', session.cookie)
      .expect(200);
    inactiveSlug = inactiveSlugResponse.body.slug;

    const publicList = await request(ctx.app.getHttpServer())
      .get(PUBLIC)
      .query({ search: '__test_' })
      .expect(200);
    assert.equal(
      publicList.body.items.some((item: { id: string }) => item.id === createdId),
      false,
    );

    await request(ctx.app.getHttpServer()).get(`${PUBLIC}/${inactiveSlug}`).expect(404);

    const activeSlug = `${SLUG}-active`;
    await request(ctx.app.getHttpServer())
      .post(ADMIN)
      .set(adminHeaders(session))
      .send(productBody({ slug: activeSlug, name: `${NAME}_active` }))
      .expect(201);

    const detail = await request(ctx.app.getHttpServer())
      .get(`${PUBLIC}/${activeSlug}`)
      .expect(200);
    assert.equal(detail.body.slug, activeSlug);
  });

  it('returns 404 for unknown product ids', async () => {
    await request(ctx.app.getHttpServer())
      .get(`${ADMIN}/${randomUUID()}`)
      .set('Cookie', session.cookie)
      .expect(404);
  });

  it('deletes a product', async () => {
    await request(ctx.app.getHttpServer())
      .delete(`${ADMIN}/${createdId}`)
      .set(adminHeaders(session))
      .expect(200);

    await request(ctx.app.getHttpServer())
      .get(`${ADMIN}/${createdId}`)
      .set('Cookie', session.cookie)
      .expect(404);

    assert.equal(await ctx.prisma.product.findUnique({ where: { id: createdId } }), null);
  });
});
