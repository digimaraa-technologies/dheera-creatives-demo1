import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { TestContext, createTestContext } from './helpers/admin-session';

interface CatalogItem {
  type: 'product' | 'service';
  id: string;
  name: string;
  description: string;
  category: string;
  imageUrl: string;
  price: number | null;
  displayOrder: number;
}

interface CatalogOutcome {
  mode: 'render' | 'empty' | 'fallback';
  items: CatalogItem[];
  useFallback: boolean;
}

interface CatalogCore {
  safeImageUrl(value: unknown, origin?: string): string;
  formatPrice(value: unknown): string;
  normalizeItems(items: unknown, type: string, origin?: string): CatalogItem[];
  compareItems(a: CatalogItem, b: CatalogItem): number;
  resolveCatalog(input: {
    origin?: string;
    products?: { ok: boolean; items: unknown };
    services?: { ok: boolean; items: unknown };
    hasFallback?: boolean;
  }): CatalogOutcome;
  buildWhatsAppUrl(options: {
    whatsapp?: unknown;
    template?: string;
    name?: string;
    url?: string;
  }): string;
}

// The browser helper is a plain UMD script, so the Node test runner can load
// it directly without a DOM or a build step.
const core = require(join(process.cwd(), 'public', 'catalog-core.js')) as CatalogCore;

const ORIGIN = 'http://localhost:3000';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('Public catalogue helpers', () => {
  it('keeps only same-origin uploads and bundled assets', () => {
    assert.equal(core.safeImageUrl('/uploads/products/a.png', ORIGIN), '/uploads/products/a.png');
    assert.equal(core.safeImageUrl('  /assets/logo.svg  ', ORIGIN), '/assets/logo.svg');
    assert.equal(
      core.safeImageUrl('http://localhost:3000/uploads/products/a.png?x=1', ORIGIN),
      '/uploads/products/a.png?x=1',
    );

    for (const value of [
      'https://evil.example/uploads/a.png',
      '//evil.example/uploads/a.png',
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      '/api/admin/products',
      '/uploads/../.env',
      '',
      null,
      42,
    ]) {
      assert.equal(core.safeImageUrl(value, ORIGIN), '', String(value));
    }
  });

  it('formats optional prices and ignores missing ones', () => {
    assert.equal(core.formatPrice(1250.5), '₹1,250.5');
    assert.equal(core.formatPrice(0), '₹0');
    assert.equal(core.formatPrice(null), '');
    assert.equal(core.formatPrice(Number.NaN), '');
  });

  it('normalizes fields, drops inactive records and sorts by displayOrder', () => {
    const items = core.normalizeItems(
      [
        { id: 2, name: ' Later ', description: null, category: 'C', imageUrl: '/uploads/p/2.png', price: '99.5', displayOrder: 4, isActive: true },
        { id: 1, name: 'First', description: 'Desc', category: 'C', imageUrl: '/uploads/p/1.png', price: null, displayOrder: 1, isActive: true },
        { id: 3, name: 'Hidden', displayOrder: 0, isActive: false },
        { id: 4, name: '   ', displayOrder: 0, isActive: true },
        { id: 5, name: 'External', imageUrl: 'https://evil.example/x.png', displayOrder: 2, isActive: true },
      ],
      'product',
      ORIGIN,
    );
    items.sort(core.compareItems);

    assert.deepEqual(items.map((item) => item.name), ['First', 'External', 'Later']);
    assert.equal(items[2].description, '');
    assert.equal(items[2].price, 99.5);
    assert.equal(items[1].imageUrl, '');
    assert.equal(items[0].type, 'product');
  });

  it('resolves live, empty, failed and partially failed responses', () => {
    const product = { name: 'Product', displayOrder: 2, isActive: true };
    const service = { name: 'Service', displayOrder: 1, isActive: true };

    const live = core.resolveCatalog({
      origin: ORIGIN,
      products: { ok: true, items: [product] },
      services: { ok: true, items: [service] },
      hasFallback: true,
    });
    assert.equal(live.mode, 'render');
    assert.deepEqual(live.items.map((item) => item.name), ['Service', 'Product']);
    assert.equal(live.useFallback, false);

    const empty = core.resolveCatalog({
      products: { ok: true, items: [] },
      services: { ok: true, items: [] },
      hasFallback: true,
    });
    assert.equal(empty.mode, 'empty');

    const failed = core.resolveCatalog({
      products: { ok: false, items: [] },
      services: { ok: false, items: [] },
      hasFallback: true,
    });
    assert.equal(failed.mode, 'fallback');

    const partial = core.resolveCatalog({
      products: { ok: false, items: [] },
      services: { ok: true, items: [service] },
      hasFallback: true,
    });
    assert.equal(partial.mode, 'render');
    assert.equal(partial.useFallback, true);
    assert.deepEqual(partial.items.map((item) => item.name), ['Service']);
  });

  it('encodes the WhatsApp enquiry message safely', () => {
    const url = core.buildWhatsAppUrl({
      whatsapp: '+91 72002 51560',
      template: 'Enquire about {name}: {url}',
      name: 'Silk & Gold "Blouse"',
      url: 'http://localhost:3000/uploads/products/a.png',
    });

    assert.ok(url.startsWith('https://wa.me/917200251560?text='));
    const message = decodeURIComponent(url.split('text=')[1]);
    assert.equal(message, 'Enquire about Silk & Gold "Blouse": http://localhost:3000/uploads/products/a.png');
    assert.equal(core.buildWhatsAppUrl({ whatsapp: '' }), '');
  });
});

