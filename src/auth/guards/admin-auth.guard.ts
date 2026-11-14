import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  SESSION_COOKIE,
  readCookie,
} from '../auth.cookies';
import { AuthService } from '../auth.service';
import { AuthenticatedRequest } from '../auth.types';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Protects admin-only routes. Apply with `@UseGuards(AdminAuthGuard)`.
 * Validates the session cookie and, for state-changing requests, the
 * double-submit CSRF token, so a guarded route cannot forget CSRF.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (!token) {
      throw new UnauthorizedException('Authentication required');
    }

    const session = await this.auth.validateSession(token);
    if (!session) {
      throw new UnauthorizedException('Authentication required');
    }

    request.admin = session.admin;
    request.sessionId = session.sessionId;

    if (!SAFE_METHODS.has(request.method)) {
      const cookieToken = readCookie(request.headers.cookie, CSRF_COOKIE);
      const headerToken = request.headers[CSRF_HEADER];
      if (
        !cookieToken ||
        typeof headerToken !== 'string' ||
        !tokensMatch(cookieToken, headerToken)
      ) {
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
