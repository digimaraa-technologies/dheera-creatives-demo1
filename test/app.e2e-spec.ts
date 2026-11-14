import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';

const PUBLIC_DIR = join(process.cwd(), 'public');

describe('Static site (e2e)', () => {
  let app: NestExpressApplication;

  before(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.useStaticAssets(PUBLIC_DIR, { index: 'index.html' });
    await app.init();
  });

  after(async () => {
    await app.close();
  });

  it('serves the homepage at /', async () => {
    const res = await request(app.getHttpServer()).get('/').expect(200);

    assert.match(res.headers['content-type'], /text\/html/);
    assert.ok(
      res.text.includes(
        '<title>Dheera Creatives | Aari Embroidery & Custom Stitching</title>',
      ),
    );
    assert.ok(res.text.includes('Every Stitch Tells Your Story.'));
    assert.match(res.text, /<h1 class="hero-title">/);
    assert.equal(res.text.match(/class="gallery-item"/g)?.length, 24);
    assert.ok(res.text.includes('id="lightbox"'));
    assert.ok(res.text.includes('id="enquiryForm"'));
  });

  it('serves the homepage byte-for-byte from public/index.html', async () => {
    const res = await request(app.getHttpServer()).get('/').expect(200);
    const file = readFileSync(join(PUBLIC_DIR, 'index.html'), 'utf8');

    assert.equal(res.text, file);
  });

  const textAssets = [
    ['/styles.css', 'text/css', '--color-evergreen: #01200f;'],
    ['/script.js', 'javascript', 'function initGallery()'],
    ['/config.js', 'javascript', 'const siteConfig'],
    ['/manifest.json', 'json', '"start_url": "/"'],
    ['/robots.txt', 'text/plain', 'Sitemap: https://dheera.digimaraa.in/sitemap.xml'],
    ['/sitemap.xml', 'xml', '<loc>https://dheera.digimaraa.in/</loc>'],
  ] as const;

  for (const [path, contentType, body] of textAssets) {
    it(`serves ${path}`, async () => {
      const res = await request(app.getHttpServer()).get(path).expect(200);

      assert.match(res.headers['content-type'], new RegExp(contentType));
      assert.ok(res.text.includes(body));
    });
  }

  const binaryAssets = [
    ['/assets/embroidery/aari-embroidery-design-01.webp', 'image/webp'],
    ['/assets/embroidery/thumbs/aari-embroidery-design-24.webp', 'image/webp'],
    ['/assets/products/aari-embroidery-collection-1.webp', 'image/webp'],
    ['/assets/logo/og-image.jpg', 'image/jpeg'],
    ['/assets/icons/favicon.ico', 'image/'],
  ] as const;

  for (const [path, contentType] of binaryAssets) {
    it(`serves asset ${path}`, async () => {
      const res = await request(app.getHttpServer()).get(path).expect(200);

      assert.match(res.headers['content-type'], new RegExp(contentType));
      assert.ok(Number(res.headers['content-length']) > 0);
    });
  }

  it('returns 404 for unknown routes', async () => {
    await request(app.getHttpServer()).get('/does-not-exist').expect(404);
  });

  for (const path of [
    '/package.json',
    '/src/main.ts',
    '/.env',
    '/README.md',
    '/tsconfig.json',
  ]) {
    it(`does not expose server files at ${path}`, async () => {
      await request(app.getHttpServer()).get(path).expect(404);
    });
  }
});
