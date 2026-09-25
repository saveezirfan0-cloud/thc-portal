import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * The job route's gate (ADR-0025): `Authorization: Bearer <RTW_JOB_SECRET>`,
 * the same value pg_cron sends from the vault secret `rtw_job_secret`.
 *
 * Constant-time: both sides are hashed to 32 bytes first, so neither the
 * comparison nor an early length check says how much of a guess was right.
 * A missing or short secret refuses everything — the route never runs
 * unauthenticated because its configuration is incomplete.
 */
export const MIN_SECRET_LENGTH = 32;

export function bearerToken(header: string | null): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '');
  return match ? match[1]! : null;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export type GateAnswer = 'ok' | 'not_configured' | 'unauthorised';

export function checkJobSecret(header: string | null, secret: string | undefined): GateAnswer {
  if (!secret || secret.length < MIN_SECRET_LENGTH) return 'not_configured';
  const token = bearerToken(header);
  if (!token) return 'unauthorised';
  return timingSafeEqual(digest(token), digest(secret)) ? 'ok' : 'unauthorised';
}
