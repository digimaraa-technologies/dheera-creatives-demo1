import type { ThrottlerModuleOptions } from '@nestjs/throttler';

// One-minute windows, keyed by client IP and route handler. The counters live
// in this process only, so limits are not shared between instances (see README).
export const RATE_LIMIT_WINDOW_MS = 60_000;

export const RATE_LIMITS = {
  // Unauthenticated catalogue browsing.
  public: { limit: 120, ttl: RATE_LIMIT_WINDOW_MS },
  // Authenticated dashboard reads (lists, details, session bootstrap).
  adminRead: { limit: 240, ttl: RATE_LIMIT_WINDOW_MS },
  // Create, update, delete and reorder.
  adminWrite: { limit: 60, ttl: RATE_LIMIT_WINDOW_MS },
  // Image uploads are the most expensive admin operation.
  uploads: { limit: 30, ttl: RATE_LIMIT_WINDOW_MS },
  // Authenticated session endpoints: /me, logout and logout-all. Generous for
  // dashboard bootstrap and sign-out, still bounded against scripted abuse.
  session: { limit: 60, ttl: RATE_LIMIT_WINDOW_MS },
  // Login brute-force protection (Phase 1).
  login: { limit: 5, ttl: RATE_LIMIT_WINDOW_MS },
} as const;

// The default applies to public routes that do not override it. Admin routes
// and login add their own @Throttle override.
export const THROTTLER_OPTIONS: ThrottlerModuleOptions = {
  throttlers: [{ name: 'default', ...RATE_LIMITS.public }],
  // Generic body: never reveal the limiter or its configured numbers.
  errorMessage: 'Too many requests',
  setHeaders: false,
};
