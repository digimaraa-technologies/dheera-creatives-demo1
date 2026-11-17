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

const PRODUCTS = '/api/admin/products';
const SERVICES = '/api/admin/services';
const PUBLIC_PRODUCTS = '/api/products';
const PUBLIC_SERVICES = '/api/services';
const PREFIX = `__test_reorder_${randomUUID().slice(0, 8)}`;
const SLUG_PREFIX = `test-reorder-${randomUUID().slice(0, 8)}`;

function productBody(index: number): Record<string, unknown> {
  const slug = `${SLUG_PREFIX}-product-${index}`;
  const imageFilename = `${randomUUID()}.webp`;
  return {
    name: `${PREFIX}_product_${index}`,
    slug,
    description: `Reorder fixture product ${index}`,
    category: 'Blouses',
    imageUrl: `/uploads/products/${imageFilename}`,
    imageFilename,
    price: 1000 + index,
    displayOrder: index,
    isActive: true,
  };
}

function serviceBody(index: number): Record<string, unknown> {
  const slug = `${SLUG_PREFIX}-service-${index}`;
  const imageFilename = `${randomUUID()}.jpg`;
  return {
    name: `${PREFIX}_service_${index}`,
    slug,
    description: `Reorder fixture service ${index}`,
    category: 'Stitching',
    imageUrl: `/uploads/services/${imageFilename}`,
    imageFilename,
    price: 2000 + index,
    displayOrder: index,
    isActive: true,
  };
}

