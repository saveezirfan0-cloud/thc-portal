/**
 * The automated gov.uk share-code check, as the office sees it (§2.6,
 * ADR-0025 option C). Pure: every rule the three screens share — the
 * candidate profile's share code card, the staff profile's Documents tab and
 * the Compliance "Needs review" queue — is decided here and tested without a
 * database or a browser.
 *
 * The check never verifies or rejects. It hands the office a result to
 * confirm; the admin still decides through the one Verify / Reject path
 * (ADR-0018), which is where N8 comes from.
 */
import { rtwOutcomeLabel, rtwRecommendedAction, rtwRejectReason } from '@thc/domain';
import type { RtwCheckOutcome, RtwCheckStatus } from '@thc/domain';
import { formatUkDate, SETTLED_NO_TIME_LIMIT } from '../staff/staff';
import { formatUkStamp } from '../staff/[id]/profile';
import { rtwDateProblem, rtwDateRule } from './rtw';

/** One `rtw_checks` row as the office reads it (admin_read, 20260928090000). */
export interface RtwCheckRow {
  document_id: string;
  staff_id: string;
  status: RtwCheckStatus;
  outcome: RtwCheckOutcome | null;
  source: string;
  finished_at: string | null;
  holder_name: string | null;
  right_to_work_until: string | null;
  no_time_limit: boolean;
  conditions: string | null;
  report_path: string | null;
  photo_path: string | null;
  /** The runner writes `reasons: string[]` and `permissionType: string | null`. */
  result: unknown;
}

/** The columns the office reads. Never the share code or date of birth — the table holds neither. */
export const RTW_CHECK_COLUMNS =
  'document_id, staff_id, status, outcome, source, finished_at, holder_name, ' +
  'right_to_work_until, no_time_limit, conditions, report_path, photo_path, result';

export type RtwCheckState = 'checking' | 'done' | 'failed';
export type RtwCheckTone = 'cyan' | 'green' | 'amber' | 'coral';

/**
 * What a screen shows for one check. Serialisable, and carries no storage
 * path: the photo and the report are signed on demand by a server action
 * that reads the path itself (rtwCheckActions.ts), so nothing the browser
 * holds can be turned into a signed URL.
 */
export interface RtwCheckView {
  state: RtwCheckState;
  outcome: RtwCheckOutcome | null;
  /** "Checking with gov.uk…", the outcome's label, or "check by hand". */
  headline: string;
  tone: RtwCheckTone;
  recommended: 'verify' | 'review' | 'reject' | null;
  /** The runner's plain sentences, in the order it found them. */
  reasons: string[];
  source: string;
  /** Audit stamp, UK time only (§1.8). Null until the check has finished. */
  checkedAt: string | null;
  /** YYYY-MM-DD off gov.uk, or null (none yet, or no time limit). */
  rightToWorkUntil: string | null;
  noTimeLimit: boolean;
  /** "31.03.2028", "No time limit", or null before a result. */
  untilLabel: string | null;
  conditions: string | null;
  permissionType: string | null;
  holderName: string | null;
  hasPhoto: boolean;
  hasReport: boolean;
}

export const RTW_CHECK_SOURCE = 'gov.uk · automatic check';
export const RTW_CHECKING = 'Checking with gov.uk…';
export const RTW_CHECK_FAILED = 'Couldn’t check automatically — check by hand';
export const RTW_NO_TIME_LIMIT = 'No time limit';
export const RTW_COMPARE_PHOTOS = 'Compare the photos before you verify';

const TONE: Record<RtwCheckOutcome, RtwCheckTone> = {
  pass: 'green',
  name_mismatch: 'amber',
  conditions_mismatch: 'amber',
  not_found: 'coral',
  no_right_to_work: 'coral',
};

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function resultField(result: unknown, key: string): unknown {
  if (result === null || typeof result !== 'object' || Array.isArray(result)) return undefined;
  return (result as Record<string, unknown>)[key];
}

