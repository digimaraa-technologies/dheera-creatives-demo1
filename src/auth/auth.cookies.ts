import type { CookieOptions } from 'express';

export const SESSION_COOKIE = 'dheera_session';
export const CSRF_COOKIE = 'dheera_csrf';
export const CSRF_HEADER = 'x-csrf-token';

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

/** Minimal parser so the app does not need cookie-parser middleware. */
export function readCookie(
  cookieHeader: string | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader) return undefined;

  for (const pair of cookieHeader.split(';')) {
    const separator = pair.indexOf('=');
    if (separator === -1) continue;
    if (pair.slice(0, separator).trim() === name) {
      return pair.slice(separator + 1).trim();
    }
  }

  return undefined;
}
