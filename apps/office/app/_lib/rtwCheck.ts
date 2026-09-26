import {
  RTW_CHECK_SOURCE_LABEL,
  RTW_CHECK_STATUS_LABEL,
  isRtwCheckSource,
  isRtwCheckStatus,
  rtwCheckInFlight,
} from '@thc/domain';
import type { RtwCheckSource, RtwCheckStatus } from '@thc/domain';
import { rtwDateValue } from '../compliance/rtw';

/**
 * The automated gov.uk right-to-work check, as the office sees it (§2.6,
 * ADR-0025) — one pure view shared by the candidate profile, the staff
 * profile's Documents tab and /compliance, so the three say the same thing.
 *
 * `rtw_checks_latest_v` is security_invoker over the admin-read table, so a
 * session that is not the office's reads nothing.
 *
 * ADR-0041 (option C): with settings.rtw_check.admin_confirms on, the check
 * runs by itself but every result waits for an admin — needs_review with a
 * recommendation. "verify" shows gov.uk's date read-only for the admin to
 * confirm after comparing the photos; "reject" pre-fills the Reject box
 * with the office-only suggested N8 text; "review" is the old needs-review.
 */

/** One row of rtw_checks_latest_v (20260928100000). */
export interface RtwCheckRow {
  check_id: string;
  document_id: string;
  staff_id: string;
  status: RtwCheckStatus;
  source: RtwCheckSource | null;
  outcome: string | null;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  right_to_work_until: string | null;
  no_time_limit: boolean;
  conditions: string[] | null;
  term_time_limit_hours: number | null;
  record_name: string | null;
  reference_number: string | null;
  review_reason: string | null;
  worker_reason: string | null;
  error: string | null;
  report_path: string | null;
  reviewed_at: string | null;
  /**
   * Queued or running, untouched by the runner for longer than
   * settings.rtw_check.stale_after_minutes: the runner is not running
   * (rtw_check_stuck). The office may verify by hand.
   */
  stuck: boolean;
  /**
   * What the check recommends the admin does (ADR-0041): with
   * settings.rtw_check.admin_confirms on, every result waits in
   * needs_review carrying one of these, and the admin decides through the
   * one Verify / Reject path. Null on a check still in flight, and on a
   * row read before 20261001090000.
   */
  recommendation: RtwRecommendation | null;
  /**
   * The applicant photo gov.uk showed (a key in the private documents
   * bucket), for the admin to compare with the app selfie. Never handed to
   * the browser: rtwCheckPhotos() signs it on the server.
   */
  photo_path: string | null;
  /**
   * OFFICE-ONLY: the worker-facing N8 text the Reject box is pre-filled
   * with when the recommendation is reject. It reaches the worker only if
   * the admin rejects with it; nothing here may show it to the worker.
   */
  suggested_reason: string | null;
}

export type RtwRecommendation = 'verify' | 'reject' | 'review';

function isRecommendation(value: unknown): value is RtwRecommendation {
  return value === 'verify' || value === 'reject' || value === 'review';
}

export const RTW_CHECK_COLUMNS =
  'check_id, document_id, staff_id, status, source, outcome, attempts, max_attempts, ' +
  'next_attempt_at, created_at, started_at, finished_at, right_to_work_until, no_time_limit, ' +
  'conditions, term_time_limit_hours, record_name, reference_number, review_reason, ' +
  'worker_reason, error, report_path, reviewed_at, stuck, ' +
  // 20261001090000 (ADR-0041), appended to the view.
  'recommendation, photo_path, suggested_reason';

