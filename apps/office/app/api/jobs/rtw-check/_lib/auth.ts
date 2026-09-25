import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * The runner's one door (ADR-0025). Only the rtw-check relay holds
 * RTW_JOB_SECRET; a signed-in admin, a worker and anonymous callers are
 * all refused the same way.
 *
 * Constant time: both sides are hashed to 32 bytes first, so neither the
 * comparison nor an early length check says how much of a guess was right.
 * A secret shorter than 32 characters counts as not configured.
 */
export const RTW_JOB_SECRET_MIN_LENGTH = 32;

export function isAuthorisedJobCall(
  authorization: string | null,
  secret: string | undefined,
): boolean {
  if (!secret || secret.length < RTW_JOB_SECRET_MIN_LENGTH) return false;
  if (!authorization || !authorization.startsWith('Bearer ')) return false;
  const given = createHash('sha256').update(authorization.slice('Bearer '.length)).digest();
  const expected = createHash('sha256').update(secret).digest();
  return timingSafeEqual(given, expected);
}