/** `result.reasons`, keeping only non-empty strings — the runner's words, never re-worded. */
export function checkReasons(result: unknown): string[] {
  const reasons = resultField(result, 'reasons');
  if (!Array.isArray(reasons)) return [];
  return reasons.map(text).filter((r): r is string => r !== null);
}

/** `result.permissionType`, e.g. "Student visa". */
export function checkPermissionType(result: unknown): string | null {
  return text(resultField(result, 'permissionType'));
}

/**
 * Row → display model. Null for no row and for a cancelled check: the
 * screen then shows exactly what it showed before the automated check
 * existed (the manual flow, ADR-0002 / ADR-0018).
 */
export function rtwCheckView(row: RtwCheckRow | null | undefined): RtwCheckView | null {
  if (!row) return null;
  const base = {
    source: RTW_CHECK_SOURCE,
    reasons: [] as string[],
    checkedAt: null,
    rightToWorkUntil: null,
    noTimeLimit: false,
    untilLabel: null,
    conditions: null,
    permissionType: null,
    holderName: null,
    hasPhoto: false,
    hasReport: false,
    outcome: null,
    recommended: null,
  };
  switch (row.status) {
    case 'queued':
    case 'running':
      return { ...base, state: 'checking', headline: RTW_CHECKING, tone: 'cyan' };
    case 'failed':
      return {
        ...base,
        state: 'failed',
        headline: RTW_CHECK_FAILED,
        tone: 'amber',
        checkedAt: row.finished_at ? formatUkStamp(row.finished_at) : null,
      };
    case 'done': {
      // The table guarantees an outcome when done; a row that somehow has
      // none is treated as a failure to check, never as a pass.
      if (!row.outcome || !(row.outcome in TONE)) {
        return { ...base, state: 'failed', headline: RTW_CHECK_FAILED, tone: 'amber' };
      }
      const noTimeLimit = row.no_time_limit === true;
      const until = text(row.right_to_work_until);
      return {
        state: 'done',
        outcome: row.outcome,
        headline: rtwOutcomeLabel(row.outcome),
        tone: TONE[row.outcome],
        recommended: rtwRecommendedAction(row.outcome),
        reasons: checkReasons(row.result),
        source: RTW_CHECK_SOURCE,
        checkedAt: row.finished_at ? formatUkStamp(row.finished_at) : null,
        rightToWorkUntil: until,
        noTimeLimit,
        untilLabel: until ? formatUkDate(until) : noTimeLimit ? RTW_NO_TIME_LIMIT : '—',
        conditions: text(row.conditions),
        permissionType: checkPermissionType(row.result),
        holderName: text(row.holder_name),
        hasPhoto: text(row.photo_path) !== null,
        hasReport: text(row.report_path) !== null,
      };
    }
    default:
      return null;
  }
}

/** Keyed by the compliance_docs id, the way every screen looks a check up. */
export function rtwChecksByDocument(
  rows: readonly RtwCheckRow[] | null | undefined,
): Record<string, RtwCheckView> {
  const out: Record<string, RtwCheckView> = {};
  for (const row of rows ?? []) {
    const view = rtwCheckView(row);
    if (view) out[row.document_id] = view;
  }
  return out;
}

// ---------------------------------------------------------------------
// Verify: gov.uk's date read-only, or the reviewer types it
// ---------------------------------------------------------------------

/**
 * How the right-to-work-until is confirmed on Verify (ADR-0018).
 *
 *   - `govuk`: a passing check. The date (or, on the EU settled branch,
 *     "settled — no time limit") comes from gov.uk and is shown read-only;
 *     Verify passes it straight through.
 *   - `manual`: anything else — no check, a failed check, or an outcome
 *     other than pass. The reviewer enters the date, pre-filled with what
 *     is already on the document.
 *
 * A pass whose value the database would refuse (no time limit off the
 * settled branch — the branch changed after the check ran) falls back to
 * manual rather than offering a Verify that cannot succeed.
 */
