import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { hash } from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  SESSION_COOKIE,
  csrfCookieOptions,
  sessionCookieOptions,
} from '../src/auth/auth.cookies';
import { PrismaService } from '../src/prisma/prisma.service';

const PASSWORD = 'correct-horse-battery-staple';
const LOGIN = '/api/auth/login';
const ME = '/api/auth/me';
const LOGOUT = '/api/auth/logout';

let ipCounter = 0;
const nextIp = (): string => `10.1.0.${++ipCounter}`;

describe('Admin authentication (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let adminId: string;

  const username = `__test_admin_${randomUUID().slice(0, 8)}`;
  const email = `${username}@example.com`;

  before(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    // Supertest always connects from 127.0.0.1, so trust the forwarded IP to
    // give each test its own rate-limit bucket.
    app.set('trust proxy', true);
    await app.init();

    prisma = moduleRef.get(PrismaService);
    const admin = await prisma.admin.create({
      data: { username, email, passwordHash: await hash(PASSWORD, 12) },
      select: { id: true },
    });
    adminId = admin.id;
  });

  after(async () => {
    await prisma.admin.deleteMany({ where: { username } });
    await app.close();
  });

  function setCookies(response: request.Response): string[] {
    const header = response.headers['set-cookie'];
    if (!header) return [];
    return Array.isArray(header) ? header : [header];
  }

  function cookieFor(response: request.Response, name: string): string {
    const cookie = setCookies(response).find((value) =>
      value.startsWith(`${name}=`),
    );
    assert.ok(cookie, `expected a ${name} cookie`);
    return cookie;
  }

  function cookieHeader(response: request.Response): string {
    return [SESSION_COOKIE, CSRF_COOKIE]
      .map((name) => cookieFor(response, name).split(';')[0])
      .join('; ');
  }

  function csrfValue(response: request.Response): string {
    return cookieFor(response, CSRF_COOKIE).split(';')[0].split('=')[1];
  }

  function login(
    identifier: string = username,
    password: string = PASSWORD,
  ): request.Test {
    return request(app.getHttpServer())
      .post(LOGIN)
      .set('X-Forwarded-For', nextIp())
      .send({ identifier, password });
  }

  it('logs in with a username and sets secure cookies', async () => {
    const response = await login().expect(200);

    assert.equal(response.body.admin.id, adminId);
    assert.equal(response.body.admin.username, username);
    assert.equal(response.body.admin.email, email);
    assert.equal('passwordHash' in response.body.admin, false);
    assert.equal(JSON.stringify(response.body).includes('$2b$'), false);

    const session = cookieFor(response, SESSION_COOKIE);
    assert.match(session, /HttpOnly/i);
    assert.match(session, /SameSite=Lax/i);
    assert.match(session, /Path=\//i);
    assert.doesNotMatch(session, /Secure/i);

    const csrf = cookieFor(response, CSRF_COOKIE);
    assert.doesNotMatch(csrf, /HttpOnly/i);

    const token = session.split(';')[0].split('=')[1];
    const stored = await prisma.session.findUnique({
      where: {
        tokenHash: createHash('sha256').update(token).digest('hex'),
      },
    });
    assert.ok(stored);
    assert.equal(stored.adminId, adminId);
    assert.ok(stored.expiresAt.getTime() > Date.now());
  });

  it('logs in with an email address', async () => {
    await login(email).expect(200);
  });

  it('rejects an unknown username with a generic message', async () => {
    const response = await login('no-such-admin').expect(401);

    assert.equal(response.body.message, 'Invalid credentials');
    assert.equal('admin' in response.body, false);
  });

  it('rejects a wrong password with the same generic message', async () => {
    const response = await login(username, 'wrong-password').expect(401);

    assert.equal(response.body.message, 'Invalid credentials');
  });

  it('rejects missing credentials', async () => {
    await request(app.getHttpServer())
      .post(LOGIN)
      .set('X-Forwarded-For', nextIp())
      .send({})
      .expect(400);
  });

  it('rejects unexpected body fields', async () => {
    await request(app.getHttpServer())
      .post(LOGIN)
      .set('X-Forwarded-For', nextIp())
      .send({ identifier: username, password: PASSWORD, isAdmin: true })
      .expect(400);
  });

  it('returns the current admin for a valid session', async () => {
    const loginResponse = await login().expect(200);
    const response = await request(app.getHttpServer())
      .get(ME)
      .set('Cookie', cookieHeader(loginResponse))
      .expect(200);

    assert.equal(response.body.admin.id, adminId);
    assert.equal(response.body.admin.username, username);
    assert.equal('passwordHash' in response.body.admin, false);
  });

  it('returns 401 without a session', async () => {
    await request(app.getHttpServer()).get(ME).expect(401);
  });

  it('returns 401 for an invalid session token', async () => {
    const token = randomBytes(32).toString('base64url');

    await request(app.getHttpServer())
      .get(ME)
      .set('Cookie', `${SESSION_COOKIE}=${token}`)
      .expect(401);
  });

  it('rejects and deletes an expired session', async () => {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await prisma.session.create({
      data: {
        tokenHash,
        adminId,
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    await request(app.getHttpServer())
      .get(ME)
      .set('Cookie', `${SESSION_COOKIE}=${token}`)
      .expect(401);

    assert.equal(
      await prisma.session.findUnique({ where: { tokenHash } }),
      null,
    );
  });

  it('logs out, clears the cookies and invalidates the session', async () => {
    const loginResponse = await login().expect(200);
    const token = cookieFor(loginResponse, SESSION_COOKIE)
      .split(';')[0]
      .split('=')[1];

    const response = await request(app.getHttpServer())
      .post(LOGOUT)
      .set('Cookie', cookieHeader(loginResponse))
      .set(CSRF_HEADER, csrfValue(loginResponse))
      .expect(200);

    assert.equal(response.body.success, true);
    assert.match(cookieFor(response, SESSION_COOKIE), /Expires=Thu, 01 Jan 1970/);

    await request(app.getHttpServer())
      .get(ME)
      .set('Cookie', `${SESSION_COOKIE}=${token}`)
      .expect(401);

    assert.equal(
      await prisma.session.findUnique({
        where: {
          tokenHash: createHash('sha256').update(token).digest('hex'),
        },
      }),
      null,
    );
  });

  it('blocks state-changing requests without a valid CSRF token', async () => {
    const loginResponse = await login().expect(200);
    const cookies = cookieHeader(loginResponse);

    await request(app.getHttpServer())
      .post(LOGOUT)
      .set('Cookie', cookies)
      .expect(403);

    await request(app.getHttpServer())
      .post(LOGOUT)
      .set('Cookie', cookies)
      .set(CSRF_HEADER, 'not-the-right-token')
      .expect(403);

    // The session must survive a rejected CSRF attempt.
    await request(app.getHttpServer())
      .get(ME)
      .set('Cookie', cookies)
      .expect(200);

    await request(app.getHttpServer())
      .post(LOGOUT)
      .set('Cookie', cookies)
      .set(CSRF_HEADER, csrfValue(loginResponse))
      .expect(200);
  });

  it('rate limits repeated login attempts', async () => {
    const ip = nextIp();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app.getHttpServer())
        .post(LOGIN)
        .set('X-Forwarded-For', ip)
        .send({ identifier: username, password: 'wrong-password' })
        .expect(401);
    }

    await request(app.getHttpServer())
      .post(LOGIN)
      .set('X-Forwarded-For', ip)
      .send({ identifier: username, password: 'wrong-password' })
      .expect(429);
  });

  it('marks cookies Secure in production and HttpOnly for the session', () => {
    assert.equal(sessionCookieOptions(true, 1000).secure, true);
    assert.equal(sessionCookieOptions(true, 1000).httpOnly, true);
    assert.equal(sessionCookieOptions(true, 1000).sameSite, 'lax');
    assert.equal(sessionCookieOptions(false, 1000).secure, false);
    assert.equal(csrfCookieOptions(true, 1000).httpOnly, false);
  });

  it('sets Secure cookies when NODE_ENV is production', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      const productionApp =
        moduleRef.createNestApplication<NestExpressApplication>();
      await productionApp.init();

      try {
        const response = await request(productionApp.getHttpServer())
          .post(LOGIN)
          .set('X-Forwarded-For', nextIp())
          .send({ identifier: username, password: PASSWORD })
          .expect(200);

        assert.match(cookieFor(response, SESSION_COOKIE), /Secure/i);
        assert.match(cookieFor(response, CSRF_COOKIE), /Secure/i);
      } finally {
        await productionApp.close();
      }
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