describe('Catalog reorder API (e2e)', () => {
  let ctx: TestContext;
  let session: AdminSession;
  let uploadDir: string;
  let productIds: string[] = [];
  let serviceIds: string[] = [];

  const server = () => ctx.app.getHttpServer();

  async function storedOrders(kind: 'products' | 'services'): Promise<Record<string, number>> {
    const rows =
      kind === 'products'
        ? await ctx.prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, displayOrder: true },
          })
        : await ctx.prisma.service.findMany({
            where: { id: { in: serviceIds } },
            select: { id: true, displayOrder: true },
          });

    return Object.fromEntries(rows.map((row) => [row.id, row.displayOrder]));
  }

  async function publicOrder(kind: 'products' | 'services'): Promise<string[]> {
    const response = await request(server())
      .get(kind === 'products' ? PUBLIC_PRODUCTS : PUBLIC_SERVICES)
      .query({ search: PREFIX, pageSize: 100 })
      .expect(200);

    return response.body.items.map((item: { id: string }) => item.id);
  }

  async function adminOrder(kind: 'products' | 'services'): Promise<string[]> {
    const response = await request(server())
      .get(kind === 'products' ? PRODUCTS : SERVICES)
      .query({ search: PREFIX, sortBy: 'displayOrder', sortDir: 'asc', pageSize: 100 })
      .set('Cookie', session.cookie)
      .expect(200);

    return response.body.items.map((item: { id: string }) => item.id);
  }

  before(async () => {
    uploadDir = await mkdtemp(join(tmpdir(), 'dheera-reorder-'));
    ctx = await createTestContext({ uploadDir });
    session = await ctx.login();

    for (const index of [1, 2, 3]) {
      const product = await request(server())
        .post(PRODUCTS)
        .set(adminHeaders(session))
        .send(productBody(index))
        .expect(201);
      productIds.push(product.body.id);

      const service = await request(server())
        .post(SERVICES)
        .set(adminHeaders(session))
        .send(serviceBody(index))
        .expect(201);
      serviceIds.push(service.body.id);
    }
  });

  after(async () => {
    await ctx.prisma.product.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await ctx.prisma.service.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await ctx.close();
    await rm(uploadDir, { recursive: true, force: true });
  });

  it('rejects unauthenticated reorder requests', async () => {
    await request(server())
      .patch(`${PRODUCTS}/reorder`)
      .send({ items: [{ id: productIds[0], displayOrder: 1 }] })
      .expect(401);

    await request(server())
      .patch(`${SERVICES}/reorder`)
      .send({ items: [{ id: serviceIds[0], displayOrder: 1 }] })
      .expect(401);
  });

  it('rejects reorder requests without a CSRF token', async () => {
    await request(server())
      .patch(`${PRODUCTS}/reorder`)
      .set('Cookie', session.cookie)
      .send({ items: [{ id: productIds[0], displayOrder: 1 }] })
      .expect(403);

    await request(server())
      .patch(`${SERVICES}/reorder`)
      .set('Cookie', session.cookie)
      .send({ items: [{ id: serviceIds[0], displayOrder: 1 }] })
      .expect(403);
  });

  it('rejects invalid ids, duplicate ids and duplicate positions', async () => {
    const text = (body: { message: string | string[] }): string =>
      Array.isArray(body.message) ? body.message.join(' ') : body.message;

    const invalidUuid = await request(server())
      .patch(`${PRODUCTS}/reorder`)
      .set(adminHeaders(session))
      .send({ items: [{ id: 'not-a-uuid', displayOrder: 1 }] })
      .expect(400);
    assert.match(text(invalidUuid.body), /uuid/i);

    await request(server())
      .patch(`${PRODUCTS}/reorder`)
      .set(adminHeaders(session))
      .send({
        items: [
          { id: productIds[0], displayOrder: 1 },
          { id: productIds[0], displayOrder: 2 },
        ],
      })
      .expect(400);

    const duplicateOrder = await request(server())
      .patch(`${PRODUCTS}/reorder`)
      .set(adminHeaders(session))
      .send({
        items: [
          { id: productIds[0], displayOrder: 1 },
          { id: productIds[1], displayOrder: 1 },
        ],
      })
      .expect(400);
    assert.match(text(duplicateOrder.body), /displayOrder/i);
  });

  it('rejects empty lists and invalid displayOrder values', async () => {
    await request(server())
      .patch(`${PRODUCTS}/reorder`)
      .set(adminHeaders(session))
      .send({ items: [] })
      .expect(400);

    await request(server())
      .patch(`${PRODUCTS}/reorder`)
      .set(adminHeaders(session))
      .send({ items: [{ id: productIds[0], displayOrder: -1 }] })
      .expect(400);

    await request(server())
      .patch(`${PRODUCTS}/reorder`)
      .set(adminHeaders(session))
      .send({ items: [{ id: productIds[0], displayOrder: 1.5 }] })
      .expect(400);

    await request(server())
      .patch(`${PRODUCTS}/reorder`)
      .set(adminHeaders(session))
      .send({ items: [{ id: productIds[0], displayOrder: '1' }] })
      .expect(400);
  });

  it('reorders products and the admin and public lists follow', async () => {
    const [first, second, third] = productIds;

    const response = await request(server())
      .patch(`${PRODUCTS}/reorder`)
      .set(adminHeaders(session))
      .send({
        items: [
          { id: third, displayOrder: 1 },
          { id: first, displayOrder: 2 },
          { id: second, displayOrder: 3 },
        ],
      })
      .expect(200);

    assert.deepEqual(response.body, { success: true, updated: 3 });

    const stored = await storedOrders('products');
    assert.equal(stored[third], 1);
    assert.equal(stored[first], 2);
    assert.equal(stored[second], 3);

    assert.deepEqual(await adminOrder('products'), [third, first, second]);
    assert.deepEqual(await publicOrder('products'), [third, first, second]);
  });

  it('reorders services without touching product order', async () => {
    const productsBefore = await storedOrders('products');
    const [first, second, third] = serviceIds;

    await request(server())
      .patch(`${SERVICES}/reorder`)
      .set(adminHeaders(session))
      .send({
        items: [
          { id: second, displayOrder: 1 },
          { id: third, displayOrder: 2 },
          { id: first, displayOrder: 3 },
        ],
      })
      .expect(200);

    const stored = await storedOrders('services');
    assert.equal(stored[second], 1);
    assert.equal(stored[third], 2);
    assert.equal(stored[first], 3);

    assert.deepEqual(await adminOrder('services'), [second, third, first]);
    assert.deepEqual(await publicOrder('services'), [second, third, first]);
    assert.deepEqual(await storedOrders('products'), productsBefore);
  });

  it('does not let a product reorder modify services', async () => {
    const servicesBefore = await storedOrders('services');

    await request(server())
      .patch(`${PRODUCTS}/reorder`)
      .set(adminHeaders(session))
      .send({ items: [{ id: serviceIds[0], displayOrder: 1 }] })
      .expect(404);

    assert.deepEqual(await storedOrders('services'), servicesBefore);
  });

  it('does not let a service reorder modify products', async () => {
    const productsBefore = await storedOrders('products');

    await request(server())
      .patch(`${SERVICES}/reorder`)
      .set(adminHeaders(session))
      .send({ items: [{ id: productIds[0], displayOrder: 1 }] })
      .expect(404);

    assert.deepEqual(await storedOrders('products'), productsBefore);
  });

  it('rejects unknown ids and leaves the previous order intact', async () => {
    const productsBefore = await storedOrders('products');

    await request(server())
      .patch(`${PRODUCTS}/reorder`)
      .set(adminHeaders(session))
      .send({
        items: [
          { id: productIds[0], displayOrder: 1 },
          { id: randomUUID(), displayOrder: 2 },
        ],
      })
      .expect(404);

    assert.deepEqual(await storedOrders('products'), productsBefore);
  });

  it('rolls back the whole reorder when one update fails', async () => {
    const productsBefore = await storedOrders('products');
    const [first] = productIds;
    assert.notEqual(productsBefore[first], 1);

    // The DTO now rejects out-of-range positions, so force the failure inside
    // the transaction instead: make the membership pre-check pass with an id
    // that does not exist. The first update must be rolled back with it.
    const originalCount = ctx.prisma.product.count;
    ctx.prisma.product.count = (async () =>
      productIds.length) as unknown as typeof originalCount;

    try {
      await request(server())
        .patch(`${PRODUCTS}/reorder`)
        .set(adminHeaders(session))
        .send({
          items: [
            { id: first, displayOrder: 1 },
            { id: randomUUID(), displayOrder: 2 },
          ],
        })
        .expect(404);
    } finally {
      ctx.prisma.product.count = originalCount;
    }

    assert.deepEqual(await storedOrders('products'), productsBefore);
  });

  it('rejects positions above the PostgreSQL int range without changing the order', async () => {
    const productsBefore = await storedOrders('products');
    const [first, second] = productIds;
    assert.notEqual(productsBefore[first], 1);

    await request(server())
      .patch(`${PRODUCTS}/reorder`)
      .set(adminHeaders(session))
      .send({
        items: [
          { id: first, displayOrder: 1 },
          { id: second, displayOrder: 2 ** 31 },
        ],
      })
      .expect(400);

    assert.deepEqual(await storedOrders('products'), productsBefore);
  });
});