/** A row read from the view, with anything it could not type set safely. */
export function parseRtwCheckRow(raw: Record<string, unknown>): RtwCheckRow | null {
  if (!isRtwCheckStatus(raw['status'])) return null;
  const text = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null);
  const conditions = Array.isArray(raw['conditions'])
    ? (raw['conditions'] as unknown[]).filter((c): c is string => typeof c === 'string')
    : [];
  return {
    check_id: String(raw['check_id']),
    document_id: String(raw['document_id']),
    staff_id: String(raw['staff_id']),
    status: raw['status'],
    source: isRtwCheckSource(raw['source']) ? raw['source'] : null,
    outcome: text(raw['outcome']),
    attempts: Number(raw['attempts'] ?? 0),
    max_attempts: Number(raw['max_attempts'] ?? 5),
    next_attempt_at: text(raw['next_attempt_at']),
    created_at: String(raw['created_at'] ?? ''),
    started_at: text(raw['started_at']),
    finished_at: text(raw['finished_at']),
    right_to_work_until: text(raw['right_to_work_until']),
    no_time_limit: raw['no_time_limit'] === true,
    conditions,
    term_time_limit_hours:
      raw['term_time_limit_hours'] === null || raw['term_time_limit_hours'] === undefined
        ? null
        : Number(raw['term_time_limit_hours']),
    record_name: text(raw['record_name']),
    reference_number: text(raw['reference_number']),
    review_reason: text(raw['review_reason']),
    worker_reason: text(raw['worker_reason']),
    error: text(raw['error']),
    report_path: text(raw['report_path']),
    reviewed_at: text(raw['reviewed_at']),
    stuck: raw['stuck'] === true,
    // Absent before 20261001090000: read as "no recommendation".
    recommendation: isRecommendation(raw['recommendation']) ? raw['recommendation'] : null,
    photo_path: text(raw['photo_path']),
    suggested_reason: text(raw['suggested_reason']),
  };
}

// ---------------------------------------------------------------------
// Formatting (§1.8: a check is an audit stamp — UK time only)
// ---------------------------------------------------------------------