export interface RtwVerifyPlan {
  mode: 'govuk' | 'manual';
  date: string;
  noTimeLimit: boolean;
}

export function rtwVerifyPlan(
  check: RtwCheckView | null | undefined,
  branch: string | null,
  documentDate: string | null,
): RtwVerifyPlan {
  const manual: RtwVerifyPlan = { mode: 'manual', date: documentDate ?? '', noTimeLimit: false };
  if (!check || check.state !== 'done' || check.outcome !== 'pass') return manual;
  const rule = rtwDateRule('share_code_report', branch);
  const noTimeLimit =
    check.noTimeLimit && !check.rightToWorkUntil && Boolean(rule?.allowNoTimeLimit);
  const date = noTimeLimit ? '' : (check.rightToWorkUntil ?? '');
  if (rtwDateProblem(rule, date, noTimeLimit) !== null) return manual;
  return { mode: 'govuk', date, noTimeLimit };
}

/** The read-only value shown for a `govuk` plan. */
export function rtwPlanLabel(plan: RtwVerifyPlan): string {
  if (plan.noTimeLimit) return SETTLED_NO_TIME_LIMIT;
  return plan.date ? formatUkDate(plan.date) : '—';
}

// ---------------------------------------------------------------------
// Reject: the worker-facing reason, pre-filled and editable
// ---------------------------------------------------------------------

/**
 * The Reject box's starting text. Only not_found and no_right_to_work have
 * one (it goes to the worker word for word in N8); everything else starts
 * empty, as it always has.
 */
export function rtwRejectPrefill(check: RtwCheckView | null | undefined): string {
  if (!check || check.state !== 'done' || !check.outcome) return '';
  return rtwRejectReason(check.outcome) ?? '';
}

// ---------------------------------------------------------------------
// Run check again
// ---------------------------------------------------------------------

/** "Run check again" is offered on a pending share code report only — the database agrees. */
export function canRerunRtwCheck(doc: {
  doc_type: string;
  review_status: string;
  share_code: string | null;
}): boolean {
  return (
    doc.doc_type === 'share_code_report' &&
    doc.review_status === 'pending' &&
    text(doc.share_code) !== null
  );
}

export type RerunResult = { ok: true; message: string } | { ok: false; message: string };

/** What `rerun_rtw_check` answered, in words for the reviewer. */
export function rerunMessage(data: unknown): RerunResult {
  const answer = (data ?? {}) as { ok?: boolean; reason?: string; alreadyQueued?: boolean };
  if (answer.ok === false && answer.reason === 'not_enabled') {
    return {
      ok: false,
      message:
        'The automatic gov.uk check is switched off, so nothing was queued. Check the share code by hand on gov.uk/view-right-to-work.',
    };
  }
  if (answer.ok === false) {
    return { ok: false, message: 'The check could not be queued. Try again in a minute.' };
  }
  if (answer.alreadyQueued) {
    return {
      ok: true,
      message: 'A check is already queued for this share code — the result appears here shortly.',
    };
  }
  return {
    ok: true,
    message: 'Check queued with gov.uk. The result appears here shortly.',
  };
}

const RERUN_ERRORS: [RegExp, string][] = [
  [/^not_authorised/, 'Only the office can run the gov.uk check.'],
  [
    /^not_pending/,
    'This share code has already been verified or rejected — the check runs on a pending report only.',
  ],
  [/^not_a_share_code/, 'Only a share code report can be checked with gov.uk.'],
  [/^document_not_found/, 'This document no longer exists — refresh the page.'],
];

/** A refusal raised by `rerun_rtw_check`, in words for the reviewer. */
export function rerunErrorMessage(raw: string): string {
  for (const [pattern, message] of RERUN_ERRORS) if (pattern.test(raw)) return message;
  return raw;
}
