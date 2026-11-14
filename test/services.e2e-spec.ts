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

const ADMIN = '/api/admin/services';
const PUBLIC = '/api/services';
const NAME = `__test_service_${randomUUID().slice(0, 8)}`;
const SLUG = `test-service-${randomUUID().slice(0, 8)}`;
const IMAGE = `/uploads/services/${randomUUID()}.jpg`;

function serviceBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: NAME,
    slug: SLUG,
    description: 'Custom bridal blouse stitching with fitting sessions',
    category: 'Stitching',
    imageUrl: IMAGE,
    imageFilename: IMAGE.split('/').pop(),
    price: 4500,
    displayOrder: 1,
    isActive: true,
    ...overrides,
  };
}

describe('Services API (e2e)', () => {
  let ctx: TestContext;
  let session: AdminSession;
  let uploadDir: string;
  let createdId: string;

  before(async () => {
    uploadDir = await mkdtemp(join(tmpdir(), 'dheera-services-'));
    ctx = await createTestContext({ uploadDir });
    session = await ctx.login();
  });

  after(async () => {
    await ctx.prisma.service.deleteMany({
      where: { name: { startsWith: '__test_', not: { startsWith: '__test_upload_' } } },
    });
    await ctx.close();
    await rm(uploadDir, { recursive: true, force: true });
  });

  it('rejects unauthenticated admin requests', async () => {
    await request(ctx.app.getHttpServer()).get(ADMIN).expect(401);
    await request(ctx.app.getHttpServer()).post(ADMIN).send(serviceBody()).expect(401);
  });

  it('rejects state-changing requests without a CSRF token', async () => {
    await request(ctx.app.getHttpServer())
      .post(ADMIN)
      .set('Cookie', session.cookie)
      .send(serviceBody())
      .expect(403);
  });

  it('creates a service', async () => {
    const response = await request(ctx.app.getHttpServer())
      .post(ADMIN)
      .set(adminHeaders(session))
      .send(serviceBody())
      .expect(201);

    createdId = response.body.id;
    assert.equal(response.body.slug, SLUG);
    assert.equal(response.body.price, 4500);
    assert.equal(response.body.imageFilename, IMAGE.split('/').pop());
  });

  it('rejects duplicate slugs', async () => {
    await request(ctx.app.getHttpServer())
      .post(ADMIN)
      .set(adminHeaders(session))
      .send(serviceBody({ name: `${NAME}_dup` }))
      .expect(409);
  });

  it('rejects negative prices', async () => {
    await request(ctx.app.getHttpServer())
      .post(ADMIN)
      .set(adminHeaders(session))
      .send(serviceBody({ slug: `${SLUG}-negative`, price: -1 }))
      .expect(400);
  });

  it('lists, searches, filters and sorts', async () => {
    const prefix = `test-svc-list-${randomUUID().slice(0, 6)}`;
    await request(ctx.app.getHttpServer())
      .post(ADMIN)
      .set(adminHeaders(session))
      .send(serviceBody({ name: `__test_${prefix}_a`, slug: `${prefix}-a`, displayOrder: 5 }))
      .expect(201);
    await request(ctx.app.getHttpServer())
      .post(ADMIN)
      .set(adminHeaders(session))
      .send(
        serviceBody({
          name: `__test_${prefix}_b`,
          slug: `${prefix}-b`,
          displayOrder: 2,
          isActive: false,
          category: 'Embroidery',
        }),
      )
      .expect(201);

    const search = await request(ctx.app.getHttpServer())
      .get(ADMIN)
      .query({ search: prefix, sortBy: 'displayOrder', sortDir: 'asc' })
      .set('Cookie', session.cookie)
      .expect(200);
    assert.equal(search.body.total, 2);
    assert.deepEqual(
      search.body.items.map((item: { displayOrder: number }) => item.displayOrder),
      [2, 5],
    );

    const filtered = await request(ctx.app.getHttpServer())
      .get(ADMIN)
      .query({ search: prefix, isActive: 'true', category: 'Stitching' })
      .set('Cookie', session.cookie)
      .expect(200);
    assert.equal(filtered.body.total, 1);
  });

  it('updates a service', async () => {
    const response = await request(ctx.app.getHttpServer())
      .patch(`${ADMIN}/${createdId}`)
      .set(adminHeaders(session))
      .send({ price: 3999, isActive: false, description: 'Updated description' })
      .expect(200);

    assert.equal(response.body.price, 3999);
    assert.equal(response.body.isActive, false);
    assert.equal(response.body.description, 'Updated description');
  });

  it('only exposes active services publicly', async () => {
    const inactive = await request(ctx.app.getHttpServer())
      .get(`${ADMIN}/${createdId}`)
      .set('Cookie', session.cookie)
      .expect(200);

    await request(ctx.app.getHttpServer()).get(`${PUBLIC}/${inactive.body.slug}`).expect(404);

    const publicList = await request(ctx.app.getHttpServer())
      .get(PUBLIC)
      .query({ search: '__test_' })
      .expect(200);
    assert.equal(
      publicList.body.items.some((item: { id: string }) => item.id === createdId),
      false,
    );

    const activeSlug = `${SLUG}-active`;
    await request(ctx.app.getHttpServer())
      .post(ADMIN)
      .set(adminHeaders(session))
      .send(serviceBody({ slug: activeSlug, name: `${NAME}_active` }))
      .expect(201);

    const detail = await request(ctx.app.getHttpServer()).get(`${PUBLIC}/${activeSlug}`).expect(200);
    assert.equal(detail.body.slug, activeSlug);
  });

  it('deletes a service', async () => {
    await request(ctx.app.getHttpServer())
      .delete(`${ADMIN}/${createdId}`)
      .set(adminHeaders(session))
      .expect(200);

    await request(ctx.app.getHttpServer())
      .get(`${ADMIN}/${createdId}`)
      .set('Cookie', session.cookie)
      .expect(404);
    assert.equal(await ctx.prisma.service.findUnique({ where: { id: createdId } }), null);
  });
});
