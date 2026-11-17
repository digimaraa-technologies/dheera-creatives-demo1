import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it, mock } from 'node:test';
import { Logger } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import express from 'express';
import request from 'supertest';
import { serveAdmin } from '../src/admin/admin.static';
import { AppModule } from '../src/app.module';
import { CSRF_HEADER } from '../src/auth/auth.cookies';
import {
  LOGIN_ATTEMPT_CAPACITY,
  LOGIN_ATTEMPT_MAX_FAILURES,
  LOGIN_ATTEMPT_WINDOW_MS,
  LoginAttemptsService,
} from '../src/auth/login-attempts.service';
import { PrismaExceptionFilter } from '../src/common/prisma-exception.filter';
import { hardenApp, securityHeaders } from '../src/common/security-headers';
import { validateEnvironment } from '../src/config/env.validation';
import { TEST_PASSWORD, adminOrigin, createTestContext, type TestContext } from './helpers/admin-session';

const PUBLIC_DIR = join(process.cwd(), 'public');
const ADMIN_INDEX = join(process.cwd(), 'admin', 'dist', 'index.html');
const LOGIN = '/api/auth/login';
const skipWithoutAdminBuild = !existsSync(ADMIN_INDEX) && 'admin/dist is not built';

describe('Security headers and input bounds (e2e)', () => {
  let app: NestExpressApplication;

  before(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    hardenApp(app, { isProduction: false, trustProxy: 0 });
    app.useStaticAssets(PUBLIC_DIR, { index: 'index.html' });
    serveAdmin(app);
    await app.init();
  });

  after(async () => {
    await app.close();
  });

  it('sends clickjacking, sniffing and CSP headers on the public page', async () => {
    const response = await request(app.getHttpServer()).get('/').expect(200);

    assert.equal(response.headers['x-frame-options'], 'DENY');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.match(
      response.headers['content-security-policy'],
      /frame-ancestors 'none'/,
    );
    assert.match(response.headers['content-security-policy'], /script-src 'self'/);
    assert.equal(response.headers['x-powered-by'], undefined);
    assert.equal(response.headers['strict-transport-security'], undefined);
  });

  it('uses a locked-down CSP for API responses', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/products')
      .expect(200);

    assert.match(
      response.headers['content-security-policy'],
      /default-src 'none'/,
    );
    assert.equal(response.headers['cache-control'], 'no-store');
  });

  it('serves an unauthenticated liveness probe without private data', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);

    assert.deepEqual(response.body, { status: 'ok' });
    assert.equal(response.headers['cache-control'], 'no-store');
  });

  it(
    'serves the admin SPA at /admin with its own CSP',
    { skip: skipWithoutAdminBuild },
    async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/login')
        .expect(200);

      assert.match(response.headers['content-type'], /text\/html/);
      assert.equal(response.headers['x-frame-options'], 'DENY');
      assert.match(
        response.headers['content-security-policy'],
        /img-src 'self' data: blob:/,
      );
      assert.match(response.text, /Dheera Creatives Admin/);
      assert.equal(response.headers['cache-control'], 'no-store');
    },
  );

  it(
    'keeps missing admin assets as 404',
    { skip: skipWithoutAdminBuild },
    async () => {
      await request(app.getHttpServer())
        .get('/admin/assets/missing-file.js')
        .expect(404);
    },
  );

  it('adds HSTS and upgrade-insecure-requests only in production', async () => {
    const production = express();
    production.use(securityHeaders(true));
    production.get('/', (_request, response) => {
      response.send('ok');
    });

    const productionResponse = await request(production).get('/').expect(200);
    assert.match(
      productionResponse.headers['strict-transport-security'],
      /max-age=31536000/,
    );
    assert.match(
      productionResponse.headers['content-security-policy'],
      /upgrade-insecure-requests/,
    );

    const development = express();
    development.use(securityHeaders(false));
    development.get('/', (_request, response) => {
      response.send('ok');
    });

    const developmentResponse = await request(development).get('/').expect(200);
    assert.equal(developmentResponse.headers['strict-transport-security'], undefined);
    assert.doesNotMatch(
      developmentResponse.headers['content-security-policy'],
      /upgrade-insecure-requests/,
    );
  });

  it('rejects out-of-range pagination', async () => {
    await request(app.getHttpServer())
      .get('/api/products?page=100001')
      .expect(400);
  });

  it('rejects control characters in search and category', async () => {
    await request(app.getHttpServer())
      .get('/api/products?search=a%00b')
      .expect(400);

    await request(app.getHttpServer())
      .get('/api/products?category=a%01b')
      .expect(400);
  });
});

