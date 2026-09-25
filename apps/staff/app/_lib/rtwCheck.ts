/**
 * The worker's view of the automated gov.uk share-code check (ADR-0025).
 *
 * `my_rtw_check()` (20260928090000) answers `null` or exactly
 * `{ status, outcome, checkedAt }` for the caller's latest check. The worker
 * never gets the name, dates or conditions gov.uk returned — the RPC does
 * not select them, and nothing here has a field to put them in.
 *
 * Pure (no Next, no Supabase, no copy): the words are
 * `rtwCheckWorkerLine()`'s in packages/domain, applied by the server loader
 * in `./rtwCheckLine.ts`. What this file decides is only WHEN a line shows:
 * on a share code that is still pending with the office, and never from a
 * check that finished before that share code was entered.
 */

export type RtwCheckStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type RtwCheckOutcome =
  'pass' | 'name_mismatch' | 'conditions_mismatch' | 'not_found' | 'no_right_to_work';

export interface WorkerRtwCheck {
  status: RtwCheckStatus;
  outcome: RtwCheckOutcome | null;
  checkedAt: string | null;
}

/** The line to show, with the stamp it was checked at (null until it ran). */
export interface RtwCheckLine {
  line: string;
  checkedAt: string | null;
}

const STATUSES: ReadonlySet<string> = new Set(['queued', 'running', 'done', 'failed', 'cancelled']);
const OUTCOMES: ReadonlySet<string> = new Set([
  'pass',
  'name_mismatch',
  'conditions_mismatch',
  'not_found',
  'no_right_to_work',
]);

/**
 * `my_rtw_check()`'s JSON, typed. Anything this build does not recognise
 * reads as "no check", so the screen falls back to what it showed before
 * the job existed rather than guessing.
 */
export function parseRtwCheck(raw: unknown): WorkerRtwCheck | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const status = r['status'];
  if (typeof status !== 'string' || !STATUSES.has(status)) return null;
  const outcome = r['outcome'];
  const checkedAt = r['checkedAt'];
  return {
    status: status as RtwCheckStatus,
    outcome:
      typeof outcome === 'string' && OUTCOMES.has(outcome) ? (outcome as RtwCheckOutcome) : null,
    checkedAt: typeof checkedAt === 'string' && checkedAt !== '' ? checkedAt : null,
  };
}

/**
 * The check line for one share-code document, or null.
 *
 * Only while the document is pending: once the office verifies or rejects
 * it, the row's own Verified / Rejected (N8 reason, re-enter) is the whole
 * story. A check stamped before the document was entered belongs to an
 * earlier code, so it says nothing about this one.
 */
export function rtwLineForDoc(
  check: RtwCheckLine | null | undefined,
  doc: { pending: boolean; uploadedAt: string },
): string | null {
  if (!check || !doc.pending) return null;
  if (check.checkedAt && doc.uploadedAt) {
    const checked = Date.parse(check.checkedAt);
    const entered = Date.parse(doc.uploadedAt);
    if (Number.isFinite(checked) && Number.isFinite(entered) && checked < entered) return null;
  }
  return check.line;
}
