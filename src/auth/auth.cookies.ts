import { BadRequestException } from '@nestjs/common';
import type { CookieOptions } from 'express';

// Base names. In production the `__Host-` prefix is added, which requires
// Secure, Path=/ and no Domain attribute.
export const SESSION_COOKIE = 'dheera_session';
export const CSRF_COOKIE = 'dheera_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const HOST_PREFIX = '__Host-';

export function sessionCookieName(isProduction: boolean): string {
  return isProduction ? `${HOST_PREFIX}${SESSION_COOKIE}` : SESSION_COOKIE;
}

export function csrfCookieName(isProduction: boolean): string {
  return isProduction ? `${HOST_PREFIX}${CSRF_COOKIE}` : CSRF_COOKIE;
}

export function sessionCookieOptions(
  isProduction: boolean,
  maxAgeMs: number,
): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeMs,
  };
}

export function csrfCookieOptions(
  isProduction: boolean,
  maxAgeMs: number,
): CookieOptions {
  // Not HttpOnly: the admin UI must read it and echo it in the CSRF header.
  // The server validates the echoed token against the session, so reading the
  // cookie alone cannot authorize a request.
  return {
    httpOnly: false,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeMs,
  };
}

export function clearCookieOptions(
  isProduction: boolean,
  httpOnly: boolean,
): CookieOptions {
  return { httpOnly, secure: isProduction, sameSite: 'lax', path: '/' };
}

export interface SecurityCookies {
  session?: string;
  csrf?: string;
}

/**
 * Reads the session and CSRF cookies and rejects duplicate security cookie
 * names. Duplicates are ambiguous: accepting either the first or the last value
 * would let a cookie-ordering trick decide which one the app trusts.
 * Unrelated cookies are ignored, including duplicate unrelated names.
 */
export function readSecurityCookies(
  cookieHeader: string | undefined,
  isProduction: boolean,
): SecurityCookies {
  const sessionName = sessionCookieName(isProduction);
  const csrfName = csrfCookieName(isProduction);
  const result: SecurityCookies = {};

  if (!cookieHeader) return result;

  for (const pair of cookieHeader.split(';')) {
    const separator = pair.indexOf('=');
    if (separator === -1) continue;

    const name = pair.slice(0, separator).trim();
    if (name !== sessionName && name !== csrfName) continue;

    const alreadySeen = name === sessionName ? result.session !== undefined : result.csrf !== undefined;
    if (alreadySeen) {
      throw new BadRequestException('Ambiguous security cookies');
    }

    const value = pair.slice(separator + 1).trim();
    if (name === sessionName) result.session = value;
    else result.csrf = value;
  }

  return result;
}
