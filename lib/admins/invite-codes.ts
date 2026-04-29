import { randomBytes } from 'crypto';

/**
 * Generates an 8-character invite code in the form ABCD-1234. Uses
 * unambiguous characters so the principal can read the code over the
 * phone if needed (no 0/O, 1/I/L mix-ups).
 */
export function generateInviteCode(): string {
  const letters = 'ABCDEFGHJKMNPQRSTUVWXYZ';  // no I, O, L
  const digits = '23456789';                   // no 0, 1
  const buf = randomBytes(8);
  const pick = (set: string, idx: number) => set[buf[idx] % set.length];
  return `${pick(letters, 0)}${pick(letters, 1)}${pick(letters, 2)}${pick(letters, 3)}-${pick(digits, 4)}${pick(digits, 5)}${pick(digits, 6)}${pick(digits, 7)}`;
}

/** Default invite code lifetime — 48 hours from creation. */
export const INVITE_CODE_TTL_HOURS = 48;

/** Compute the absolute expiry timestamp for a fresh code. */
export function computeInviteCodeExpiry(): string {
  const d = new Date();
  d.setHours(d.getHours() + INVITE_CODE_TTL_HOURS);
  return d.toISOString();
}