describe('Admin hardening (e2e)', () => {
  let context: TestContext;

  before(async () => {
    context = await createTestContext();
  });

  after(async () => {
    await context.close();
  });

  it('blocks anonymous access to admin endpoints', async () => {
    await request(context.app.getHttpServer())
      .get('/api/admin/products')
      .expect(401);
  });

  it('rejects reorder positions above the integer column range', async () => {
    const session = await context.login();

    await request(context.app.getHttpServer())
      .patch('/api/admin/products/reorder')
      .set('Cookie', session.cookie)
      .set(CSRF_HEADER, session.csrf)
      .send({ items: [{ id: randomUUID(), displayOrder: 2_147_483_648 }] })
      .expect(400);
  });

  // Last: it deliberately locks the account for the rest of the process.
  it('locks an account after 20 failures even from rotating IPs', async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await request(context.app.getHttpServer())
        .post(LOGIN)
        .set('X-Forwarded-For', `10.9.0.${attempt + 1}`)
        .set('Origin', adminOrigin())
        .send({ identifier: context.username, password: 'wrong-password' })
        .expect(401);
    }

    await request(context.app.getHttpServer())
      .post(LOGIN)
      .set('X-Forwarded-For', '10.9.9.9')
      .set('Origin', adminOrigin())
      .send({ identifier: context.username, password: 'wrong-password' })
      .expect(429);

    // The lock also rejects the correct password, so guessing cannot continue.
    await request(context.app.getHttpServer())
      .post(LOGIN)
      .set('X-Forwarded-For', '10.9.9.10')
      .set('Origin', adminOrigin())
      .send({ identifier: context.username, password: TEST_PASSWORD })
      .expect(429);
  });
});

describe('LoginAttemptsService', () => {
  it('locks after 20 failures and unlocks on reset', () => {
    const attempts = new LoginAttemptsService();

    for (let failure = 0; failure < 19; failure += 1) {
      attempts.recordFailure('admin');
    }
    attempts.assertAllowed('admin');

    attempts.recordFailure('admin');
    assert.throws(() => attempts.assertAllowed('admin'), /Too many failed/);

    attempts.reset('admin');
    attempts.assertAllowed('admin');
  });

  it('resets the failure count after a successful login', () => {
    const attempts = new LoginAttemptsService();

    for (let failure = 0; failure < 19; failure += 1) {
      attempts.recordFailure('admin');
    }
    attempts.reset('admin');
    attempts.recordFailure('admin');

    attempts.assertAllowed('admin');
  });

  it('drops an identifier once the 15 minute window has passed', () => {
    mock.timers.enable({ apis: ['Date'] });
    try {
      const attempts = new LoginAttemptsService();

      for (let failure = 0; failure < LOGIN_ATTEMPT_MAX_FAILURES; failure += 1) {
        attempts.recordFailure('admin');
      }
      assert.throws(() => attempts.assertAllowed('admin'), /Too many failed/);

      mock.timers.tick(LOGIN_ATTEMPT_WINDOW_MS + 1);

      attempts.assertAllowed('admin');
      assert.equal(attempts.trackedCount, 0);
    } finally {
      mock.timers.reset();
    }
  });

  it('bounds the number of tracked identifiers', () => {
    const attempts = new LoginAttemptsService();

    for (let index = 0; index < LOGIN_ATTEMPT_CAPACITY; index += 1) {
      attempts.recordFailure(`user-${index}`);
    }
    assert.equal(attempts.trackedCount, LOGIN_ATTEMPT_CAPACITY);

    // A failure for an untracked identifier is refused, not dropped, and does
    // not evict an existing counter.
    assert.throws(() => attempts.recordFailure('one-too-many'), /Too many failed/);
    assert.equal(attempts.trackedCount, LOGIN_ATTEMPT_CAPACITY);
  });

  it('keeps account protection and successful logins working at capacity', () => {
    const attempts = new LoginAttemptsService();

    for (let index = 0; index < LOGIN_ATTEMPT_CAPACITY; index += 1) {
      attempts.recordFailure(`user-${index}`);
    }

    // A tracked identifier still reaches the 20-failure lock.
    for (let failure = 1; failure < LOGIN_ATTEMPT_MAX_FAILURES; failure += 1) {
      attempts.recordFailure('user-0');
    }
    assert.throws(() => attempts.assertAllowed('user-0'), /Too many failed/);

    // A successful login does not need a new entry, so capacity cannot block it.
    attempts.assertAllowed('untracked-user');
  });
});