export function ukDateOnly(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

/** "25.09.2026 07:12 UK time". */
export function ukStampFull(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')} UK time`;
}

// ---------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------

export type RtwTone = 'green' | 'amber' | 'coral' | 'neutral' | 'cyan';

export interface RtwCheckView {
  /** Null when there is no check to show (switched off, or never run). */
  status: { tone: RtwTone; label: string } | null;
  lines: { k: string; v: string }[];
  /** Why the office is looking at it: the needs-review reason. */
  reason: string | null;
  hasReport: boolean;
  /** "Run check again": on, the document still pending, nothing in flight. */
  canRunAgain: boolean;
  /**
   * ADR-0018's hand-typed date: while the automation is on, only for a
   * check in needs_review — the same rule as rtw_check_manual_allowed().
   */
  manualAllowed: boolean;
  /**
   * A needs-review check whose document has been decided (rejected by the
   * check itself, or by a person since): "Mark reviewed".
   */
  canMarkReviewed: boolean;
  inFlight: boolean;
  /** The check's recommendation (ADR-0041), or null. */
  recommendation: RtwRecommendation | null;
  /**
   * The N8 text to pre-fill the Reject box with — only when the check
   * recommends rejecting. Office-only: never render it anywhere the worker
   * can see it.
   */
  suggestedReason: string | null;
  /**
   * The right-to-work date gov.uk confirmed, which the admin CONFIRMS on
   * Verify rather than types (ADR-0041). Non-null only when the check
   * recommends verifying and the document is still pending; Verify sends
   * exactly this (rtwLockedValue).
   */
  lockedUntil: RtwLockedUntil | null;
}

/** gov.uk's date, read-only on Verify: a date, or "no time limit" (settled status). */
export interface RtwLockedUntil {
  date: string | null;
  noTimeLimit: boolean;
}

/**
 * The gov.uk date the admin confirms on Verify, or null when the date is
 * theirs to type (ADR-0041). Only a check that recommends verifying, on a
 * document still pending, with a result that carries a date or "no time
 * limit" — anything less falls back to the hand-typed date.
 */
export function rtwLockedUntil(row: RtwCheckRow | null, docStatus: string): RtwLockedUntil | null {
  if (!row || docStatus !== 'pending') return null;
  if (row.status !== 'needs_review' || row.recommendation !== 'verify') return null;
  if (row.outcome !== null && row.outcome !== 'right_to_work') return null;
  if (row.no_time_limit) return { date: null, noTimeLimit: true };
  if (!row.right_to_work_until) return null;
  return { date: row.right_to_work_until.slice(0, 10), noTimeLimit: false };
}

/**
 * What Verify sends for a locked date: the date, or the 'infinity' value the
 * database reads as "confirmed: no time limit" (compliance/rtw.ts).
 */
export function rtwLockedValue(locked: RtwLockedUntil): string {
  return rtwDateValue(locked.date ?? '', locked.noTimeLimit);
}

/** "31.03.2028", or the settled-status wording. */
export function rtwLockedLabel(locked: RtwLockedUntil): string {
  return locked.noTimeLimit ? 'no time limit — settled status' : ukDateOnly(locked.date);
}

/** The pill of a needs-review check that carries a recommendation (ADR-0041). */
const RECOMMENDATION_STATUS: Partial<Record<RtwRecommendation, { tone: RtwTone; label: string }>> =
  {
    verify: { tone: 'green', label: 'Passed — compare the photo' },
    reject: { tone: 'amber', label: 'Recommend reject' },
  };

export const STUCK_REASON =
  'The automatic gov.uk check has not run — the schedule, its secret or RTW_GOVUK_ENABLED may be missing. Verify by hand from the report, and check job_runs.';

const TONE: Record<RtwCheckStatus, RtwTone> = {
  queued: 'cyan',
  running: 'cyan',
  passed: 'green',
  rejected: 'amber',
  needs_review: 'coral',
  failed: 'neutral',
};

export function rtwCheckView(
  row: RtwCheckRow | null,
  context: { docStatus: string; enabled: boolean },
): RtwCheckView {
  const stuck = Boolean(row?.stuck) && rtwCheckInFlight(row?.status);
  const inFlight = rtwCheckInFlight(row?.status);
  const pending = context.docStatus === 'pending';
  const base = {
    hasReport: Boolean(row?.report_path),
    canRunAgain: context.enabled && pending && !inFlight,
    manualAllowed: !context.enabled || row?.status === 'needs_review' || stuck,
    canMarkReviewed:
      row?.status === 'needs_review' &&
      ['rejected', 'verified', 'superseded'].includes(context.docStatus) &&
      !row.reviewed_at,
    inFlight,
    recommendation: row?.recommendation ?? null,
    suggestedReason:
      row?.recommendation === 'reject' && row.status === 'needs_review'
        ? row.suggested_reason
        : null,
    lockedUntil: rtwLockedUntil(row, context.docStatus),
  };
  if (!row) {
    return { ...base, status: null, lines: [], reason: null };
  }

  const lines: { k: string; v: string }[] = [];
  lines.push({
    k: 'Checked',
    v:
      inFlight && row.status === 'queued' && row.attempts > 0 && row.next_attempt_at
        ? `attempt ${row.attempts} of ${row.max_attempts} failed · next try ${ukStampFull(row.next_attempt_at)}`
        : inFlight
          ? `checking with gov.uk… (queued ${ukStampFull(row.created_at)})`
          : `${ukStampFull(row.finished_at ?? row.created_at)}${
              row.source ? ` · ${RTW_CHECK_SOURCE_LABEL[row.source]}` : ''
            }`,
  });
  if (row.outcome === 'right_to_work') {
    lines.push({
      k: 'Right to work until',
      v: row.no_time_limit
        ? 'no time limit (settled status)'
        : `${ukDateOnly(row.right_to_work_until)} — the expiry used for reminders`,
    });
  } else if (row.outcome === 'no_right_to_work') {
    lines.push({ k: 'gov.uk result', v: 'no right to work in the UK' });
  } else if (row.outcome === 'not_found') {
    lines.push({ k: 'gov.uk result', v: 'no record for this share code and date of birth' });
  }
  if (row.conditions && row.conditions.length > 0) {
    lines.push({ k: 'Conditions', v: row.conditions.join(' · ') });
  }
  if (row.record_name) lines.push({ k: 'Name on the record', v: row.record_name });
  if (row.reference_number) lines.push({ k: 'gov.uk reference', v: row.reference_number });
  if (row.status === 'rejected' && row.worker_reason) {
    lines.push({ k: 'Worker asked to re-enter', v: `“${row.worker_reason}” (N8)` });
  }

  return {
    ...base,
    status: stuck
      ? { tone: 'coral', label: 'Not running' }
      : row.status === 'needs_review' && row.recommendation
        ? (RECOMMENDATION_STATUS[row.recommendation] ?? {
            tone: TONE[row.status],
            label: RTW_CHECK_STATUS_LABEL[row.status],
          })
        : { tone: TONE[row.status], label: RTW_CHECK_STATUS_LABEL[row.status] },
    lines,
    reason:
      row.status === 'needs_review'
        ? row.review_reason
        : stuck
          ? (row.review_reason ?? STUCK_REASON)
          : null,
  };
}

/** The latest check for each document, keyed by document id. */
export function checksByDocument(rows: readonly RtwCheckRow[]): Map<string, RtwCheckRow> {
  const map = new Map<string, RtwCheckRow>();
  for (const row of rows) map.set(row.document_id, row);
  return map;
}
