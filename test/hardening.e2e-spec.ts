import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it, mock } from 'node:test';
import { Logger } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import express from 'express';
import request from 'supertest';
import { serveAdmin } from '../src/admin/admin.static';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AuthService } from '../src/auth/auth.service';
import { CSRF_HEADER } from '../src/auth/auth.cookies';
import {
  LOGIN_ATTEMPT_CAPACITY,
  LOGIN_ATTEMPT_MAX_FAILURES,
  LOGIN_ATTEMPT_WINDOW_MS,
  LoginAttemptsService,
} from '../src/auth/login-attempts.service';
import {
  PASSWORD_CHANGE_ATTEMPT_CAPACITY,
  PASSWORD_CHANGE_ATTEMPT_MAX_FAILURES,
  PASSWORD_CHANGE_ATTEMPT_WINDOW_MS,
  PASSWORD_CHANGE_BUSY_MESSAGE,
  PASSWORD_CHANGE_MAX_ADMITTED_PER_ADMIN,
  PasswordChangeAttemptsService,
} from '../src/auth/password-change-attempts.service';
import { hash } from 'bcryptjs';
import { PrismaExceptionFilter } from '../src/common/prisma-exception.filter';
import { hardenApp, securityHeaders } from '../src/common/security-headers';
import { validateEnvironment } from '../src/config/env.validation';
import { ProductsService } from '../src/products/products.service';
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
    'redirects /login and /admin-login to /admin/login',
    { skip: skipWithoutAdminBuild },
    async () => {
      for (const alias of ['/login', '/login/', '/admin-login', '/admin-login/']) {
        const response = await request(app.getHttpServer()).get(alias).expect(302);
        assert.equal(response.headers.location, '/admin/login');
      }
    },
  );

  it(
    'normalizes trailing slashes in ADMIN_FRONTEND_ORIGIN for CORS in configureApp',
    { skip: skipWithoutAdminBuild },
    async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      const configuredApp = moduleRef.createNestApplication<NestExpressApplication>();
      configureApp(configuredApp, {
        get: (key: string) =>
          key === 'ADMIN_FRONTEND_ORIGIN' ? 'https://Dheera.Digimaraa.in/' : undefined,
      } as unknown as ConfigService);
      await configuredApp.init();

      try {
        const cors = await request(configuredApp.getHttpServer())
          .get('/api/health')
          .set('Origin', 'https://dheera.digimaraa.in')
          .expect(200);
        assert.equal(
          cors.headers['access-control-allow-origin'],
          'https://dheera.digimaraa.in',
        );
        assert.equal(cors.headers['access-control-allow-credentials'], 'true');
      } finally {
        await configuredApp.close();
      }
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

describe('PasswordChangeAttemptsService', () => {
  it('locks after 10 failures and unlocks on reset', () => {
    const attempts = new PasswordChangeAttemptsService();

    for (let failure = 0; failure < PASSWORD_CHANGE_ATTEMPT_MAX_FAILURES - 1; failure += 1) {
      attempts.recordFailure('admin-a');
    }
    attempts.assertAllowed('admin-a');

    attempts.recordFailure('admin-a');
    assert.throws(
      () => attempts.assertAllowed('admin-a'),
      /Too many incorrect password attempts/,
    );

    attempts.reset('admin-a');
    attempts.assertAllowed('admin-a');
  });

  it('drops an admin once the 15 minute window has passed', () => {
    mock.timers.enable({ apis: ['Date'] });
    try {
      const attempts = new PasswordChangeAttemptsService();

      for (let failure = 0; failure < PASSWORD_CHANGE_ATTEMPT_MAX_FAILURES; failure += 1) {
        attempts.recordFailure('admin-a');
      }
      assert.throws(
        () => attempts.assertAllowed('admin-a'),
        /Too many incorrect password attempts/,
      );

      mock.timers.tick(PASSWORD_CHANGE_ATTEMPT_WINDOW_MS + 1);

      attempts.assertAllowed('admin-a');
      assert.equal(attempts.trackedCount, 0);
    } finally {
      mock.timers.reset();
    }
  });

  it('cleans up expired entries and preserves active lockouts', () => {
    mock.timers.enable({ apis: ['Date'] });
    try {
      const attempts = new PasswordChangeAttemptsService();
      attempts.recordFailure('expired-admin');

      mock.timers.tick(PASSWORD_CHANGE_ATTEMPT_WINDOW_MS + 1);

      // Create an active lockout after the old entry expired.
      for (let failure = 0; failure < PASSWORD_CHANGE_ATTEMPT_MAX_FAILURES; failure += 1) {
        attempts.recordFailure('locked-admin');
      }

      // Trigger cleanup path: adding a new untracked admin sweeps expired state.
      attempts.recordFailure('fresh-admin');

      assert.equal(attempts.trackedCount, 2);
      assert.throws(
        () => attempts.assertAllowed('locked-admin'),
        /Too many incorrect password attempts/,
      );
      attempts.assertAllowed('expired-admin');
    } finally {
      mock.timers.reset();
    }
  });

  it('bounds tracked admins and never evicts active lockouts', () => {
    const attempts = new PasswordChangeAttemptsService();

    for (let index = 0; index < PASSWORD_CHANGE_ATTEMPT_CAPACITY; index += 1) {
      for (let failure = 0; failure < PASSWORD_CHANGE_ATTEMPT_MAX_FAILURES; failure += 1) {
        attempts.recordFailure(`admin-${index}`);
      }
    }
    assert.equal(attempts.trackedCount, PASSWORD_CHANGE_ATTEMPT_CAPACITY);

    // A failure for an untracked admin is refused, not dropped, and must not
    // evict an existing (active) lockout.
    assert.throws(
      () => attempts.recordFailure('one-too-many'),
      /Too many incorrect password attempts/,
    );
    assert.equal(attempts.trackedCount, PASSWORD_CHANGE_ATTEMPT_CAPACITY);
    assert.throws(
      () => attempts.assertAllowed('admin-0'),
      /Too many incorrect password attempts/,
    );
  });

  it('serializes per-admin work so concurrent attempts cannot bypass the threshold', async () => {
    const attempts = new PasswordChangeAttemptsService();
    let verifications = 0;

    const attempt = () =>
      attempts.runExclusive('admin-a', async () => {
        attempts.assertAllowed('admin-a');
        verifications += 1;
        await Promise.resolve();
        attempts.recordFailure('admin-a');
      });

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => attempt()),
    );

    // 10 admitted and serialized to completion (10 verified failures recorded);
    // excess concurrent requests are rejected immediately for queue capacity.
    assert.equal(verifications, PASSWORD_CHANGE_ATTEMPT_MAX_FAILURES);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 10);
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    assert.equal(rejected.length, 10);
    for (const result of rejected) {
      assert.equal(result.reason?.getStatus?.(), 429);
      assert.equal(result.reason?.message, PASSWORD_CHANGE_BUSY_MESSAGE);
    }
    assert.equal(attempts.inflightCount('admin-a'), 0);
    assert.throws(
      () => attempts.assertAllowed('admin-a'),
      /Too many incorrect password attempts/,
    );
  });

  it('enforces the max admitted operations per admin and rejects excess immediately', async () => {
    const attempts = new PasswordChangeAttemptsService();
    let started = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const admitted = Array.from({ length: PASSWORD_CHANGE_MAX_ADMITTED_PER_ADMIN }, () =>
      attempts.runExclusive('admin-a', async () => {
        started += 1;
        await gate;
      }),
    );

    await Promise.resolve();
    await Promise.resolve();
    assert.equal(started, 1);
    assert.equal(
      attempts.inflightCount('admin-a'),
      PASSWORD_CHANGE_MAX_ADMITTED_PER_ADMIN,
    );

    await assert.rejects(
      () => attempts.runExclusive('admin-a', async () => undefined),
      (error: any) =>
        error?.getStatus?.() === 429 &&
        error?.message === PASSWORD_CHANGE_BUSY_MESSAGE,
    );
    assert.equal(
      attempts.inflightCount('admin-a'),
      PASSWORD_CHANGE_MAX_ADMITTED_PER_ADMIN,
    );

    release();
    await Promise.all(admitted);
    assert.equal(attempts.inflightCount('admin-a'), 0);
  });

  it('releases queue capacity after completion and after synchronous/asynchronous failures', async () => {
    const attempts = new PasswordChangeAttemptsService();

    for (let i = 0; i < PASSWORD_CHANGE_MAX_ADMITTED_PER_ADMIN; i += 1) {
      await attempts.runExclusive('admin-a', async () => undefined);
    }
    assert.equal(attempts.inflightCount('admin-a'), 0);

    await assert.rejects(
      () =>
        attempts.runExclusive('admin-a', () => {
          throw new Error('sync-fail');
        }),
      /sync-fail/,
    );
    assert.equal(attempts.inflightCount('admin-a'), 0);

    await assert.rejects(
      () =>
        attempts.runExclusive('admin-a', async () => {
          throw new Error('async-fail');
        }),
      /async-fail/,
    );
    assert.equal(attempts.inflightCount('admin-a'), 0);

    // A subsequent request proceeds after failed operations.
    let ran = false;
    await attempts.runExclusive('admin-a', async () => {
      ran = true;
    });
    assert.equal(ran, true);
    assert.equal(attempts.inflightCount('admin-a'), 0);
  });

  it('keeps queue limits independent per administrator', async () => {
    const attempts = new PasswordChangeAttemptsService();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const admittedA = Array.from(
      { length: PASSWORD_CHANGE_MAX_ADMITTED_PER_ADMIN },
      () => attempts.runExclusive('admin-a', async () => gate),
    );

    await assert.rejects(
      () => attempts.runExclusive('admin-a', async () => undefined),
      (error: any) => error?.message === PASSWORD_CHANGE_BUSY_MESSAGE,
    );

    let ranB = false;
    await attempts.runExclusive('admin-b', async () => {
      ranB = true;
    });
    assert.equal(ranB, true);

    release();
    await Promise.all(admittedA);
  });
});

