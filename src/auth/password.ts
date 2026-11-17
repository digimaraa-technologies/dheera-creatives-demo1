// bcrypt only reads the first 72 bytes of a password. New credentials are
// capped at that limit instead of being silently truncated. Login-side
// enforcement is intentionally deferred: the existing admin password cannot be
// verified without exposing or resetting it (see README "Password length").
export const MAX_PASSWORD_BYTES = 72;

export function passwordByteLength(password: string): number {
  return Buffer.byteLength(password, 'utf8');
}

export function isPasswordWithinBcryptLimit(password: string): boolean {
  return passwordByteLength(password) <= MAX_PASSWORD_BYTES;
}
