import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  SESSION_COOKIE,
} from '../src/auth/auth.cookies';
import { hashToken } from '../src/auth/auth.service';
import { RATE_LIMITS } from '../src/common/rate-limit';
import {
  AdminSession,
  TEST_PASSWORD,
  TestContext,
  adminHeaders,
  adminOrigin,
  createTestContext,
  nextIp,
} from './helpers/admin-session';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe('Phase 3 API hardening (e2e)', () => {
  let ctx: TestContext;
  let session: AdminSession;
  let uploadDir: string;

  before(async () => {
    uploadDir = await mkdtemp(join(tmpdir(), 'dheera-phase3-'));
    ctx = await createTestContext({ uploadDir, serveUploads: true });
    session = await ctx.login();
  });

  after(async () => {
    await ctx.prisma.product.deleteMany({ where: { name: { startsWith: '__test_p3_' } } });
    await ctx.prisma.service.deleteMany({ where: { name: { startsWith: '__test_p3_' } } });
    await ctx.close();
    await rm(uploadDir, { recursive: true, force: true });
  });

  function storedPath(imageUrl: string): string {
    return join(uploadDir, ...imageUrl.replace('/uploads/', '').split('/'));
  }

  function publicGet(path: string, ip: string): request.Test {
    return request(ctx.app.getHttpServer()).get(path).set('X-Forwarded-For', ip);
  }

  describe('rate limiting', () => {
    it('limits public traffic per IP and returns a generic 429', async () => {
      const ip = nextIp();
      for (let i = 0; i < RATE_LIMITS.public.limit; i += 1) {
        await publicGet('/api/products', ip).expect(200);
      }

      const blocked = await publicGet('/api/products', ip).expect(429);
      assert.deepEqual(blocked.body, {
        statusCode: 429,
        message: 'Too many requests',
      });
      // No limiter implementation details leak in headers.
      assert.equal(blocked.headers['x-ratelimit-limit'], undefined);
      assert.equal(blocked.headers['x-ratelimit-remaining'], undefined);
      assert.equal(blocked.headers['retry-after'], undefined);

      // A different client IP has its own bucket.
      await publicGet('/api/products', nextIp()).expect(200);
    });

    it('limits admin writes separately from admin reads and public traffic', async () => {
      const ip = nextIp();
      const attempt = () =>
        request(ctx.app.getHttpServer())
          .post('/api/admin/products')
          .set(adminHeaders(session))
          .set('X-Forwarded-For', ip)
          .send({});

      for (let i = 0; i < RATE_LIMITS.adminWrite.limit; i += 1) {
        await attempt().expect(400);
      }
      await attempt().expect(429);

      // The same IP can still read and browse: buckets are per route handler.
      await request(ctx.app.getHttpServer())
        .get('/api/admin/products')
        .set('Cookie', session.cookie)
        .set('X-Forwarded-For', ip)
        .expect(200);
      await publicGet('/api/products', ip).expect(200);
    });

    it('limits admin reads and keeps the write bucket independent', async () => {
      const ip = nextIp();
      for (let i = 0; i < RATE_LIMITS.adminRead.limit; i += 1) {
        await request(ctx.app.getHttpServer())
          .get('/api/admin/products')
          .set('Cookie', session.cookie)
          .set('X-Forwarded-For', ip)
          .expect(200);
      }
      await request(ctx.app.getHttpServer())
        .get('/api/admin/products')
        .set('Cookie', session.cookie)
        .set('X-Forwarded-For', ip)
        .expect(429);

      await request(ctx.app.getHttpServer())
        .post('/api/admin/products')
        .set(adminHeaders(session))
        .set('X-Forwarded-For', ip)
        .send({})
        .expect(400);
    });

    it('limits uploads', async () => {
      const ip = nextIp();
      const attempt = () =>
        request(ctx.app.getHttpServer())
          .post('/api/admin/uploads/products')
          .set(adminHeaders(session))
          .set('X-Forwarded-For', ip);

      for (let i = 0; i < RATE_LIMITS.uploads.limit; i += 1) {
        await attempt().expect(400);
      }
      await attempt().expect(429);
    });

    it('derives the client IP from the configured proxy hop count', async () => {
      const proxyCtx = await createTestContext({ trustProxy: 1 });
      const identifier = `nobody-${randomUUID().slice(0, 8)}`;
      const login = (forwardedFor: string) =>
        request(proxyCtx.app.getHttpServer())
          .post('/api/auth/login')
          .set('X-Forwarded-For', forwardedFor)
          .set('Origin', adminOrigin())
          .send({ identifier, password: 'wrong-password' });

      try {
        const client = '203.0.113.7';
        for (let i = 0; i < RATE_LIMITS.login.limit; i += 1) {
          await login(client).expect(401);
        }
        await login(client).expect(429);

        // Another client behind the same proxy is unaffected.
        await login('203.0.113.8').expect(401);

        // A spoofed left-most hop is ignored: the right-most untrusted address
        // is still the exhausted client.
        await login(`198.51.100.99, ${client}`).expect(429);
      } finally {
        await proxyCtx.close();
      }
    });
  });

  describe('cache control', () => {
    it('marks public and admin API responses no-store', async () => {
      const publicList = await request(ctx.app.getHttpServer())
        .get('/api/products')
        .expect(200);
      assert.equal(publicList.headers['cache-control'], 'no-store');

      const adminList = await request(ctx.app.getHttpServer())
        .get('/api/admin/products')
        .set('Cookie', session.cookie)
        .expect(200);
      assert.equal(adminList.headers['cache-control'], 'no-store');

      const me = await request(ctx.app.getHttpServer())
        .get('/api/auth/me')
        .set('Cookie', session.cookie)
        .expect(200);
      assert.equal(me.headers['cache-control'], 'no-store');
    });

    it('marks login responses no-store', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/auth/login')
        .set('X-Forwarded-For', nextIp())
        .set('Origin', adminOrigin())
        .send({ identifier: ctx.username, password: TEST_PASSWORD })
        .expect(200);

      assert.equal(response.headers['cache-control'], 'no-store');
    });

    it('serves uploaded images with a long immutable cache', async () => {
      const upload = await request(ctx.app.getHttpServer())
        .post('/api/admin/uploads/products')
        .set(adminHeaders(session))
        .attach('image', PNG, { filename: 'photo.png', contentType: 'image/png' })
        .expect(201);

      const image = await request(ctx.app.getHttpServer())
        .get(upload.body.imageUrl)
        .expect(200);
      assert.match(image.headers['cache-control'], /max-age=604800/);
      assert.match(image.headers['cache-control'], /immutable/);
    });
  });

  describe('category exposure', () => {
    const suffix = randomUUID().slice(0, 8);
    const activeCategory = `P3-Active-${suffix}`;
    const inactiveOnlyCategory = `P3-Inactive-${suffix}`;
    const prefix = `__test_p3_category_${suffix}`;

    before(async () => {
      const base = {
        description: 'Category exposure fixture',
        imageUrl: '',
        price: null,
        displayOrder: 0,
      };
      await ctx.prisma.product.createMany({
        data: [
          { ...base, name: `${prefix}_active`, slug: `p3-active-${suffix}`, category: activeCategory, isActive: true },
          { ...base, name: `${prefix}_inactive`, slug: `p3-inactive-${suffix}`, category: activeCategory, isActive: false },
          { ...base, name: `${prefix}_hidden`, slug: `p3-hidden-${suffix}`, category: inactiveOnlyCategory, isActive: false },
        ],
      });
      await ctx.prisma.service.createMany({
        data: [
          { ...base, name: `${prefix}_s_active`, slug: `p3-s-active-${suffix}`, category: activeCategory, isActive: true },
          { ...base, name: `${prefix}_s_hidden`, slug: `p3-s-hidden-${suffix}`, category: inactiveOnlyCategory, isActive: false },
        ],
      });
    });

    it('derives public categories from active records only', async () => {
      const products = await request(ctx.app.getHttpServer())
        .get('/api/products')
        .query({ search: prefix })
        .expect(200);
      assert.equal(products.body.total, 1);
      assert.deepEqual(products.body.items.map((item: { name: string }) => item.name), [
        `${prefix}_active`,
      ]);
      assert.ok(products.body.categories.includes(activeCategory));
      assert.ok(!products.body.categories.includes(inactiveOnlyCategory));

      const services = await request(ctx.app.getHttpServer())
        .get('/api/services')
        .query({ search: prefix })
        .expect(200);
      assert.equal(services.body.total, 1);
      assert.ok(services.body.categories.includes(activeCategory));
      assert.ok(!services.body.categories.includes(inactiveOnlyCategory));
    });

    it('returns nothing for a category that only inactive records use', async () => {
      const products = await request(ctx.app.getHttpServer())
        .get('/api/products')
        .query({ category: inactiveOnlyCategory })
        .expect(200);
      assert.equal(products.body.total, 0);
      assert.deepEqual(products.body.items, []);
    });

    it('still exposes inactive records and all categories to admins', async () => {
      const products = await request(ctx.app.getHttpServer())
        .get('/api/admin/products')
        .query({ search: prefix })
        .set('Cookie', session.cookie)
        .expect(200);
      assert.equal(products.body.total, 3);
      assert.ok(products.body.categories.includes(activeCategory));
      assert.ok(products.body.categories.includes(inactiveOnlyCategory));
    });
  });

  describe('image URL validation', () => {
    const suffix = randomUUID().slice(0, 8);

    function productBody(imageUrl: string, slug = `p3-image-${suffix}`): Record<string, unknown> {
      return {
        name: `__test_p3_image_${suffix}`,
        slug,
        description: 'Image URL validation fixture',
        category: 'Blouses',
        imageUrl,
      };
    }

    it('accepts only uploaded local image paths', async () => {
      for (const [index, imageUrl] of [
        `/uploads/products/${randomUUID()}.webp`,
        `/uploads/services/${randomUUID()}.png`,
      ].entries()) {
        const response = await request(ctx.app.getHttpServer())
          .post('/api/admin/products')
          .set(adminHeaders(session))
          .send(productBody(imageUrl, `p3-image-${suffix}-${index}`))
          .expect(201);
        assert.equal(response.body.imageUrl, imageUrl);
      }
    });

    it('rejects external, protocol-relative, unsafe and malformed URLs', async () => {
      const invalid = [
        'https://example.com/image.png',
        'http://localhost:3000/uploads/products/image.png',
        '//example.com/image.png',
        'javascript:alert(1)',
        'data:image/png;base64,AAAA',
        'file:///etc/passwd',
        '/assets/products/image.webp',
        `/uploads/products/../../etc/passwd`,
        `/uploads/products/..%2f..%2fetc%2fpasswd`,
        `/uploads/products/${randomUUID()}.svg`,
        `/uploads/products/${randomUUID()}.webp?x=1`,
        `/uploads/products/${randomUUID()}.webp#fragment`,
        ` /uploads/products/${randomUUID()}.webp`,
        // Filenames must be canonical UUIDs, not arbitrary safe-looking names.
        '/uploads/products/not-a-uuid.webp',
        '/uploads/products/photo.webp',
        `/uploads/products/${randomUUID().replace(/-/g, '')}.webp`,
        `/uploads/products/${randomUUID().slice(0, 35)}.webp`,
        `/uploads/products/${randomUUID()}-extra.webp`,
      ];

      for (const imageUrl of invalid) {
        const response = await request(ctx.app.getHttpServer())
          .post('/api/admin/products')
          .set(adminHeaders(session))
          .send(productBody(imageUrl))
          .expect(400);
        assert.match(response.body.message.join(' '), /imageUrl must be/i, imageUrl);
      }
    });

    it('rejects an imageFilename that is not a UUID file name', async () => {
      const response = await request(ctx.app.getHttpServer())
        .post('/api/admin/products')
        .set(adminHeaders(session))
        .send({
          ...productBody(`/uploads/products/${randomUUID()}.webp`),
          imageFilename: 'photo.webp',
        })
        .expect(400);
      assert.match(response.body.message.join(' '), /imageFilename must be/i);
    });

    it('applies the same rule to services and updates', async () => {
      await request(ctx.app.getHttpServer())
        .post('/api/admin/services')
        .set(adminHeaders(session))
        .send({
          name: `__test_p3_image_service_${suffix}`,
          slug: `p3-image-service-${suffix}`,
          description: 'Image URL validation fixture',
          category: 'Stitching',
          imageUrl: 'https://example.com/image.png',
        })
        .expect(400);

      const created = await request(ctx.app.getHttpServer())
        .post('/api/admin/services')
        .set(adminHeaders(session))
        .send({
          name: `__test_p3_image_service_${suffix}`,
          slug: `p3-image-service-${suffix}`,
          description: 'Image URL validation fixture',
          category: 'Stitching',
          imageUrl: `/uploads/services/${randomUUID()}.webp`,
        })
        .expect(201);

      await request(ctx.app.getHttpServer())
        .patch(`/api/admin/services/${created.body.id}`)
        .set(adminHeaders(session))
        .send({ imageUrl: '//example.com/image.png' })
        .expect(400);
    });
  });

  describe('upload lifecycle', () => {
    const suffix = randomUUID().slice(0, 8);

    function productFixture(name: string, slug: string, imageUrl: string) {
      return {
        name: `__test_p3_upload_${name}_${suffix}`,
        slug: `p3-upload-${slug}-${suffix}`,
        description: 'Upload lifecycle fixture',
        category: 'Blouses',
        imageUrl,
        imageFilename: imageUrl.split('/').pop(),
        price: null,
        displayOrder: 0,
        isActive: true,
      };
    }

    it('never deletes a shared file, even after the last reference is removed', async () => {
      const imageUrl = `/uploads/products/${randomUUID()}.webp`;
      await mkdir(join(uploadDir, 'products'), { recursive: true });
      await writeFile(storedPath(imageUrl), PNG);

      const first = await ctx.prisma.product.create({
        data: productFixture('shared_a', 'shared-a', imageUrl),
      });
      const second = await ctx.prisma.product.create({
        data: productFixture('shared_b', 'shared-b', imageUrl),
      });

      await request(ctx.app.getHttpServer())
        .delete(`/api/admin/products/${first.id}`)
        .set(adminHeaders(session))
        .expect(200);
      assert.equal(await exists(storedPath(imageUrl)), true);

      await request(ctx.app.getHttpServer())
        .delete(`/api/admin/products/${second.id}`)
        .set(adminHeaders(session))
        .expect(200);
      // Automatic deletion is deferred, so the orphan report can list it.
      assert.equal(await exists(storedPath(imageUrl)), true);
    });

    it('never deletes the old file on replacement', async () => {
      const sharedUrl = `/uploads/products/${randomUUID()}.webp`;
      await mkdir(join(uploadDir, 'products'), { recursive: true });
      await writeFile(storedPath(sharedUrl), PNG);

      const first = await ctx.prisma.product.create({
        data: productFixture('replace_a', 'replace-a', sharedUrl),
      });
      const second = await ctx.prisma.product.create({
        data: productFixture('replace_b', 'replace-b', sharedUrl),
      });

      const upload = await request(ctx.app.getHttpServer())
        .post('/api/admin/uploads/products')
        .set(adminHeaders(session))
        .attach('image', PNG, { filename: 'replacement.png', contentType: 'image/png' })
        .expect(201);

      await request(ctx.app.getHttpServer())
        .patch(`/api/admin/products/${first.id}`)
        .set(adminHeaders(session))
        .send({
          imageUrl: upload.body.imageUrl,
          imageFilename: upload.body.imageFilename,
        })
        .expect(200);
      assert.equal(await exists(storedPath(sharedUrl)), true);
      assert.equal(await exists(storedPath(upload.body.imageUrl)), true);

      // Removing the last reference leaves the file for the orphan report.
      await request(ctx.app.getHttpServer())
        .delete(`/api/admin/products/${second.id}`)
        .set(adminHeaders(session))
        .expect(200);
      assert.equal(await exists(storedPath(sharedUrl)), true);
    });

    it('does not delete a referenced image when a failed update is cleaned up', async () => {
      const sharedUrl = `/uploads/products/${randomUUID()}.webp`;
      await mkdir(join(uploadDir, 'products'), { recursive: true });
      await writeFile(storedPath(sharedUrl), PNG);

      const holder = await ctx.prisma.product.create({
        data: productFixture('failure_holder', 'failure-holder', sharedUrl),
      });
      const other = await ctx.prisma.product.create({
        data: productFixture(
          'failure_other',
          'failure-other',
          `/uploads/products/${randomUUID()}.webp`,
        ),
      });

      await request(ctx.app.getHttpServer())
        .patch(`/api/admin/products/${other.id}`)
        .set(adminHeaders(session))
        .send({ slug: holder.slug, imageUrl: sharedUrl })
        .expect(409);

      assert.equal(await exists(storedPath(sharedUrl)), true);
      const stored = await ctx.prisma.product.findUnique({ where: { id: holder.id } });
      assert.equal(stored?.imageUrl, sharedUrl);
    });

    it('reports orphan candidates without deleting anything', async () => {
      const orphanProduct = `/uploads/products/${randomUUID()}.webp`;
      const orphanService = `/uploads/services/${randomUUID()}.png`;
      const referenced = `/uploads/products/${randomUUID()}.webp`;

      await mkdir(join(uploadDir, 'products'), { recursive: true });
      await mkdir(join(uploadDir, 'services'), { recursive: true });
      await writeFile(storedPath(orphanProduct), PNG);
      await writeFile(storedPath(orphanService), PNG);
      await writeFile(storedPath(referenced), PNG);
      await writeFile(join(uploadDir, 'products', '.gitkeep'), '');
      // A directory must never be treated as a file.
      await mkdir(join(uploadDir, 'products', `${randomUUID()}.webp`));

      const product = await ctx.prisma.product.create({
        data: productFixture('orphan_ref', 'orphan-ref', referenced),
      });

      await request(ctx.app.getHttpServer())
        .get('/api/admin/uploads/orphans')
        .expect(401);

      const report = await request(ctx.app.getHttpServer())
        .get('/api/admin/uploads/orphans')
        .set('Cookie', session.cookie)
        .expect(200);

      assert.ok(report.body.candidates.includes(orphanProduct.replace('/uploads/', '')));
      assert.ok(report.body.candidates.includes(orphanService.replace('/uploads/', '')));
      assert.ok(!report.body.candidates.includes(referenced.replace('/uploads/', '')));
      assert.ok(!report.body.candidates.some((name: string) => name.includes('.gitkeep')));
      assert.equal(report.body.candidateCount, report.body.candidates.length);

      // Dry run only: every file is still on disk.
      assert.equal(await exists(storedPath(orphanProduct)), true);
      assert.equal(await exists(storedPath(orphanService)), true);
      assert.equal(await exists(storedPath(referenced)), true);

      // There is no public cleanup endpoint.
      await request(ctx.app.getHttpServer())
        .get('/api/uploads/orphans')
        .expect(404);

      await ctx.prisma.product.delete({ where: { id: product.id } });
    });
  });

  describe('authentication and CSRF', () => {
    it('stays in front of the limiter', async () => {
      await request(ctx.app.getHttpServer())
        .post('/api/admin/products')
        .send({})
        .expect(401);

      await request(ctx.app.getHttpServer())
        .post('/api/admin/products')
        .set('Cookie', session.cookie)
        .send({})
        .expect(403);
    });
  });

  describe('auth endpoint rate limits', () => {
    // Shared so the logout-all test can prove it has its own bucket while the
    // /me bucket for this IP is already exhausted.
    const sessionIp = nextIp();

    /** Creates a valid session row directly, avoiding bcrypt on every call. */
    async function seedSession(csrf: string): Promise<string> {
      const token = randomBytes(32).toString('base64url');
      const now = new Date();
      await ctx.prisma.session.create({
        data: {
          tokenHash: hashToken(token),
          csrfHash: hashToken(csrf),
          adminId: ctx.adminId,
          expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
          lastSeenAt: now,
        },
      });
      return `${SESSION_COOKIE}=${token}; ${CSRF_COOKIE}=${csrf}`;
    }

    it('limits GET /api/auth/me while login keeps its 5/min policy', async () => {
      for (let i = 0; i < RATE_LIMITS.session.limit; i += 1) {
        await request(ctx.app.getHttpServer())
          .get('/api/auth/me')
          .set('Cookie', session.cookie)
          .set('X-Forwarded-For', sessionIp)
          .expect(200);
      }

      const blocked = await request(ctx.app.getHttpServer())
        .get('/api/auth/me')
        .set('Cookie', session.cookie)
        .set('X-Forwarded-For', sessionIp)
        .expect(429);
      assert.deepEqual(blocked.body, {
        statusCode: 429,
        message: 'Too many requests',
      });
      assert.equal(blocked.headers['x-ratelimit-limit'], undefined);
      assert.equal(blocked.headers['retry-after'], undefined);

      // Login still has its own stricter bucket.
      const loginIp = nextIp();
      const identifier = `nobody-${randomUUID().slice(0, 8)}`;
      const login = () =>
        request(ctx.app.getHttpServer())
          .post('/api/auth/login')
          .set('X-Forwarded-For', loginIp)
          .set('Origin', adminOrigin())
          .send({ identifier, password: 'wrong-password' });
      for (let i = 0; i < RATE_LIMITS.login.limit; i += 1) {
        await login().expect(401);
      }
      await login().expect(429);
    });

    it('limits POST /api/auth/logout and still signs out normally', async () => {
      const ip = nextIp();
      for (let i = 0; i < RATE_LIMITS.session.limit; i += 1) {
        const csrf = `csrf-${randomUUID()}`;
        const cookie = await seedSession(csrf);
        await request(ctx.app.getHttpServer())
          .post('/api/auth/logout')
          .set('Cookie', cookie)
          .set(CSRF_HEADER, csrf)
          .set('X-Forwarded-For', ip)
          .expect(200);
      }

      const csrf = `csrf-${randomUUID()}`;
      const cookie = await seedSession(csrf);
      await request(ctx.app.getHttpServer())
        .post('/api/auth/logout')
        .set('Cookie', cookie)
        .set(CSRF_HEADER, csrf)
        .set('X-Forwarded-For', ip)
        .expect(429);
    });

    it('lets logout-all through when the /me bucket is exhausted', async () => {
      const csrf = `csrf-${randomUUID()}`;
      const cookie = await seedSession(csrf);

      await request(ctx.app.getHttpServer())
        .post('/api/auth/logout-all')
        .set('Cookie', cookie)
        .set(CSRF_HEADER, csrf)
        .set('X-Forwarded-For', sessionIp)
        .expect(200);

      const remaining = await ctx.prisma.session.count({
        where: { adminId: ctx.adminId },
      });
      assert.equal(remaining, 0);
    });

    it('limits POST /api/auth/logout-all while normal sign-out everywhere works', async () => {
      const ip = nextIp();
      const logoutAll = (csrf: string, cookie: string) =>
        request(ctx.app.getHttpServer())
          .post('/api/auth/logout-all')
          .set('Cookie', cookie)
          .set(CSRF_HEADER, csrf)
          .set('X-Forwarded-For', ip);

      for (let i = 0; i < RATE_LIMITS.session.limit; i += 1) {
        const csrf = `csrf-${randomUUID()}`;
        const cookie = await seedSession(csrf);
        await logoutAll(csrf, cookie).expect(200);

        const remaining = await ctx.prisma.session.count({
          where: { adminId: ctx.adminId },
        });
        assert.equal(remaining, 0);
      }

      const csrf = `csrf-${randomUUID()}`;
      const cookie = await seedSession(csrf);
      await logoutAll(csrf, cookie).expect(429);

      // The blocked request did not revoke the seeded session.
      const remaining = await ctx.prisma.session.count({
        where: { adminId: ctx.adminId },
      });
      assert.equal(remaining, 1);
      await ctx.prisma.session.deleteMany({ where: { adminId: ctx.adminId } });
    });
  });
});
