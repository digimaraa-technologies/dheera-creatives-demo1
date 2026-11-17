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
  csrfCookieName,
  csrfCookieOptions,
  sessionCookieName,
  sessionCookieOptions,
} from '../src/auth/auth.cookies';
import {
  isPasswordWithinBcryptLimit,
  passwordByteLength,
} from '../src/auth/password';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { adminOrigin } from './helpers/admin-session';

const PASSWORD = 'correct-horse-battery-staple';
const LOGIN = '/api/auth/login';
const ME = '/api/auth/me';
const LOGOUT = '/api/auth/logout';
const LOGOUT_ALL = '/api/auth/logout-all';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const IDLE_TTL_MS = 30 * 60 * 1000;

let ipCounter = 0;
const nextIp = (): string => `10.1.0.${++ipCounter}`;
const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

describe('Admin authentication (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let adminId: string;
  let otherAdminId: string;

  const username = `__test_admin_${randomUUID().slice(0, 8)}`;
  const email = `${username}@example.com`;
  const otherUsername = `__test_other_${randomUUID().slice(0, 8)}`;

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

    const other = await prisma.admin.create({
      data: {
        username: otherUsername,
        email: `${otherUsername}@example.com`,
        passwordHash: await hash(PASSWORD, 12),
      },
      select: { id: true },
    });
    otherAdminId = other.id;
  });

  after(async () => {
    await prisma.admin.deleteMany({ where: { username } });
    await prisma.admin.deleteMany({ where: { username: otherUsername } });
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

  function sessionToken(response: request.Response): string {
    return cookieFor(response, SESSION_COOKIE).split(';')[0].split('=')[1];
  }

  function login(
    identifier: string = username,
    password: string = PASSWORD,
    origin: string = adminOrigin(),
  ): request.Test {
    return request(app.getHttpServer())
      .post(LOGIN)
      .set('X-Forwarded-For', nextIp())
      .set('Origin', origin)
      .send({ identifier, password });
  }

  /** Creates a session row directly, for expiry and concurrency tests. */
  async function issueSession(
    ownerId: string,
    overrides: {
      expiresAt?: Date;
      lastSeenAt?: Date;
      csrfHash?: string | null;
    } = {},
  ): Promise<{ token: string; csrf: string; cookie: string }> {
    const token = randomBytes(32).toString('base64url');
    const csrf = randomBytes(32).toString('base64url');
    await prisma.session.create({
      data: {
        tokenHash: sha256(token),
        csrfHash: overrides.csrfHash === undefined ? sha256(csrf) : overrides.csrfHash,
        adminId: ownerId,
        expiresAt: overrides.expiresAt ?? new Date(Date.now() + SESSION_TTL_MS),
        lastSeenAt: overrides.lastSeenAt ?? new Date(),
      },
    });
    return {
      token,
      csrf,
      cookie: `${SESSION_COOKIE}=${token}; ${CSRF_COOKIE}=${csrf}`,
    };
  }

  it('logs in with a username and sets development cookies', async () => {
    const response = await login().expect(200);

    assert.equal(response.body.admin.id, adminId);
    assert.equal(response.body.admin.username, username);
    assert.equal(response.body.admin.email, email);
    assert.equal('passwordHash' in response.body.admin, false);
    assert.equal(JSON.stringify(response.body).includes('$2b$'), false);

    const session = cookieFor(response, SESSION_COOKIE);
    assert.match(session, /^dheera_session=/);
    assert.match(session, /HttpOnly/i);
    assert.match(session, /SameSite=Lax/i);
    assert.match(session, /Path=\//i);
    assert.doesNotMatch(session, /Secure/i);
    assert.doesNotMatch(session, /Domain/i);

    const csrf = cookieFor(response, CSRF_COOKIE);
    assert.match(csrf, /^dheera_csrf=/);
    assert.doesNotMatch(csrf, /HttpOnly/i);

    const token = sessionToken(response);
    const stored = await prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
    });
    assert.ok(stored);
    assert.equal(stored.adminId, adminId);
    assert.ok(stored.expiresAt.getTime() > Date.now());
    assert.equal(stored.csrfHash, sha256(csrfValue(response)));
    assert.ok(Date.now() - stored.lastSeenAt.getTime() < 10_000);
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
      .set('Origin', adminOrigin())
      .send({})
      .expect(400);
  });

  it('rejects unexpected body fields', async () => {
    await request(app.getHttpServer())
      .post(LOGIN)
      .set('X-Forwarded-For', nextIp())
      .set('Origin', adminOrigin())
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

  it('rejects and deletes an absolutely expired session', async () => {
    const session = await issueSession(adminId, {
      expiresAt: new Date(Date.now() - 60_000),
    });

    await request(app.getHttpServer())
      .get(ME)
      .set('Cookie', session.cookie)
      .expect(401);

    assert.equal(
      await prisma.session.findUnique({
        where: { tokenHash: sha256(session.token) },
      }),
      null,
    );
  });

  it('rejects and deletes an idle-expired session', async () => {
    const session = await issueSession(adminId, {
      lastSeenAt: new Date(Date.now() - IDLE_TTL_MS - 60_000),
    });

    await request(app.getHttpServer())
      .get(ME)
      .set('Cookie', session.cookie)
      .expect(401);

    assert.equal(
      await prisma.session.findUnique({
        where: { tokenHash: sha256(session.token) },
      }),
      null,
    );
  });

  it('refreshes activity once and then throttles the database write', async () => {
    const loginResponse = await login().expect(200);
    const token = sessionToken(loginResponse);
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    await prisma.session.update({
      where: { tokenHash: sha256(token) },
      data: { lastSeenAt: fiveMinutesAgo },
    });

    await request(app.getHttpServer())
      .get(ME)
      .set('Cookie', `${SESSION_COOKIE}=${token}`)
      .expect(200);

    const refreshed = await prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
    });
    assert.ok(refreshed);
    assert.ok(refreshed.lastSeenAt.getTime() > Date.now() - 10_000);

    const firstWrite = refreshed.lastSeenAt.getTime();
    await request(app.getHttpServer())
      .get(ME)
      .set('Cookie', `${SESSION_COOKIE}=${token}`)
      .expect(200);

    const again = await prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
    });
    assert.equal(again?.lastSeenAt.getTime(), firstWrite);
  });

  it('logs out, clears the cookies and invalidates the session', async () => {
    const loginResponse = await login().expect(200);
    const token = sessionToken(loginResponse);

    const response = await request(app.getHttpServer())
      .post(LOGOUT)
      .set('Cookie', cookieHeader(loginResponse))
      .set(CSRF_HEADER, csrfValue(loginResponse))
      .expect(200);

    assert.equal(response.body.success, true);
    assert.match(cookieFor(response, SESSION_COOKIE), /Expires=Thu, 01 Jan 1970/);
    assert.match(cookieFor(response, CSRF_COOKIE), /Expires=Thu, 01 Jan 1970/);

    await request(app.getHttpServer())
      .get(ME)
      .set('Cookie', `${SESSION_COOKIE}=${token}`)
      .expect(401);

    // Reusing the old session + CSRF token after logout must not work.
    await request(app.getHttpServer())
      .post(LOGOUT)
      .set('Cookie', cookieHeader(loginResponse))
      .set(CSRF_HEADER, csrfValue(loginResponse))
      .expect(401);

    assert.equal(
      await prisma.session.findUnique({
        where: { tokenHash: sha256(token) },
      }),
      null,
    );
  });

  it('revokes only the current session on logout', async () => {
    const first = await login().expect(200);
    const second = await login().expect(200);

    await request(app.getHttpServer())
      .post(LOGOUT)
      .set('Cookie', cookieHeader(first))
      .set(CSRF_HEADER, csrfValue(first))
      .expect(200);

    await request(app.getHttpServer())
      .get(ME)
      .set('Cookie', cookieHeader(first))
      .expect(401);

    await request(app.getHttpServer())
      .get(ME)
      .set('Cookie', cookieHeader(second))
      .expect(200);
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

  it('rejects a CSRF token from a different session', async () => {
    const first = await login().expect(200);
    const second = await login().expect(200);
    const firstCsrf = csrfValue(first);
    const secondCookie = cookieHeader(second);

    // Second session's cookie jar with the first session's token: the
    // double-submit values match, but the token is not bound to this session.
    await request(app.getHttpServer())
      .post(LOGOUT)
      .set(
        'Cookie',
        `${SESSION_COOKIE}=${sessionToken(second)}; ${CSRF_COOKIE}=${firstCsrf}`,
      )
      .set(CSRF_HEADER, firstCsrf)
      .expect(403);

    // Second session's cookie jar with its own token still works.
    await request(app.getHttpServer())
      .get(ME)
      .set('Cookie', secondCookie)
      .expect(200);
  });

  it('rejects a CSRF token planted by an attacker', async () => {
    const loginResponse = await login().expect(200);
    const planted = randomBytes(32).toString('base64url');
    const session = sessionToken(loginResponse);

    await request(app.getHttpServer())
      .post(LOGOUT)
      .set('Cookie', `${SESSION_COOKIE}=${session}; ${CSRF_COOKIE}=${planted}`)
      .set(CSRF_HEADER, planted)
      .expect(403);

    // A planted cookie also breaks the double-submit pairing.
    await request(app.getHttpServer())
      .post(LOGOUT)
      .set('Cookie', `${SESSION_COOKIE}=${session}; ${CSRF_COOKIE}=${planted}`)
      .set(CSRF_HEADER, csrfValue(loginResponse))
      .expect(403);
  });

  it('rejects an expired session even with a matching CSRF token', async () => {
    const session = await issueSession(adminId, {
      expiresAt: new Date(Date.now() - 60_000),
    });

    await request(app.getHttpServer())
      .post(LOGOUT)
      .set('Cookie', session.cookie)
      .set(CSRF_HEADER, session.csrf)
      .expect(401);
  });

  it('adopts a bound token for a session created before the migration', async () => {
    const legacy = await issueSession(adminId, { csrfHash: null });

    // A validation error still means the guard passed and the token was bound.
    await request(app.getHttpServer())
      .post('/api/admin/products')
      .set('Cookie', legacy.cookie)
      .set(CSRF_HEADER, legacy.csrf)
      .send({})
      .expect(400);

    const stored = await prisma.session.findUnique({
      where: { tokenHash: sha256(legacy.token) },
    });
    assert.equal(stored?.csrfHash, sha256(legacy.csrf));

    await request(app.getHttpServer())
      .post(LOGOUT)
      .set('Cookie', legacy.cookie)
      .set(CSRF_HEADER, randomBytes(32).toString('base64url'))
      .expect(403);
  });

  it('rejects duplicate session cookies in either order', async () => {
    const loginResponse = await login().expect(200);
    const sessionPair = cookieFor(loginResponse, SESSION_COOKIE).split(';')[0];
    const csrfPair = cookieFor(loginResponse, CSRF_COOKIE).split(';')[0];

    await request(app.getHttpServer())
      .get(ME)
      .set('Cookie', `${sessionPair}; ${sessionPair}`)
      .expect(400);

    await request(app.getHttpServer())
      .get(ME)
      .set('Cookie', `${SESSION_COOKIE}=first; ${SESSION_COOKIE}=second`)
      .expect(400);

    await request(app.getHttpServer())
      .get(ME)
      .set('Cookie', `${SESSION_COOKIE}=second; ${SESSION_COOKIE}=first`)
      .expect(400);

    // A duplicate unrelated cookie is not a security cookie and is ignored.
    await request(app.getHttpServer())
      .get(ME)
      .set('Cookie', `${sessionPair}; ${csrfPair}; theme=dark; theme=light`)
      .expect(200);
  });

  it('rejects duplicate CSRF cookies in either order', async () => {
    const loginResponse = await login().expect(200);
    const sessionPair = cookieFor(loginResponse, SESSION_COOKIE).split(';')[0];
    const csrfPair = cookieFor(loginResponse, CSRF_COOKIE).split(';')[0];

    await request(app.getHttpServer())
      .get(ME)
      .set('Cookie', `${sessionPair}; ${csrfPair}; ${csrfPair}`)
      .expect(400);

    await request(app.getHttpServer())
      .get(ME)
      .set('Cookie', `${csrfPair}; ${csrfPair}; ${sessionPair}`)
      .expect(400);

    await request(app.getHttpServer())
      .get(ME)
      .set('Cookie', `${sessionPair}; ${CSRF_COOKIE}=first; ${CSRF_COOKIE}=second`)
      .expect(400);
  });

  it('requires a valid CSRF token for logout-all', async () => {
    const loginResponse = await login().expect(200);

    await request(app.getHttpServer())
      .post(LOGOUT_ALL)
      .set('Cookie', cookieHeader(loginResponse))
      .expect(403);
  });

  it('revokes every session for the admin on logout-all', async () => {
    const first = await login().expect(200);
    const second = await login().expect(200);
    const other = await issueSession(otherAdminId);

    const response = await request(app.getHttpServer())
      .post(LOGOUT_ALL)
      .set('Cookie', cookieHeader(first))
      .set(CSRF_HEADER, csrfValue(first))
      .expect(200);

    assert.equal(response.body.success, true);
    assert.match(cookieFor(response, SESSION_COOKIE), /Expires=Thu, 01 Jan 1970/);
    assert.match(cookieFor(response, CSRF_COOKIE), /Expires=Thu, 01 Jan 1970/);

    await request(app.getHttpServer())
      .get(ME)
      .set('Cookie', cookieHeader(first))
      .expect(401);

    await request(app.getHttpServer())
      .get(ME)
      .set('Cookie', cookieHeader(second))
      .expect(401);

    // Another admin's sessions are untouched.
    await request(app.getHttpServer())
      .get(ME)
      .set('Cookie', `${SESSION_COOKIE}=${other.token}`)
      .expect(200);

    assert.equal(await prisma.session.count({ where: { adminId } }), 0);
  });

  it('keeps legacy long-password login behavior unchanged', async () => {
    const longUsername = `__test_long_${randomUUID().slice(0, 8)}`;
    const prefix = 'a'.repeat(72);
    const created = await prisma.admin.create({
      data: {
        username: longUsername,
        email: `${longUsername}@example.com`,
        passwordHash: await hash(prefix, 12),
      },
      select: { id: true },
    });

    try {
      await login(longUsername, prefix).expect(200);
      // Documented limitation: bcrypt ignores bytes after 72, and login-side
      // rejection is deliberately deferred until the existing credential can be
      // verified safely.
      await login(longUsername, `${prefix}extra-bytes`).expect(200);
    } finally {
      await prisma.admin.deleteMany({ where: { id: created.id } });
    }
  });

  it('rate limits repeated login attempts', async () => {
    const ip = nextIp();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app.getHttpServer())
        .post(LOGIN)
        .set('X-Forwarded-For', ip)
        .set('Origin', adminOrigin())
        .send({ identifier: username, password: 'wrong-password' })
        .expect(401);
    }

    await request(app.getHttpServer())
      .post(LOGIN)
      .set('X-Forwarded-For', ip)
      .set('Origin', adminOrigin())
      .send({ identifier: username, password: 'wrong-password' })
      .expect(429);
  });

  it('sets Secure __Host- cookies in production mode', async () => {
    // AppModule's ConfigModule.forRoot() is evaluated once at import, so a
    // second bootstrap would keep the development configuration. Flip the flag
    // the service captured at construction instead.
    const service = app.get(AuthService);
    const mutable = service as unknown as { isProduction: boolean };
    const previous = mutable.isProduction;
    mutable.isProduction = true;

    try {
      const response = await login().expect(200);

      const session = cookieFor(response, sessionCookieName(true));
      assert.match(session, /^__Host-dheera_session=/);
      assert.match(session, /Secure/i);
      assert.match(session, /HttpOnly/i);
      assert.match(session, /Path=\//i);
      assert.doesNotMatch(session, /Domain/i);

      const csrf = cookieFor(response, csrfCookieName(true));
      assert.match(csrf, /^__Host-dheera_csrf=/);
      assert.match(csrf, /Secure/i);
      assert.doesNotMatch(csrf, /HttpOnly/i);
      assert.doesNotMatch(csrf, /Domain/i);
    } finally {
      mutable.isProduction = previous;
    }
  });

  describe('Change password (e2e)', () => {
    const CHANGE = '/api/auth/change-password';
    const NEW_PASSWORD = 'a-brand-new-passphrase';
    const created: string[] = [];

    after(async () => {
      await prisma.admin.deleteMany({ where: { id: { in: created } } });
    });

    async function newAdmin(password: string = PASSWORD): Promise<{
      id: string;
      username: string;
      password: string;
    }> {
      const name = `__test_pw_${randomUUID().slice(0, 8)}`;
      const admin = await prisma.admin.create({
        data: {
          username: name,
          email: `${name}@example.com`,
          passwordHash: await hash(password, 12),
        },
        select: { id: true },
      });
      created.push(admin.id);
      return { id: admin.id, username: name, password };
    }

    function changeRequest(
      session: request.Response,
      body: Record<string, string>,
    ): request.Test {
      return request(app.getHttpServer())
        .post(CHANGE)
        .set('X-Forwarded-For', nextIp())
        .set('Cookie', cookieHeader(session))
        .set(CSRF_HEADER, csrfValue(session))
        .send(body);
    }

    async function storedHash(adminIdValue: string): Promise<string> {
      const row = await prisma.admin.findUnique({
        where: { id: adminIdValue },
        select: { passwordHash: true },
      });
      assert.ok(row);
      return row.passwordHash;
    }

    function validBody(currentPassword: string): Record<string, string> {
      return {
        currentPassword,
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      };
    }

    it('changes the password, revokes the session and clears cookies', async () => {
      const account = await newAdmin();
      const session = await login(account.username, account.password).expect(200);

      const response = await changeRequest(
        session,
        validBody(account.password),
      ).expect(200);

      assert.equal(response.body.success, true);
      assert.equal(response.body.redirectTo, '/login');
      assert.match(
        cookieFor(response, SESSION_COOKIE),
        /Expires=Thu, 01 Jan 1970/,
      );
      assert.match(
        cookieFor(response, CSRF_COOKIE),
        /Expires=Thu, 01 Jan 1970/,
      );

      await request(app.getHttpServer())
        .get(ME)
        .set('Cookie', cookieHeader(session))
        .expect(401);

      assert.equal(
        await prisma.session.count({ where: { adminId: account.id } }),
        0,
      );
    });

    it('rejects an incorrect current password and keeps the session', async () => {
      const account = await newAdmin();
      const session = await login(account.username, account.password).expect(200);
      const before = await storedHash(account.id);

      const response = await changeRequest(session, {
        currentPassword: 'definitely-not-the-password',
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      }).expect(400);

      assert.equal(response.body.message, 'Current password is incorrect');
      assert.equal(await storedHash(account.id), before);

      await request(app.getHttpServer())
        .get(ME)
        .set('Cookie', cookieHeader(session))
        .expect(200);
    });

    it('rejects a confirmation that does not match', async () => {
      const account = await newAdmin();
      const session = await login(account.username, account.password).expect(200);

      const response = await changeRequest(session, {
        currentPassword: account.password,
        newPassword: NEW_PASSWORD,
        confirmPassword: `${NEW_PASSWORD}-other`,
      }).expect(400);

      assert.equal(
        response.body.message,
        'New password and confirmation do not match',
      );
    });

    it('rejects a new password shorter than 12 characters', async () => {
      const account = await newAdmin();
      const session = await login(account.username, account.password).expect(200);

      const response = await changeRequest(session, {
        currentPassword: account.password,
        newPassword: 'short-passw',
        confirmPassword: 'short-passw',
      }).expect(400);

      assert.match(
        [].concat(response.body.message).join(' '),
        /at least 12 characters/,
      );
    });

    it('rejects a new password longer than 72 UTF-8 bytes', async () => {
      const account = await newAdmin();
      const session = await login(account.username, account.password).expect(200);
      const tooLong = 'a'.repeat(73);

      const response = await changeRequest(session, {
        currentPassword: account.password,
        newPassword: tooLong,
        confirmPassword: tooLong,
      }).expect(400);

      assert.match(
        [].concat(response.body.message).join(' '),
        /at most 72 UTF-8 bytes/,
      );
    });

    it('rejects a new password identical to the current one', async () => {
      const account = await newAdmin();
      const session = await login(account.username, account.password).expect(200);

      const response = await changeRequest(session, {
        currentPassword: account.password,
        newPassword: account.password,
        confirmPassword: account.password,
      }).expect(400);

      assert.equal(
        response.body.message,
        'New password must be different from the current password',
      );
    });

    it('rejects an anonymous request', async () => {
      await request(app.getHttpServer())
        .post(CHANGE)
        .set('X-Forwarded-For', nextIp())
        .send({
          currentPassword: PASSWORD,
          newPassword: NEW_PASSWORD,
          confirmPassword: NEW_PASSWORD,
        })
        .expect(401);
    });

    it('rejects a request without a CSRF token', async () => {
      const account = await newAdmin();
      const session = await login(account.username, account.password).expect(200);

      await request(app.getHttpServer())
        .post(CHANGE)
        .set('X-Forwarded-For', nextIp())
        .set('Cookie', cookieHeader(session))
        .send(validBody(account.password))
        .expect(403);
    });

    it('stores the new password as a bcrypt hash', async () => {
      const account = await newAdmin();
      const session = await login(account.username, account.password).expect(200);
      const before = await storedHash(account.id);

      await changeRequest(session, validBody(account.password)).expect(200);

      const after = await storedHash(account.id);
      assert.notEqual(after, before);
      assert.match(after, /^\$2[aby]\$12\$/);
      assert.equal(after.includes(NEW_PASSWORD), false);
    });

    it('revokes every session belonging to the admin', async () => {
      const account = await newAdmin();
      const first = await login(account.username, account.password).expect(200);
      const second = await login(account.username, account.password).expect(200);
      const direct = await issueSession(account.id);

      await changeRequest(first, validBody(account.password)).expect(200);

      for (const cookies of [
        cookieHeader(first),
        cookieHeader(second),
        `${SESSION_COOKIE}=${direct.token}`,
      ]) {
        await request(app.getHttpServer())
          .get(ME)
          .set('Cookie', cookies)
          .expect(401);
      }

      assert.equal(
        await prisma.session.count({ where: { adminId: account.id } }),
        0,
      );
    });

    it('leaves another administrator and their sessions untouched', async () => {
      const account = await newAdmin();
      const other = await newAdmin();
      const session = await login(account.username, account.password).expect(200);
      const otherSession = await login(
        other.username,
        other.password,
      ).expect(200);
      const otherHash = await storedHash(other.id);

      // A client cannot pick the target account: unknown fields are rejected.
      await changeRequest(session, {
        ...validBody(account.password),
        adminId: other.id,
      }).expect(400);

      const response = await changeRequest(
        session,
        validBody(account.password),
      ).expect(200);
      assert.equal(response.body.success, true);

      await request(app.getHttpServer())
        .get(ME)
        .set('Cookie', cookieHeader(otherSession))
        .expect(200);
      assert.equal(await storedHash(other.id), otherHash);
    });

    it('no longer accepts the old password for login', async () => {
      const account = await newAdmin();
      const session = await login(account.username, account.password).expect(200);

      await changeRequest(session, validBody(account.password)).expect(200);

      await login(account.username, account.password).expect(401);
    });

    it('accepts the new password for login', async () => {
      const account = await newAdmin();
      const session = await login(account.username, account.password).expect(200);

      await changeRequest(session, validBody(account.password)).expect(200);

      const response = await login(account.username, NEW_PASSWORD).expect(200);
      assert.equal(response.body.admin.username, account.username);
    });

    it('does not let concurrent changes overwrite a newer password', async () => {
      const account = await newAdmin();
      const session = await login(account.username, account.password).expect(200);
      const candidates = [NEW_PASSWORD, 'a-second-brand-new-passphrase'];

      const results = await Promise.all(
        candidates.map((newPassword) =>
          changeRequest(session, {
            currentPassword: account.password,
            newPassword,
            confirmPassword: newPassword,
          }),
        ),
      );

      const statuses = results.map((result) => result.status).sort();
      assert.equal(statuses[0], 200);
      assert.ok(
        statuses[1] === 400 || statuses[1] === 409,
        `unexpected second status ${statuses[1]}`,
      );

      const winner = candidates[results.findIndex((result) => result.status === 200)];
      const loser = candidates.find((candidate) => candidate !== winner);
      assert.ok(loser);

      const after = await storedHash(account.id);
      assert.match(after, /^\$2[aby]\$12\$/);

      await login(account.username, winner).expect(200);
      await login(account.username, loser).expect(401);
      await login(account.username, account.password).expect(401);
    });
  });
});

