import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

/**
 * Login CSRF protection: a browser always sends Origin on a POST, so a
 * cross-site login attempt carries the attacker's origin and is rejected here.
 * A missing Origin is rejected too (documented policy: the admin frontend
 * always sends one; non-browser clients must set it explicitly). Only the
 * Origin header is trusted; proxy headers cannot influence this check.
 */
@Injectable()
export class LoginOriginGuard implements CanActivate {
  private readonly allowedOrigins: Set<string>;

  constructor(config: ConfigService) {
    this.allowedOrigins = new Set(
      String(config.get('ADMIN_FRONTEND_ORIGIN') ?? '')
        .split(',')
        .map(normalizeOrigin)
        .filter((origin): origin is string => origin !== null),
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const origin = request.headers.origin;

    if (typeof origin !== 'string') {
      throw new ForbiddenException('Invalid origin');
    }

    const normalized = normalizeOrigin(origin);
    if (!normalized || !this.allowedOrigins.has(normalized)) {
      throw new ForbiddenException('Invalid origin');
    }

    return true;
  }
}

/** Returns a canonical http(s) origin, or null for anything malformed. */
export function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}
