import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

export const PASSWORD_CHANGE_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
export const PASSWORD_CHANGE_ATTEMPT_MAX_FAILURES = 10;
// Hard cap on tracked administrators. 10k entries keep memory bounded.
export const PASSWORD_CHANGE_ATTEMPT_CAPACITY = 10_000;
// Maximum admitted change-password operations per admin at once (active + waiting).
export const PASSWORD_CHANGE_MAX_ADMITTED_PER_ADMIN = 10;
// Sweep expired counters at most once a minute, plus lazily per lookup.
const SWEEP_INTERVAL_MS = 60 * 1000;

const TOO_MANY =
  'Too many incorrect password attempts. Please try again after the temporary security lockout.';
export const PASSWORD_CHANGE_BUSY_MESSAGE =
  'Too many password change requests. Please try again shortly.';

interface Attempts {
  count: number;
  firstAt: number;
}

/**
 * Per-admin failed-current-password-attempt protection for change-password.
 * Keyed by the authenticated administrator ID from the validated session.
 *
 * In-memory and per process (suitable for the current single-instance
 * architecture). Counters are independent from LoginAttemptsService and from
 * the per-IP throttle. A restart clears state.
 *
 * The counter is bounded: at capacity a failure for an untracked admin is
 * refused with 429 rather than evicting an existing counter (which would let an
 * attacker reset a victim's lockout) or silently dropping the count. Active
 * lockouts are never evicted by cleanup.
 *
 * Admitted operations for one admin are serialized (active + waiting capped)
 * so concurrent requests cannot bypass the threshold or perform bcrypt
 * verification once the account is locked, and excess requests are rejected
 * immediately without queueing.
 */
@Injectable()
export class PasswordChangeAttemptsService {
  private readonly attempts = new Map<string, Attempts>();
  private readonly locks = new Map<string, Promise<void>>();
  private readonly inflight = new Map<string, number>();
  private lastSweepAt = Date.now();

  /** Number of administrators currently tracked; exposed for tests/monitoring. */
  get trackedCount(): number {
    return this.attempts.size;
  }

  /** Admitted operations for an admin (active + waiting); exposed for tests. */
  inflightCount(adminId: string): number {
    return this.inflight.get(adminId) ?? 0;
  }

  /** Removes every tracked counter and lock; intended for tests. */
  clear(): void {
    this.attempts.clear();
    this.locks.clear();
    this.inflight.clear();
  }

  /**
   * Serializes work for one admin. At most PASSWORD_CHANGE_MAX_ADMITTED_PER_ADMIN
   * operations (active + waiting) are admitted per admin; excess requests are
   * rejected immediately with a generic 429 and are never queued. Use around the
   * lockout check, current-password verification and failure/success recording so
   * concurrent requests cannot bypass the threshold or run extra bcrypt
   * comparisons after lockout.
   */
  async runExclusive<T>(adminId: string, work: () => Promise<T> | T): Promise<T> {
    const admitted = this.inflight.get(adminId) ?? 0;
    if (admitted >= PASSWORD_CHANGE_MAX_ADMITTED_PER_ADMIN) {
      throw new HttpException(
        PASSWORD_CHANGE_BUSY_MESSAGE,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.inflight.set(adminId, admitted + 1);

    const previous = this.locks.get(adminId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current, () => current);
    this.locks.set(adminId, queued);
    await previous.catch(() => undefined);
    try {
      return await work();
    } finally {
      release();
      if (this.locks.get(adminId) === queued) {
        this.locks.delete(adminId);
      }
      const remaining = (this.inflight.get(adminId) ?? 1) - 1;
      if (remaining <= 0) {
        this.inflight.delete(adminId);
      } else {
        this.inflight.set(adminId, remaining);
      }
    }
  }

  /** Throws 429 when the admin is locked out. Call before bcrypt verification. */
  assertAllowed(adminId: string): void {
    const entry = this.liveEntry(adminId);
    if (entry && entry.count >= PASSWORD_CHANGE_ATTEMPT_MAX_FAILURES) {
      throw new HttpException(TOO_MANY, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /**
   * Records a failed current-password verification. Call only after an
   * authenticated, CSRF-valid, DTO-valid request actually performed bcrypt
   * verification and it failed. Throws 429 when the map is full and this admin
   * is not tracked yet, so the failure cannot go uncounted.
   */
  recordFailure(adminId: string): void {
    const now = Date.now();
    const entry = this.liveEntry(adminId, now);

    if (entry) {
      entry.count = Math.min(
        entry.count + 1,
        PASSWORD_CHANGE_ATTEMPT_MAX_FAILURES,
      );
      return;
    }

    this.sweepIfDue(now);

    if (this.attempts.size >= PASSWORD_CHANGE_ATTEMPT_CAPACITY) {
      throw new HttpException(TOO_MANY, HttpStatus.TOO_MANY_REQUESTS);
    }

    this.attempts.set(adminId, { count: 1, firstAt: now });
  }

  /** Clears failed-attempt state after a successful password change. */
  reset(adminId: string): void {
    this.attempts.delete(adminId);
  }

  private liveEntry(adminId: string, now = Date.now()): Attempts | undefined {
    const entry = this.attempts.get(adminId);
    if (!entry) return undefined;

    // Expiry is measured from the first failure in the window; after the window
    // passes the admin may attempt again and expired state is removed.
    if (now - entry.firstAt > PASSWORD_CHANGE_ATTEMPT_WINDOW_MS) {
      this.attempts.delete(adminId);
      return undefined;
    }

    return entry;
  }

  private sweepIfDue(now: number): void {
    if (now - this.lastSweepAt < SWEEP_INTERVAL_MS) return;
    this.lastSweepAt = now;

    for (const [key, entry] of this.attempts) {
      // Only expired entries are removed; active lockouts are preserved.
      if (now - entry.firstAt > PASSWORD_CHANGE_ATTEMPT_WINDOW_MS) {
        this.attempts.delete(key);
      }
    }
  }
}