describe('Login origin validation (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let adminId: string;

  const username = `__test_origin_${randomUUID().slice(0, 8)}`;

  before(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.set('trust proxy', true);
    await app.init();

    prisma = moduleRef.get(PrismaService);
    const admin = await prisma.admin.create({
      data: {
        username,
        email: `${username}@example.com`,
        passwordHash: await hash(PASSWORD, 12),
      },
      select: { id: true },
    });
    adminId = admin.id;
  });

  after(async () => {
    await prisma.admin.deleteMany({ where: { id: adminId } });
    await app.close();
  });

  function attempt(origin?: string): request.Test {
    const call = request(app.getHttpServer())
      .post(LOGIN)
      .set('X-Forwarded-For', nextIp());
    if (origin !== undefined) call.set('Origin', origin);
    return call.send({ identifier: username, password: PASSWORD });
  }

  it('accepts the configured admin origin', async () => {
    await attempt(adminOrigin()).expect(200);
  });

  it('rejects an unexpected origin', async () => {
    const response = await attempt('https://evil.example').expect(403);
    assert.equal(response.body.message, 'Invalid origin');
  });

  it('rejects a missing Origin header', async () => {
    await attempt().expect(403);
  });

  it('rejects a malformed Origin header', async () => {
    await attempt('not a url').expect(403);
  });

  it('rejects a different port', async () => {
    const configured = new URL(adminOrigin());
    await attempt(`http://${configured.hostname}:${Number(configured.port || 80) + 1}`).expect(403);
  });

  it('rejects a different hostname', async () => {
    const configured = new URL(adminOrigin());
    const otherHost = configured.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
    await attempt(`${configured.protocol}//${otherHost}:${configured.port || 80}`).expect(403);
  });
});

