import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { hash } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import request from 'supertest';
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  SESSION_COOKIE,
} from '../../src/auth/auth.cookies';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { serveUploads } from '../../src/uploads/uploads.static';

export const TEST_PASSWORD = 'correct-horse-battery-staple';

export interface AdminSession {
  /** Full Cookie header containing both session and CSRF cookies. */
  cookie: string;
  /** Value to echo in the x-csrf-token header. */
  csrf: string;
}

export interface TestContext {
  app: NestExpressApplication;
  prisma: PrismaService;
  adminId: string;
  username: string;
  email: string;
  login(): Promise<AdminSession>;
  close(): Promise<void>;
}

let ipCounter = 0;

/** Unique client IP so each login gets its own rate-limit bucket. */
export function nextIp(): string {
  ipCounter += 1;
  return `10.2.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
}

export async function createTestContext(options: {
  uploadDir?: string;
  serveUploads?: boolean;
  servePublic?: boolean;
} = {}): Promise<TestContext> {
  if (options.uploadDir) {
    process.env.UPLOAD_DIR = options.uploadDir;
  }

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  app.set('trust proxy', true);
  if (options.servePublic) {
    app.useStaticAssets(join(process.cwd(), 'public'), { index: 'index.html' });
  }
  if (options.serveUploads) {
    serveUploads(app);
  }
  await app.init();

  const prisma = moduleRef.get(PrismaService);
  const username = `__test_admin_${randomUUID().slice(0, 8)}`;
  const email = `${username}@example.com`;
  const admin = await prisma.admin.create({
    data: { username, email, passwordHash: await hash(TEST_PASSWORD, 12) },
    select: { id: true },
  });

  return {
    app,
    prisma,
    adminId: admin.id,
    username,
    email,
    async login(): Promise<AdminSession> {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('X-Forwarded-For', nextIp())
        .send({ identifier: username, password: TEST_PASSWORD })
        .expect(200);

      const cookies = response.headers['set-cookie'] as unknown as string[];
      const pair = (name: string): string => {
        const cookie = cookies.find((value) => value.startsWith(`${name}=`));
        if (!cookie) {
          throw new Error(`Missing ${name} cookie in login response`);
        }
        return cookie.split(';')[0];
      };

      return {
        cookie: `${pair(SESSION_COOKIE)}; ${pair(CSRF_COOKIE)}`,
        csrf: pair(CSRF_COOKIE).split('=')[1],
      };
    },
    async close(): Promise<void> {
      await prisma.admin.deleteMany({ where: { username } });
      await app.close();
    },
  };
}

/** Headers for a state-changing admin request. */
export function adminHeaders(session: AdminSession): Record<string, string> {
  return { Cookie: session.cookie, [CSRF_HEADER]: session.csrf };
}
