import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { compare } from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SAFE_ADMIN_SELECT, SafeAdmin } from './auth.types';
import { LoginDto } from './dto/login.dto';

// Checked when the account does not exist, so both login paths cost one bcrypt
// comparison and response time does not reveal whether a username is valid.
const DUMMY_PASSWORD_HASH =
  '$2b$12$ejrNMfOcQjH5H/ClocCwa.K.bXYaZfN1aKc.3gDPMm35DY7FRpsAa';

export interface CreatedSession {
  admin: SafeAdmin;
  token: string;
  csrfToken: string;
  expiresAt: Date;
}

@Injectable()
export class AuthService {
  readonly sessionTtlMs: number;
  readonly isProduction: boolean;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.sessionTtlMs =
      Number(config.get('SESSION_TTL_HOURS') ?? 8) * 60 * 60 * 1000;
    // Read directly: @nestjs/config can serve a stale validated layer when the
    // app is bootstrapped twice in one process (tests).
    this.isProduction = process.env.NODE_ENV === 'production';
  }

  async login(dto: LoginDto): Promise<CreatedSession> {
    const identifier = dto.identifier.trim();
    const admin = await this.prisma.admin.findFirst({
      where: {
        OR: [
          { username: identifier },
          { email: identifier.toLowerCase() },
        ],
      },
    });

    const passwordMatches = await compare(
      dto.password,
      admin?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );
    if (!admin || !passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Opaque 256-bit token; only its SHA-256 hash is stored.
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.sessionTtlMs);

    await this.prisma.$transaction([
      this.prisma.session.deleteMany({
        where: { adminId: admin.id, expiresAt: { lt: new Date() } },
      }),
      this.prisma.session.create({
        data: { tokenHash: hashToken(token), adminId: admin.id, expiresAt },
      }),
    ]);

    return {
      admin: {
        id: admin.id,
        username: admin.username,
        email: admin.email,
        createdAt: admin.createdAt,
        updatedAt: admin.updatedAt,
      },
      token,
      csrfToken,
      expiresAt,
    };
  }

  async validateSession(
    token: string,
  ): Promise<{ admin: SafeAdmin; sessionId: string } | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        id: true,
        expiresAt: true,
        admin: { select: SAFE_ADMIN_SELECT },
      },
    });

    if (!session) return null;

    if (session.expiresAt.getTime() <= Date.now()) {
      await this.prisma.session.deleteMany({ where: { id: session.id } });
      return null;
    }

    return { admin: session.admin, sessionId: session.id };
  }

  async logout(token: string): Promise<void> {
    await this.prisma.session.deleteMany({
      where: { tokenHash: hashToken(token) },
    });
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
