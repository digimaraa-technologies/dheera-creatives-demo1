import assert from 'node:assert/strict';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { serveUploads } from '../src/uploads/uploads.static';
import {
  AdminSession,
  TestContext,
  adminHeaders,
  createTestContext,
} from './helpers/admin-session';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]);
const AVIF = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypavif'), Buffer.alloc(8)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML = Buffer.from('<html><body>not an image</body></html>');

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe('Uploads API (e2e)', () => {
  let ctx: TestContext;
  let session: AdminSession;
  let uploadDir: string;

  before(async () => {
    uploadDir = await mkdtemp(join(tmpdir(), 'dheera-uploads-'));
    ctx = await createTestContext({ uploadDir, serveUploads: true });
    session = await ctx.login();
  });

  after(async () => {
    await ctx.prisma.product.deleteMany({ where: { name: { startsWith: '__test_upload_' } } });
    await ctx.close();
    await rm(uploadDir, { recursive: true, force: true });
  });

  function upload(
    folder: 'products' | 'services',
    buffer: Buffer,
    filename: string,
    contentType: string,
  ): request.Test {
    return request(ctx.app.getHttpServer())
      .post(`/api/admin/uploads/${folder}`)
      .set(adminHeaders(session))
      .attach('image', buffer, { filename, contentType });
  }

  async function uploadPng(folder: 'products' | 'services' = 'products') {
    const response = await upload(folder, PNG, 'photo.png', 'image/png').expect(201);
    return response.body as { imageUrl: string; imageFilename: string };
  }

  function storedPath(imageUrl: string): string {
    return join(uploadDir, ...imageUrl.replace('/uploads/', '').split('/'));
  }

  it('rejects unauthenticated uploads', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/admin/uploads/products')
      .attach('image', PNG, { filename: 'photo.png', contentType: 'image/png' })
      .expect(401);
  });

  it('rejects a request without a file', async () => {
    const response = await request(ctx.app.getHttpServer())
      .post('/api/admin/uploads/products')
      .set(adminHeaders(session))
      .expect(400);

    assert.match(response.body.message, /image file is required/i);
  });

  it('stores a valid image under a generated filename', async () => {
    const body = await uploadPng();

    assert.match(body.imageFilename, /^[0-9a-f-]{36}\.png$/);
    assert.equal(body.imageUrl, `/uploads/products/${body.imageFilename}`);
    assert.ok(await exists(storedPath(body.imageUrl)));

    const second = await uploadPng();
    assert.notEqual(second.imageFilename, body.imageFilename);
  });

  it('accepts JPEG, WebP and AVIF signatures', async () => {
    const jpeg = await upload('products', JPEG, 'photo.jpg', 'image/jpeg').expect(201);
    assert.match(jpeg.body.imageFilename, /\.jpg$/);

    const webp = await upload('products', WEBP, 'photo.webp', 'image/webp').expect(201);
    assert.match(webp.body.imageFilename, /\.webp$/);

    const avif = await upload('services', AVIF, 'photo.avif', 'image/avif').expect(201);
    assert.match(avif.body.imageFilename, /\.avif$/);
    assert.ok(await exists(storedPath(avif.body.imageUrl)));
  });

  it('rejects unsupported MIME types', async () => {
    await upload('products', Buffer.from('plain text'), 'notes.txt', 'text/plain').expect(400);
  });

  it('rejects files whose bytes do not match the declared image type', async () => {
    const response = await upload('products', HTML, 'fake.png', 'image/png').expect(400);
    assert.match(response.body.message, /Unsupported image content/i);
  });

  it('rejects SVG uploads', async () => {
    await upload('products', SVG, 'icon.svg', 'image/svg+xml').expect(400);
  });

  it('rejects files larger than 5 MB', async () => {
    await upload(
      'products',
      Buffer.alloc(5 * 1024 * 1024 + 1),
      'huge.png',
      'image/png',
    ).expect(413);
  });

  it('serves uploaded images with safe headers', async () => {
    const body = await uploadPng();

    const response = await request(ctx.app.getHttpServer()).get(body.imageUrl).expect(200);
    assert.match(response.headers['content-type'], /^image\/png/);
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.match(response.headers['cache-control'], /max-age=/);
  });

  it('does not list the upload directory or serve outside it', async () => {
    await request(ctx.app.getHttpServer()).get('/uploads/products').expect(404);
    await request(ctx.app.getHttpServer()).get('/uploads/products/').expect(404);
    await request(ctx.app.getHttpServer()).get('/uploads/%2e%2e%2f.env').expect(404);
    await request(ctx.app.getHttpServer()).get('/uploads/../.env').expect(404);
  });

  it('keeps replaced and deleted files and reports them as orphans', async () => {
    const first = await uploadPng();
    const name = `__test_upload_replace_${randomUUID().slice(0, 6)}`;
    const created = await request(ctx.app.getHttpServer())
      .post('/api/admin/products')
      .set(adminHeaders(session))
      .send({
        name,
        description: 'Replacement test',
        category: 'Blouses',
        imageUrl: first.imageUrl,
        imageFilename: first.imageFilename,
        price: 100,
      })
      .expect(201);

    const second = await uploadPng();
    await request(ctx.app.getHttpServer())
      .patch(`/api/admin/products/${created.body.id}`)
      .set(adminHeaders(session))
      .send({ imageUrl: second.imageUrl, imageFilename: second.imageFilename })
      .expect(200);

    // Cleanup is deferred, so the replaced file stays on disk.
    assert.ok(await exists(storedPath(first.imageUrl)));
    assert.ok(await exists(storedPath(second.imageUrl)));

    const stored = await ctx.prisma.product.findUnique({ where: { id: created.body.id } });
    assert.equal(stored?.imageFilename, second.imageFilename);

    // Deleting the record also leaves the file for the orphan report.
    await request(ctx.app.getHttpServer())
      .delete(`/api/admin/products/${created.body.id}`)
      .set(adminHeaders(session))
      .expect(200);
    assert.ok(await exists(storedPath(second.imageUrl)));

    const report = await request(ctx.app.getHttpServer())
      .get('/api/admin/uploads/orphans')
      .set('Cookie', session.cookie)
      .expect(200);
    const candidates: string[] = report.body.candidates;
    assert.ok(candidates.includes(first.imageUrl.replace('/uploads/', '')));
    assert.ok(candidates.includes(second.imageUrl.replace('/uploads/', '')));
  });

  it('keeps the new upload when the database update fails (cleanup deferred)', async () => {
    const first = await uploadPng();
    const takenSlug = `test-upload-taken-${randomUUID().slice(0, 6)}`;

    const product = await request(ctx.app.getHttpServer())
      .post('/api/admin/products')
      .set(adminHeaders(session))
      .send({
        name: `__test_upload_failure_${randomUUID().slice(0, 6)}`,
        slug: takenSlug,
        description: 'Failure cleanup test',
        category: 'Blouses',
        imageUrl: first.imageUrl,
        imageFilename: first.imageFilename,
      })
      .expect(201);

    await request(ctx.app.getHttpServer())
      .post('/api/admin/products')
      .set(adminHeaders(session))
      .send({
        name: `__test_upload_other_${randomUUID().slice(0, 6)}`,
        slug: `${takenSlug}-other`,
        description: 'Holds the conflicting slug',
        category: 'Blouses',
        imageUrl: '/uploads/products/00000000-0000-0000-0000-000000000000.png',
      })
      .expect(201);

    const pending = await uploadPng();
    await request(ctx.app.getHttpServer())
      .patch(`/api/admin/products/${product.body.id}`)
      .set(adminHeaders(session))
      .send({
        slug: `${takenSlug}-other`,
        imageUrl: pending.imageUrl,
        imageFilename: pending.imageFilename,
      })
      .expect(409);

    assert.ok(await exists(storedPath(pending.imageUrl)));
    // The old image is untouched because the update never happened.
    assert.ok(await exists(storedPath(first.imageUrl)));

    const stored = await ctx.prisma.product.findUnique({ where: { id: product.body.id } });
    assert.equal(stored?.imageUrl, first.imageUrl);
  });

  it('keeps the new upload when the database create fails (cleanup deferred)', async () => {
    const takenSlug = `test-upload-create-${randomUUID().slice(0, 6)}`;

    await request(ctx.app.getHttpServer())
      .post('/api/admin/products')
      .set(adminHeaders(session))
      .send({
        name: `__test_upload_create_${randomUUID().slice(0, 6)}`,
        slug: takenSlug,
        description: 'Holds the conflicting slug',
        category: 'Blouses',
        imageUrl: '/uploads/products/00000000-0000-0000-0000-000000000000.png',
      })
      .expect(201);

    const pending = await uploadPng();
    await request(ctx.app.getHttpServer())
      .post('/api/admin/products')
      .set(adminHeaders(session))
      .send({
        name: `__test_upload_create_other_${randomUUID().slice(0, 6)}`,
        slug: takenSlug,
        description: 'Create cleanup test',
        category: 'Blouses',
        imageUrl: pending.imageUrl,
        imageFilename: pending.imageFilename,
      })
      .expect(409);

    assert.ok(await exists(storedPath(pending.imageUrl)));
  });

  it('accepts uploads for services', async () => {
    const body = await uploadPng('services');
    assert.match(body.imageUrl, /^\/uploads\/services\/[0-9a-f-]{36}\.png$/);
    assert.ok(await exists(storedPath(body.imageUrl)));
  });

  it('does not create the upload directory at startup in production', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousUploadDir = process.env.UPLOAD_DIR;
    const unavailable = join(tmpdir(), `dheera-prod-uploads-${randomUUID()}`);
    process.env.NODE_ENV = 'production';
    process.env.UPLOAD_DIR = unavailable;
    try {
      serveUploads({ use: () => undefined } as unknown as NestExpressApplication);
      assert.equal(existsSync(unavailable), false);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR;
      else process.env.UPLOAD_DIR = previousUploadDir;
      rmSync(unavailable, { recursive: true, force: true });
    }
  });

  it('keeps upload endpoints disabled in production', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const response = await upload('products', PNG, 'photo.png', 'image/png').expect(503);
      assert.match(response.body.message, /Durable image storage is not configured/i);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });
});
