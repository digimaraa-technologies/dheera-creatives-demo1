import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

export const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_ATTEMPT_MAX_FAILURES = 20;
// Hard cap on tracked identifiers. 10k entries of at most 254 characters keep
// the map in the low megabytes even under a deliberate flood.
export const LOGIN_ATTEMPT_CAPACITY = 10_000;

// Sweeping the whole map on every failure would make a full map a CPU DoS, so
// expired entries are removed at most once a minute (plus lazily per lookup).
const SWEEP_INTERVAL_MS = 60 * 1000;

const TOO_MANY = 'Too many failed login attempts. Try again later.';

interface Attempts {
  count: number;
  firstAt: number;
}

/**
 * Account-level login protection, independent of the per-IP throttle: an
 * attacker rotating IPs still cannot keep guessing one account's password.
 * In-memory, so it is per process; a restart clears it.
 *
 * The map is bounded. At capacity a *failed* login for an untracked identifier
 * is refused with 429 instead of evicting an existing counter (which would let
 * an attacker reset a victim's count) or silently skipping the counter (which
 * would let them brute-force untracked accounts). Successful logins are never
 * blocked by capacity because they do not need a map entry.
 */
@Injectable()
export class LoginAttemptsService {
  private readonly attempts = new Map<string, Attempts>();
  private lastSweepAt = Date.now();

  /** Number of identifiers currently tracked; exposed for tests/monitoring. */
  get trackedCount(): number {
    return this.attempts.size;
  }

  /** Throws 429 when the identifier is locked out. Call before bcrypt. */
  assertAllowed(identifier: string): void {
    const entry = this.liveEntry(identifier);
    if (entry && entry.count >= LOGIN_ATTEMPT_MAX_FAILURES) {
      throw new HttpException(TOO_MANY, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /**
   * Records a failed login. Throws 429 when the map is full and this identifier
   * is not tracked yet, so the failure cannot go uncounted.
   */
  recordFailure(identifier: string): void {
    const now = Date.now();
    const entry = this.liveEntry(identifier, now);

    if (entry) {
      entry.count = Math.min(entry.count + 1, LOGIN_ATTEMPT_MAX_FAILURES);
      return;
    }

    this.sweepIfDue(now);

    if (this.attempts.size >= LOGIN_ATTEMPT_CAPACITY) {
      throw new HttpException(TOO_MANY, HttpStatus.TOO_MANY_REQUESTS);
    }

    this.attempts.set(identifier, { count: 1, firstAt: now });
  }

  reset(identifier: string): void {
    this.attempts.delete(identifier);
  }

  private liveEntry(identifier: string, now = Date.now()): Attempts | undefined {
    const entry = this.attempts.get(identifier);
    if (!entry) return undefined;

    if (now - entry.firstAt > LOGIN_ATTEMPT_WINDOW_MS) {
      this.attempts.delete(identifier);
      return undefined;
    }

    return entry;
  }

  private sweepIfDue(now: number): void {
    if (now - this.lastSweepAt < SWEEP_INTERVAL_MS) return;
    this.lastSweepAt = now;

    for (const [key, entry] of this.attempts) {
      if (now - entry.firstAt > LOGIN_ATTEMPT_WINDOW_MS) {
        this.attempts.delete(key);
      }
    }
  }
}