describe('Change password lockout counter integrity', () => {
  const adminId = 'admin-db-failure';
  const currentPassword = 'current-password-1234';
  const newPassword = 'brand-new-password-1234';

  async function createService(options: {
    findUnique: (...args: any[]) => any;
    transaction?: (...args: any[]) => any;
  }): Promise<{
    service: AuthService;
    attempts: PasswordChangeAttemptsService;
  }> {
    const attempts = new PasswordChangeAttemptsService();
    const prisma = {
      admin: { findUnique: options.findUnique },
      $transaction:
        options.transaction ??
        (async () => {
          throw new Error('transaction should not run');
        }),
    } as any;
    const config = { get: () => undefined } as any;
    return { service: new AuthService(prisma, attempts, config), attempts };
  }

  function dto(overrides: Record<string, string> = {}) {
    return {
      currentPassword,
      newPassword,
      confirmPassword: newPassword,
      ...overrides,
    } as any;
  }

  it('checks lockout before bcrypt verification and skips DB/bcrypt when locked', async () => {
    let findCalls = 0;
    const { service, attempts } = await createService({
      findUnique: async () => {
        findCalls += 1;
        return { passwordHash: await hash(currentPassword, 12) };
      },
    });

    for (let failure = 0; failure < PASSWORD_CHANGE_ATTEMPT_MAX_FAILURES; failure += 1) {
      attempts.recordFailure(adminId);
    }

    await assert.rejects(
      () => service.changePassword(adminId, dto()),
      (error: any) =>
        error?.getStatus?.() === 429 &&
        /Too many incorrect password attempts/.test(error?.message),
    );
    assert.equal(findCalls, 0);
  });

  it('does not increment or reset the counter when loading the admin fails', async () => {
    const { service, attempts } = await createService({
      findUnique: async () => {
        throw new Error('db read failed');
      },
    });

    await assert.rejects(() => service.changePassword(adminId, dto()), /db read failed/);
    assert.equal(attempts.trackedCount, 0);

    for (let failure = 0; failure < PASSWORD_CHANGE_ATTEMPT_MAX_FAILURES - 1; failure += 1) {
      attempts.recordFailure(adminId);
    }
    await assert.rejects(() => service.changePassword(adminId, dto()), /db read failed/);
    attempts.assertAllowed(adminId);
  });

  it('does not increment or reset the counter when the password-change transaction fails', async () => {
    const passwordHash = await hash(currentPassword, 12);
    const { service, attempts } = await createService({
      findUnique: async () => ({ passwordHash }),
      transaction: async () => {
        throw new Error('db write failed');
      },
    });

    attempts.recordFailure(adminId);
    attempts.recordFailure(adminId);

    await assert.rejects(
      () => service.changePassword(adminId, dto()),
      /db write failed/,
    );

    // Prior failures preserved (not reset) and no extra increment from a DB error.
    for (let failure = 2; failure < PASSWORD_CHANGE_ATTEMPT_MAX_FAILURES - 1; failure += 1) {
      attempts.recordFailure(adminId);
    }
    attempts.assertAllowed(adminId);
    attempts.recordFailure(adminId);
    assert.throws(
      () => attempts.assertAllowed(adminId),
      /Too many incorrect password attempts/,
    );
  });

  it('rejects queue-saturated requests immediately without incrementing the counter or verifying', async () => {
    let findCalls = 0;
    const { service, attempts } = await createService({
      findUnique: async () => {
        findCalls += 1;
        return { passwordHash: await hash(currentPassword, 12) };
      },
    });

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holders = Array.from(
      { length: PASSWORD_CHANGE_MAX_ADMITTED_PER_ADMIN },
      () => attempts.runExclusive(adminId, async () => gate),
    );

    await assert.rejects(
      () =>
        service.changePassword(adminId, {
          currentPassword: 'definitely-not-the-password',
          newPassword,
          confirmPassword: newPassword,
        } as any),
      (error: any) =>
        error?.getStatus?.() === 429 &&
        error?.message === PASSWORD_CHANGE_BUSY_MESSAGE,
    );

    assert.equal(findCalls, 0);
    assert.equal(attempts.trackedCount, 0);
    attempts.assertAllowed(adminId);

    release();
    await Promise.all(holders);
    assert.equal(attempts.inflightCount(adminId), 0);
  });
});

