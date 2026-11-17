import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import {
  CSRF_HEADER,
  readSecurityCookies,
} from '../auth.cookies';
import { AuthService, hashToken } from '../auth.service';
import { AuthenticatedRequest } from '../auth.types';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Protects admin-only routes. Apply with `@UseGuards(AdminAuthGuard)`.
 * Validates the session cookie and, for state-changing requests, the
 * session-bound CSRF token, so a guarded route cannot forget CSRF.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const cookies = readSecurityCookies(
      request.headers.cookie,
      this.auth.isProduction,
    );

    if (!cookies.session) {
      throw new UnauthorizedException('Authentication required');
    }

    const session = await this.auth.validateSession(cookies.session);
    if (!session) {
      throw new UnauthorizedException('Authentication required');
    }

    request.admin = session.admin;
    request.sessionId = session.sessionId;

    if (!SAFE_METHODS.has(request.method)) {
      const headerToken = request.headers[CSRF_HEADER];
      if (
        typeof headerToken !== 'string' ||
        !headerToken ||
        !cookies.csrf ||
        !tokensMatch(cookies.csrf, headerToken)
      ) {
        throw new ForbiddenException('Invalid CSRF token');
      }

      if (session.csrfHash === null) {
        // Pre-binding session: adopt the token it presented once.
        await this.auth.bindCsrf(session.sessionId, headerToken);
      } else if (!hashMatches(headerToken, session.csrfHash)) {
        throw new ForbiddenException('Invalid CSRF token');
      }
    }

    return true;
  }
}

function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function hashMatches(token: string, expectedHex: string): boolean {
  const actual = Buffer.from(hashToken(token), 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
