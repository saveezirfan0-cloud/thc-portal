import { createHmac } from 'node:crypto';

/**
 * RFC 6238 TOTP, the kind GoTrue's `mfa.enroll({ factorType: 'totp' })`
 * issues (ADR-0057): HMAC-SHA1, 30-second steps, 6 digits, a base32
 * secret. What the manager's authenticator app computes, so the two-step
 * journey can type a real code without a phone. node:crypto only — no
 * dependency for thirty lines.
 */

export const STEP_SECONDS = 30;
const DIGITS = 6;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * The secret as the /account panel prints it — `groupSecret()` splits it
 * into groups of four — back to bytes. Spaces, dashes, padding and case
 * are ignored, as an authenticator app ignores them.
 */
export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error(`not a base32 secret: ${JSON.stringify(char)} in it`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The 30-second step a moment falls in (RFC 6238 §4, T0 = 0). */
export function stepAt(ms: number = Date.now()): number {
  return Math.floor(ms / 1000 / STEP_SECONDS);
}

/** RFC 4226 HOTP for one counter, zero-padded to six digits. */
export function hotp(secret: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(message).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary =
    ((mac[offset]! & 0x7f) << 24) |
    (mac[offset + 1]! << 16) |
    (mac[offset + 2]! << 8) |
    mac[offset + 3]!;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/** The code an authenticator shows for this base32 secret at this moment. */
export function totp(secret: string, ms: number = Date.now()): string {
  return hotp(base32Decode(secret), stepAt(ms));
}

/**
 * A code from a step LATER than `after`, waiting for the next step if need
 * be (at most 30 s). A code already spent — the one that turned two-step on
 * — may be refused if typed again inside its own window, so the sign-in
 * journey never reuses one.
 */
export async function nextCode(
  secret: string,
  after: number,
): Promise<{ code: string; step: number }> {
  for (;;) {
    const now = Date.now();
    const step = stepAt(now);
    if (step > after) return { code: totp(secret, now), step };
    const wait = (step + 1) * STEP_SECONDS * 1000 - now + 250;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

/**
 * Six digits that are NOT this secret's code at any moment GoTrue would
 * accept (the current step and one either side, for clock skew).
 */
export function wrongCode(secret: string, ms: number = Date.now()): string {
  const key = base32Decode(secret);
  const step = stepAt(ms);
  const valid = new Set([hotp(key, step - 1), hotp(key, step), hotp(key, step + 1)]);
  let candidate = Number(hotp(key, step));
  for (;;) {
    candidate = (candidate + 111_111) % 10 ** DIGITS;
    const code = String(candidate).padStart(DIGITS, '0');
    if (!valid.has(code)) return code;
  }
}