describe('validateEnvironment', () => {
  const DATABASE_URL = 'mysql://user:pass@localhost:3306/db';

  it('applies development defaults', () => {
    const config = validateEnvironment({ DATABASE_URL });

    assert.equal(config.NODE_ENV, 'development');
    assert.equal(config.TRUST_PROXY, 0);
    assert.equal(config.BIND_HOST, '0.0.0.0');
    assert.equal(config.SESSION_IDLE_TTL_MINUTES, 30);
  });

  it('accepts a mysql:// DATABASE_URL', () => {
    const config = validateEnvironment({ DATABASE_URL: 'mysql://app:secret@db.example:3306/app_db' });
    assert.equal(config.DATABASE_URL, 'mysql://app:secret@db.example:3306/app_db');
  });

  it('rejects a mariadb:// DATABASE_URL', () => {
    assert.throws(
      () => validateEnvironment({ DATABASE_URL: 'mariadb://user:pass@localhost:3306/db' }),
      /DATABASE_URL must be a mysql:\/\/ connection string/,
    );
  });

  it('rejects a postgresql:// DATABASE_URL', () => {
    assert.throws(
      () => validateEnvironment({ DATABASE_URL: 'postgresql://user:pass@localhost:5432/db' }),
      /DATABASE_URL must be a mysql:\/\/ connection string/,
    );
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
    assert.equal(runFilter('P2010', { code: '22003' }).status, 400);
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

describe('AuthService & ProductsService unit edge cases', () => {
  it('returns null instead of throwing if session is concurrently deleted before lastSeenAt refresh', async () => {
    const prisma = {
      session: {
        findUnique: async () => ({
          id: 'session-1',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          lastSeenAt: new Date(Date.now() - 5 * 60 * 1000),
          csrfHash: 'hash',
          admin: {
            id: 'admin-1',
            username: 'admin',
            email: 'admin@example.com',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        }),
        updateMany: async () => ({ count: 0 }),
      },
    } as any;
    const service = new AuthService(
      prisma,
      new PasswordChangeAttemptsService(),
      { get: () => undefined } as any,
    );

    const validated = await service.validateSession('some-token');
    assert.equal(validated, null);
  });

  it('derives imageFilename when update changes imageUrl without imageFilename', async () => {
    const oldFilename = `${randomUUID()}.png`;
    const newFilename = `${randomUUID()}.webp`;
    let writtenData: Record<string, unknown> | undefined;

    const existingRow = {
      id: 'prod-1',
      name: 'Silk Blouse',
      slug: 'silk-blouse',
      description: 'Desc',
      category: 'Blouses',
      imageUrl: `/uploads/products/${oldFilename}`,
      imageFilename: oldFilename,
      price: null,
      displayOrder: 1,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const prisma = {
      product: {
        findUnique: async () => existingRow,
        update: async ({ data }: { data: Record<string, unknown> }) => {
          writtenData = data;
          return { ...existingRow, ...data };
        },
      },
    } as any;
    const uploads = { deferCleanup: () => undefined } as any;
    const service = new ProductsService(prisma, uploads);

    const updated = await service.update('prod-1', {
      imageUrl: `/uploads/products/${newFilename}`,
    });

    assert.equal(writtenData?.imageFilename, newFilename);
    assert.equal(updated.imageFilename, newFilename);
  });
});