describe('validateEnvironment', () => {
  const DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';

  it('applies development defaults', () => {
    const config = validateEnvironment({ DATABASE_URL });

    assert.equal(config.NODE_ENV, 'development');
    assert.equal(config.TRUST_PROXY, 0);
    assert.equal(config.BIND_HOST, '0.0.0.0');
    assert.equal(config.SESSION_IDLE_TTL_MINUTES, 30);
  });

  it('rejects an out-of-range idle timeout', () => {
    assert.throws(
      () => validateEnvironment({ DATABASE_URL, SESSION_IDLE_TTL_MINUTES: 0 }),
      /SESSION_IDLE_TTL_MINUTES/,
    );
  });

  it('refuses to start in production without TRUST_PROXY', () => {
    assert.throws(
      () => validateEnvironment({ NODE_ENV: 'production', DATABASE_URL }),
      /TRUST_PROXY/,
    );
  });

  it('refuses to start in production without BIND_HOST', () => {
    assert.throws(
      () =>
        validateEnvironment({
          NODE_ENV: 'production',
          DATABASE_URL,
          TRUST_PROXY: 1,
          ADMIN_FRONTEND_ORIGIN: 'https://dheera.digimaraa.in',
        }),
      /BIND_HOST/,
    );
  });

  it('rejects a malformed BIND_HOST', () => {
    assert.throws(
      () => validateEnvironment({ DATABASE_URL, BIND_HOST: '127.0.0.1;rm -rf /' }),
      /BIND_HOST/,
    );
  });

  it('refuses non-https admin origins in production', () => {
    assert.throws(
      () =>
        validateEnvironment({
          NODE_ENV: 'production',
          DATABASE_URL,
          TRUST_PROXY: 1,
          BIND_HOST: '127.0.0.1',
        }),
      /https/,
    );
  });

  it('refuses to trust every proxy in production', () => {
    assert.throws(
      () =>
        validateEnvironment({
          NODE_ENV: 'production',
          DATABASE_URL,
          TRUST_PROXY: 'true',
          BIND_HOST: '127.0.0.1',
          ADMIN_FRONTEND_ORIGIN: 'https://dheera.digimaraa.in',
        }),
      /TRUST_PROXY/,
    );
  });

  it('accepts a complete production configuration', () => {
    const config = validateEnvironment({
      NODE_ENV: 'production',
      DATABASE_URL,
      TRUST_PROXY: 1,
      BIND_HOST: '127.0.0.1',
      ADMIN_FRONTEND_ORIGIN: 'https://dheera.digimaraa.in',
    });

    assert.equal(config.TRUST_PROXY, 1);
    assert.equal(config.BIND_HOST, '127.0.0.1');
  });
});

describe('PrismaExceptionFilter', () => {
  before(() => {
    Logger.overrideLogger([]);
  });

  after(() => {
    Logger.overrideLogger(['log', 'error', 'warn', 'debug', 'verbose']);
  });

  function runFilter(code: string, meta?: Record<string, unknown>) {
    let status: number | undefined;
    let body: unknown;

    const response = {
      status(value: number) {
        status = value;
        return response;
      },
      json(value: unknown) {
        body = value;
        return response;
      },
    };

    const host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost;

    const error = new Prisma.PrismaClientKnownRequestError('boom', {
      code,
      clientVersion: 'test',
      meta,
    });

    new PrismaExceptionFilter().catch(error, host);
    return { status, body };
  }

  it('maps client input errors to a generic 400', () => {
    const result = runFilter('P2023');

    assert.equal(result.status, 400);
    assert.deepEqual(result.body, {
      statusCode: 400,
      message: 'Invalid request data',
    });
    assert.equal(runFilter('P2010', { code: '22P02' }).status, 400);
  });

  it('maps unexpected database errors to a generic 500', () => {
    const result = runFilter('P1001');

    assert.equal(result.status, 500);
    assert.deepEqual(result.body, {
      statusCode: 500,
      message: 'Internal server error',
    });
  });
});
