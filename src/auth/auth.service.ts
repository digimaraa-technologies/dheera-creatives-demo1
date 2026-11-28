import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { compare, hash } from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SAFE_ADMIN_SELECT, SafeAdmin } from './auth.types';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { PasswordChangeAttemptsService } from './password-change-attempts.service';

// Checked when the account does not exist, so both login paths cost one bcrypt
// comparison and response time does not reveal whether a username is valid.
const DUMMY_PASSWORD_HASH =
  '$2b$12$ejrNMfOcQjH5H/ClocCwa.K.bXYaZfN1aKc.3gDPMm35DY7FRpsAa';

// lastSeenAt is written at most once a minute per session, so an active admin
// does not cause a database write on every request.
const ACTIVITY_UPDATE_MS = 60 * 1000;

export interface CreatedSession {
  admin: SafeAdmin;
  token: string;
  csrfToken: string;
  expiresAt: Date;
}

export interface ValidSession {
  admin: SafeAdmin;
  sessionId: string;
  csrfHash: string | null;
}

@Injectable()
export class AuthService {
  readonly sessionTtlMs: number;
  readonly idleTtlMs: number;
  readonly isProduction: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordChangeAttempts: PasswordChangeAttemptsService,
    config: ConfigService,
  ) {
    this.sessionTtlMs =
      Number(config.get('SESSION_TTL_HOURS') ?? 8) * 60 * 60 * 1000;
    this.idleTtlMs =
      Number(config.get('SESSION_IDLE_TTL_MINUTES') ?? 30) * 60 * 1000;
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

    // Opaque 256-bit token; only its SHA-256 hash is stored. The CSRF token is
    // generated per session and bound to it by storing its hash on the row.
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.sessionTtlMs);
    const idleCutoff = new Date(now.getTime() - this.idleTtlMs);

    await this.prisma.$transaction([
      this.prisma.session.deleteMany({
        where: {
          adminId: admin.id,
          OR: [
            { expiresAt: { lte: now } },
            { lastSeenAt: { lt: idleCutoff } },
          ],
        },
      }),
      this.prisma.session.create({
        data: {
          tokenHash: hashToken(token),
          csrfHash: hashToken(csrfToken),
          adminId: admin.id,
          expiresAt,
          lastSeenAt: now,
        },
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

  async validateSession(token: string): Promise<ValidSession | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        id: true,
        expiresAt: true,
        lastSeenAt: true,
        csrfHash: true,
        admin: { select: SAFE_ADMIN_SELECT },
      },
    });

    if (!session) return null;

    const now = Date.now();
    const idleExpired = session.lastSeenAt.getTime() <= now - this.idleTtlMs;
    if (session.expiresAt.getTime() <= now || idleExpired) {
      await this.prisma.session.deleteMany({ where: { id: session.id } });
      return null;
    }

    if (now - session.lastSeenAt.getTime() >= ACTIVITY_UPDATE_MS) {
      const updated = await this.prisma.session.updateMany({
        where: { id: session.id },
        data: { lastSeenAt: new Date(now) },
      });
      if (updated.count === 0) return null;
    }

    return {
      admin: session.admin,
      sessionId: session.id,
      csrfHash: session.csrfHash,
    };
  }

  /**
   * Binds a pre-binding session to the CSRF token it presented, so existing
   * sessions keep working instead of being invalidated by the migration.
   * updateMany makes the one-time write a no-op once another request won.
   */
  async bindCsrf(sessionId: string, csrfToken: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, csrfHash: null },
      data: { csrfHash: hashToken(csrfToken) },
    });
  }

  async logout(token: string): Promise<void> {
    await this.prisma.session.deleteMany({
      where: { tokenHash: hashToken(token) },
    });
  }

  async logoutAll(adminId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { adminId } });
  }

  /**
   * Changes the password for one admin and revokes every session they own,
   * including the caller's: the old session must not survive the change.
   *
   * Account-level failed-current-password protection is enforced per admin ID
   * from the validated session: the lockout is checked before bcrypt
   * verification, and verification/recording runs serialized per admin so
   * concurrent requests cannot bypass the threshold. Only an authenticated,
   * CSRF-valid, DTO-valid request whose current-password verification is
   * actually performed and fails increments the counter; DB errors and other
   * failures do not. A successful change resets stale failure state.
   *
   * The update is a compare-and-swap on the stored hash, so two concurrent
   * requests cannot both apply and an outdated verification can never
   * overwrite a newer password.
   */
  async changePassword(
    adminId: string,
    dto: ChangePasswordDto,
  ): Promise<void> {
    if (dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException(
        'New password and confirmation do not match',
      );
    }

    await this.passwordChangeAttempts.runExclusive(adminId, async () => {
      // Checked before bcrypt to avoid CPU work and to enforce lockout.
      this.passwordChangeAttempts.assertAllowed(adminId);

      const admin = await this.prisma.admin.findUnique({
        where: { id: adminId },
        select: { passwordHash: true },
      });
      if (!admin) {
        throw new UnauthorizedException('Authentication required');
      }

      // A valid session is not enough: the caller must prove the current
      // password, so a stolen cookie cannot lock the owner out.
      if (!(await compare(dto.currentPassword, admin.passwordHash))) {
        this.passwordChangeAttempts.recordFailure(adminId);
        throw new BadRequestException('Current password is incorrect');
      }

      // Compare through bcrypt, not strings: a value that only differs after
      // byte 72 maps to the same credential.
      if (await compare(dto.newPassword, admin.passwordHash)) {
        throw new BadRequestException(
          'New password must be different from the current password',
        );
      }

      const passwordHash = await hash(dto.newPassword, 12);

      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.admin.updateMany({
          where: { id: adminId, passwordHash: admin.passwordHash },
          data: { passwordHash },
        });
        if (updated.count === 0) {
          throw new ConflictException(
            'Password was changed by another request. Please sign in again.',
          );
        }

        // Only this admin's sessions; other administrators are untouched.
        await tx.session.deleteMany({ where: { adminId } });
      });

      this.passwordChangeAttempts.reset(adminId);
    });
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