describe('Auth cookie configuration', () => {
  it('uses __Host- names and Secure attributes in production', () => {
    assert.equal(sessionCookieName(true), '__Host-dheera_session');
    assert.equal(csrfCookieName(true), '__Host-dheera_csrf');

    const session = sessionCookieOptions(true, 1000);
    assert.equal(session.secure, true);
    assert.equal(session.httpOnly, true);
    assert.equal(session.sameSite, 'lax');
    assert.equal(session.path, '/');
    assert.equal(session.domain, undefined);

    const csrf = csrfCookieOptions(true, 1000);
    assert.equal(csrf.secure, true);
    assert.equal(csrf.httpOnly, false);
    assert.equal(csrf.path, '/');
  });

  it('keeps development cookies unprefixed and non-Secure', () => {
    assert.equal(sessionCookieName(false), SESSION_COOKIE);
    assert.equal(csrfCookieName(false), CSRF_COOKIE);
    assert.equal(sessionCookieOptions(false, 1000).secure, false);
    assert.equal(csrfCookieOptions(false, 1000).secure, false);
  });
});

describe('Bcrypt password limit', () => {
  it('measures UTF-8 bytes rather than characters', () => {
    assert.equal(passwordByteLength('a'.repeat(72)), 72);
    assert.equal(passwordByteLength('€'.repeat(24)), 72);
    assert.equal(isPasswordWithinBcryptLimit('a'.repeat(72)), true);
    assert.equal(isPasswordWithinBcryptLimit('a'.repeat(73)), false);
    assert.equal(isPasswordWithinBcryptLimit('€'.repeat(24)), true);
    assert.equal(isPasswordWithinBcryptLimit('€'.repeat(25)), false);
  });
});