describe('Public catalogue integration (e2e)', () => {
  let ctx: TestContext;
  let uploadDir: string;
  let productId: string;
  let serviceId: string;
  let imageUrl: string;

  const suffix = randomUUID().slice(0, 8);
  const productName = `__test_public_product_${suffix}`;
  const serviceName = `__test_public_service_${suffix}`;

  before(async () => {
    uploadDir = await mkdtemp(join(tmpdir(), 'dheera-public-'));
    ctx = await createTestContext({ uploadDir, serveUploads: true, servePublic: true });

    await mkdir(join(uploadDir, 'products'), { recursive: true });
    const filename = `${randomUUID()}.png`;
    await writeFile(join(uploadDir, 'products', filename), PNG);
    imageUrl = `/uploads/products/${filename}`;

    const product = await ctx.prisma.product.create({
      data: {
        name: productName,
        slug: `public-product-${suffix}`,
        description: 'Hand-embroidered blouse',
        category: 'Blouses',
        imageUrl,
        imageFilename: filename,
        price: 1250.5,
        displayOrder: 1,
        isActive: true,
      },
    });
    productId = product.id;

    await ctx.prisma.product.create({
      data: {
        name: `__test_public_inactive_${suffix}`,
        slug: `public-inactive-${suffix}`,
        description: 'Hidden product',
        category: 'Blouses',
        imageUrl: '',
        price: null,
        displayOrder: 0,
        isActive: false,
      },
    });

    const service = await ctx.prisma.service.create({
      data: {
        name: serviceName,
        slug: `public-service-${suffix}`,
        description: 'Custom stitching',
        category: 'Stitching',
        imageUrl: '',
        price: null,
        displayOrder: 2,
        isActive: true,
      },
    });
    serviceId = service.id;
  });

  after(async () => {
    await ctx.prisma.product.deleteMany({ where: { name: { startsWith: '__test_public_' } } });
    await ctx.prisma.service.deleteMany({ where: { name: { startsWith: '__test_public_' } } });
    await ctx.close();
    await rm(uploadDir, { recursive: true, force: true });
  });

  it('serves the catalogue script and the static fallback grid', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/').expect(200);

    assert.ok(res.text.includes('catalog-core.js'));
    assert.ok(res.text.includes('class="collections-grid"'));
    assert.equal(res.text.match(/class="collection-card"/g)?.length, 6);
    assert.equal(res.text.match(/class="gallery-item"/g)?.length, 24);

    const script = await request(ctx.app.getHttpServer()).get('/catalog-core.js').expect(200);
    assert.match(script.headers['content-type'], /javascript/);
    assert.ok(script.text.includes('resolveCatalog'));

    const siteScript = await request(ctx.app.getHttpServer()).get('/script.js').expect(200);
    assert.ok(siteScript.text.includes('/api/products?pageSize=100'));
    assert.ok(siteScript.text.includes('/api/services?pageSize=100'));
  });

  it('returns the active product and service in displayOrder', async () => {
    const products = await request(ctx.app.getHttpServer())
      .get('/api/products')
      .query({ pageSize: 100 })
      .expect(200);
    const services = await request(ctx.app.getHttpServer())
      .get('/api/services')
      .query({ pageSize: 100 })
      .expect(200);

    const product = products.body.items.find((item: { name: string }) => item.name === productName);
    assert.ok(product, 'created product must be public');
    assert.equal(product.imageUrl, imageUrl);
    assert.equal(product.price, 1250.5);
    assert.equal(product.isActive, true);

    assert.ok(
      !products.body.items.some((item: { name: string }) => item.name.startsWith('__test_public_inactive_')),
      'inactive products must not be public',
    );
    assert.ok(services.body.items.some((item: { name: string }) => item.name === serviceName));

    const outcome = core.resolveCatalog({
      origin: ORIGIN,
      products: { ok: true, items: products.body.items },
      services: { ok: true, items: services.body.items },
      hasFallback: true,
    });

    const names = outcome.items.map((item) => item.name);
    const productIndex = names.indexOf(productName);
    const serviceIndex = names.indexOf(serviceName);
    assert.ok(productIndex >= 0 && serviceIndex >= 0);
    assert.ok(productIndex < serviceIndex, 'displayOrder 1 must render before displayOrder 2');
  });

  it('serves the uploaded image at the URL stored in the database', async () => {
    const res = await request(ctx.app.getHttpServer()).get(imageUrl).expect(200);

    assert.match(res.headers['content-type'], /image\/png/);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.ok(Number(res.headers['content-length']) > 0);
  });

  it('hides records as soon as they are deactivated', async () => {
    await ctx.prisma.product.update({ where: { id: productId }, data: { isActive: false } });
    await ctx.prisma.service.update({ where: { id: serviceId }, data: { isActive: false } });

    const products = await request(ctx.app.getHttpServer())
      .get('/api/products')
      .query({ pageSize: 100 })
      .expect(200);
    const services = await request(ctx.app.getHttpServer())
      .get('/api/services')
      .query({ pageSize: 100 })
      .expect(200);

    assert.ok(!products.body.items.some((item: { name: string }) => item.name === productName));
    assert.ok(!services.body.items.some((item: { name: string }) => item.name === serviceName));
  });
});
