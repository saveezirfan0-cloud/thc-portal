import { createHash, timingSafeEqual } from 'node:crypto';

import { RESCAN_PATH } from './rescan-path';

export { RESCAN_PATH };

/**
 * The Back Office's "Retry AI scan" reaches the Staff App here, because the
 * reader (Claude, its key and SDK) lives only in this app (ADR-0033).
 * `POST /api/internal/rescan-document` with
 * `Authorization: Bearer <DOCUMENT_RESCAN_SECRET>` — the same value as on the
 * Back Office project. No session is involved (the middleware lets this one
 * path through, POST only); the office server action checks the caller is a
 * reviewer before it ever sends the call.
 */
export const MIN_SECRET_LENGTH = 32;

export type GateAnswer = 'ok' | 'not_configured' | 'unauthorised';

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** Constant-time; a missing or short secret refuses everything. */
export function checkRescanSecret(header: string | null, secret: string | undefined): GateAnswer {
  if (!secret || secret.length < MIN_SECRET_LENGTH) return 'not_configured';
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '');
  if (!match) return 'unauthorised';
  return timingSafeEqual(digest(match[1]!), digest(secret)) ? 'ok' : 'unauthorised';
}
