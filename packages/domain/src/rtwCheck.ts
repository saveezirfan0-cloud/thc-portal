/**
 * The automated gov.uk right-to-work check — Scope §2.3, §2.5, §2.6, §4.4;
 * ADR-0025.
 *
 * "Share code + DOB → gov.uk/view-right-to-work → right-to-work-until date →
 * PDF report stored on the profile; that date becomes the expiry used for
 * reminders. On failure or low confidence → flagged for manual review."
 *
 * Pure: no I/O, no environment. Two adapters (a right-to-work provider's HTTP
 * API first, our own gov.uk browser automation as the fallback) each turn
 * what they got back into ONE normalised `RtwCheckResult`; this module
 * decides what that result does to the worker's share-code document:
 *
 *   verify         the result is a clean pass → the document is verified
 *                  through the office's own Verify (system actor), with the
 *                  right-to-work-until from gov.uk
 *   reject         the worker must re-enter (N8 with the reason below)
 *   retry          the check could not be completed; back off and try again
 *   needs_review   the Compliance "Needs review" queue, with a reason for
 *                  the office — never a silent pass
 *
 * THC's decision (ADR-0025): no human step on success, no photo match. A
 * name mismatch, a record whose conditions contradict the branch the worker
 * chose, or anything the system cannot apply automatically is NEVER
 * auto-verified.
 *
 * The database is authoritative on the attempt limit and the backoff
 * (`rtw_check_record()`, 20260928100000); `RTW_CHECK_BACKOFF_MINUTES` is
 * held equal to the SQL literal by `rtwCheck.sql.test.ts`.
 */
import type { RtwBranch } from './onboarding';

// ---------------------------------------------------------------------
// The normalised result
// ---------------------------------------------------------------------

export const RTW_CHECK_OUTCOMES = [
  'right_to_work',
  'no_right_to_work',
  'not_found',
  'error',
] as const;
export type RtwCheckOutcome = (typeof RTW_CHECK_OUTCOMES)[number];

export const RTW_CHECK_SOURCES = ['provider', 'govuk'] as const;
export type RtwCheckSource = (typeof RTW_CHECK_SOURCES)[number];

/**
 * What either adapter hands back. It NEVER carries the share code or the
 * date of birth: both were inputs, and neither is stored with the result
 * (`rtw_checks.result`) or logged.
 */
export interface RtwCheckResult {
  outcome: RtwCheckOutcome;
  /** The name gov.uk holds for the share code, as printed. Null when there is no record. */
  fullName: string | null;
  /** ISO date (YYYY-MM-DD). Null on a pass means NO TIME LIMIT (settled status / ILR). */
  rightToWorkUntil: string | null;
  /** The work conditions as gov.uk words them, one line each. */
  conditions: string[];
  /** e.g. 20 when the record says "20 hours per week in term time"; null when there is no such limit. */
  termTimeLimitHours: number | null;
  /** gov.uk's reference for this check, when it gives one. */
  referenceNumber: string | null;
  /** ISO timestamp of the check. */
  checkedAt: string;
  source: RtwCheckSource;
  /**
   * Outcome `error` only: a short machine-readable reason — `timeout`,
   * `http_503`, `not_configured`, `page_changed` … — never text that could
   * carry personal data.
   */
  error?: string | null;
}

export function isRtwCheckOutcome(value: unknown): value is RtwCheckOutcome {
  return typeof value === 'string' && (RTW_CHECK_OUTCOMES as readonly string[]).includes(value);
}

export function isRtwCheckSource(value: unknown): value is RtwCheckSource {
  return typeof value === 'string' && (RTW_CHECK_SOURCES as readonly string[]).includes(value);
}

/** An `error` result — what an adapter returns instead of throwing. */
export function rtwCheckError(
  source: RtwCheckSource,
  error: string,
  checkedAt: string = new Date().toISOString(),
): RtwCheckResult {
  return {
    outcome: 'error',
    fullName: null,
    rightToWorkUntil: null,
    conditions: [],
    termTimeLimitHours: null,
    referenceNumber: null,
    checkedAt,
    source,
    error: safeErrorCode(error),
  };
}

/**
 * An error code is `[a-z0-9_:.-]`, at most 60 characters. Anything else is
 * collapsed, so a thrown message that happens to quote a name or a share
 * code cannot ride into the database or a log line.
 */
export function safeErrorCode(raw: string): string {
  const code = raw
    .toLowerCase()
    .replace(/[^a-z0-9_:.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 60);
  return code || 'unknown_error';
}

// ---------------------------------------------------------------------
// Name matching
// ---------------------------------------------------------------------

/**
 * Letters that NFD does not decompose into a base letter + a combining mark.
 * Without these "Øyvind", "Łukasz" and "Straße" would never match the plain
 * spelling a worker types on a UK keyboard.
 */
const FOLD: Record<string, string> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ı: 'i',
};

/** Lower case, accents removed, the few undecomposable letters folded. */
export function foldName(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[ßæœøłđðþı]/g, (c) => FOLD[c] ?? c);
}

/** Words of a name: hyphens, apostrophes, commas and full stops separate words. */
export function nameTokens(raw: string): string[] {
  return foldName(raw)
    .split(/[\s\-‐‑–—'’`.,]+/u)
    .map((t) => t.replace(/[^a-z0-9]/g, ''))
    .filter((t) => t.length > 0);
}

/**
 * Whether a name PART on the profile (the first name, or the last name) is
 * present in the gov.uk name. Every word of the part must appear — in any
 * order, any case, with or without accents — or the part written as one word
 * must equal a word, or two adjacent words, of the record ("Mary-Jane" ≡
 * "Mary Jane" ≡ "Maryjane").
 */
function partMatches(part: string, record: readonly string[]): boolean {
  const words = nameTokens(part);
  if (words.length === 0) return false;
  const have = new Set(record);
  if (words.every((w) => have.has(w))) return true;
  const joined = words.join('');
  if (have.has(joined)) return true;
  for (let i = 0; i + 1 < record.length; i += 1) {
    if (record[i]! + record[i + 1]! === joined) return true;
  }
  return false;
}

/**
 * The name on the gov.uk record belongs to this worker: BOTH the first name
 * and the last name on the profile appear in it. Case, diacritics, hyphens
 * and word order do not matter; extra middle names on the record are fine.
 * A missing name on either side is never a match.
 */
export function namesMatch(
  recordFullName: string | null | undefined,
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): boolean {
  if (!recordFullName || !firstName || !lastName) return false;
  const record = nameTokens(recordFullName);
  if (record.length === 0) return false;
  return partMatches(firstName, record) && partMatches(lastName, record);
}

// ---------------------------------------------------------------------
// Work conditions — ASSUMED gov.uk wording (ADR-0025, "Assumed — confirm
// against the live service"). The live result page and THC's provider were
// not reachable when this was written. Every pattern below is a guess at how
// gov.uk words a condition; a condition none of them recognises goes to the
// office, never through.
// ---------------------------------------------------------------------

/** "20 hours a week in term time", "up to 20 hours per week during term-time" … */
export const TERM_TIME_LIMIT_PATTERN =
  /(\d{1,2})\s*hours?\s*(?:a|per|each)\s*week[^.]*?\bterm[\s-]?time|\bterm[\s-]?time[^.]*?(\d{1,2})\s*hours?\s*(?:a|per|each)\s*week/i;

/** Conditions that restrict nothing the system does not already apply. */
export const BENIGN_CONDITION_PATTERNS: readonly RegExp[] = [
  /^no (?:work )?(?:restrictions?|conditions?)\.?$/i,
  /\bno restrictions? on (?:the )?(?:type of )?work\b/i,
  /\bcan work in (?:the )?UK (?:with )?no (?:time )?limit\b/i,
  /\bcan work in any job\b/i,
  /\bfull[\s-]?time during (?:official )?(?:university |college )?(?:vacations?|holidays?)\b/i,
  /\bcannot work as a professional sports ?person\b/i,
  /\bcannot be self[\s-]?employed\b/i,
  /\bcannot fill a permanent full[\s-]?time vacancy\b/i,
  /\bcannot work as (?:a|an) (?:entertainer|doctor or dentist in training)\b/i,
];

/** The hours limit a record puts on term time, or null. */
export function termTimeLimitFrom(conditions: readonly string[]): number | null {
  for (const line of conditions) {
    const match = TERM_TIME_LIMIT_PATTERN.exec(line);
    if (match) return Number(match[1] ?? match[2]);
  }
  return null;
}

/** Conditions that are neither the term-time limit nor one of the benign lines above. */
export function unrecognisedConditions(conditions: readonly string[]): string[] {
  return conditions
    .map((c) => c.trim())
    .filter((c) => c.length > 0)
    .filter((c) => !TERM_TIME_LIMIT_PATTERN.test(c))
    .filter((c) => !BENIGN_CONDITION_PATTERNS.some((p) => p.test(c)));
}

// ---------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------

/** What the check knows about the worker, read from the profile at claim time. */
export interface RtwCheckSubject {
  firstName: string;
  lastName: string;
  rtwBranch: RtwBranch | null;
  /** RULE-20: a Student visa below degree level is limited to 10 h in term, not 20. */
  belowDegreeLevel: boolean;
}

export interface RtwCheckContext {
  /** This attempt, 1-based (`rtw_checks.attempts` after the claim). */
  attempt: number;
  maxAttempts: number;
  /** The UK calendar day, YYYY-MM-DD. */
  today: string;
}

export type RtwCheckDecision =
  | { action: 'verify'; rightToWorkUntil: string | null; noTimeLimit: boolean }
  | { action: 'reject'; workerReason: string; officeReason: string | null }
  | { action: 'retry'; error: string }
  | { action: 'needs_review'; officeReason: string };

/** N8, word for word, when gov.uk has no record for the code with this date of birth. */
export const RTW_NOT_FOUND_REASON =
  'gov.uk did not recognise this share code with your date of birth — check both and try again';

/** N8 when gov.uk's record says the person may not work in the UK. */
export const RTW_NO_RIGHT_REASON =
  'gov.uk says this share code does not give the right to work in the UK — check the code, or speak to the office';

const BRANCH_WORDS: Record<RtwBranch, string> = {
  uk_irish: 'UK / Irish citizen',
  eu_settled: 'EU settled / pre-settled',
  work_visa: 'Work visa',
  international_student: 'International student',
  dependant_other: 'Dependant / other',
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Minutes to wait after failed attempt N (1-based) before attempt N + 1.
 * Five attempts span about a day: 30 min, 2 h, 6 h, 16 h. The same literal
 * is `rtw_check_backoff()` in SQL.
 */
export const RTW_CHECK_BACKOFF_MINUTES: readonly number[] = [30, 120, 360, 960];

export const RTW_CHECK_DEFAULT_MAX_ATTEMPTS = 5;

export function rtwCheckRetryDelayMinutes(attempt: number): number {
  const index = Math.min(Math.max(attempt, 1), RTW_CHECK_BACKOFF_MINUTES.length) - 1;
  return RTW_CHECK_BACKOFF_MINUTES[index]!;
}

/**
 * What a result does to the worker's share-code document. In this order:
 *
 *   1. `error`             → retry, until the attempts run out → needs_review
 *   2. `not_found`         → reject; the worker re-enters (N8)
 *   3. `no_right_to_work`  → reject (N8) AND needs_review: the office must know
 *   4. `right_to_work`     → verify, unless anything below sends it to the office:
 *        · the name on the record is not the worker's (both names must match)
 *        · the date is missing, malformed or not in the future
 *        · the worker chose the UK / Irish branch (no share code there)
 *        · no time limit, on a branch whose right to work always ends
 *          (everything but EU settled — ADR-0018)
 *        · a term-time hours limit off the International student branch, or
 *          none on it, or a limit that is not the one RULE-20 would apply
 *        · any condition the system does not recognise
 */
export function decideRtwCheck(
  result: RtwCheckResult,
  subject: RtwCheckSubject,
  context: RtwCheckContext,
): RtwCheckDecision {
  if (result.outcome === 'error') {
    const error = safeErrorCode(result.error ?? 'unknown_error');
    if (context.attempt < context.maxAttempts) return { action: 'retry', error };
    return {
      action: 'needs_review',
      officeReason: `The automatic check could not be completed after ${context.attempt} attempts (${error}). Run it again, or check the share code on gov.uk by hand.`,
    };
  }

  if (result.outcome === 'not_found') {
    return { action: 'reject', workerReason: RTW_NOT_FOUND_REASON, officeReason: null };
  }

  if (result.outcome === 'no_right_to_work') {
    return {
      action: 'reject',
      workerReason: RTW_NO_RIGHT_REASON,
      officeReason:
        'gov.uk returned NO right to work for this share code. The worker has been asked to re-enter it; do not roster them on this evidence — read the report and contact them.',
    };
  }

  const review = (officeReason: string): RtwCheckDecision => ({
    action: 'needs_review',
    officeReason,
  });

  if (!namesMatch(result.fullName, subject.firstName, subject.lastName)) {
    return review(
      'The name on the gov.uk record does not match the name on the profile. Compare them in the report before verifying.',
    );
  }

  const branch = subject.rtwBranch;
  if (!branch || branch === 'uk_irish') {
    return review(
      'A share code was checked for a worker who is not on a share-code branch. Check the right-to-work branch on the profile.',
    );
  }

  const until = result.rightToWorkUntil;
  if (until !== null) {
    if (!ISO_DATE.test(until) || Number.isNaN(Date.parse(`${until}T00:00:00Z`))) {
      return review('gov.uk returned a right-to-work date the system could not read.');
    }
    if (until <= context.today) {
      return review(
        'gov.uk shows a right-to-work date that is today or already past. Check the report.',
      );
    }
  } else if (branch !== 'eu_settled') {
    return review(
      `gov.uk shows no time limit, but the ${BRANCH_WORDS[branch]} branch always has an end date (ADR-0018). Confirm the status and the date by hand.`,
    );
  }

  const termLimit = result.termTimeLimitHours ?? termTimeLimitFrom(result.conditions);
  if (termLimit !== null && branch !== 'international_student') {
    return review(
      `gov.uk limits this person to ${termLimit} hours a week in term time, but they chose the ${BRANCH_WORDS[branch]} branch. Their weekly cap would be wrong — check the branch.`,
    );
  }
  if (branch === 'international_student') {
    if (termLimit === null) {
      return review(
        'The worker chose International student, but gov.uk shows no term-time hours limit. Check which visa they hold.',
      );
    }
    const expected = subject.belowDegreeLevel ? 10 : 20;
    if (termLimit !== expected) {
      return review(
        `gov.uk limits term time to ${termLimit} hours a week; the profile's course level gives ${expected} (RULE-20). Check the course level before verifying.`,
      );
    }
  }

  const unknown = unrecognisedConditions(result.conditions);
  if (unknown.length > 0) {
    return review(
      `gov.uk lists ${unknown.length === 1 ? 'a work condition' : `${unknown.length} work conditions`} the system cannot apply automatically. Read ${unknown.length === 1 ? 'it' : 'them'} in the report before verifying.`,
    );
  }

  return { action: 'verify', rightToWorkUntil: until, noTimeLimit: until === null };
}

// ---------------------------------------------------------------------
// What the worker and the office are shown
// ---------------------------------------------------------------------

export const RTW_CHECK_STATUSES = [
  'queued',
  'running',
  'passed',
  'rejected',
  'needs_review',
  'failed',
] as const;
export type RtwCheckStatus = (typeof RTW_CHECK_STATUSES)[number];

export function isRtwCheckStatus(value: unknown): value is RtwCheckStatus {
  return typeof value === 'string' && (RTW_CHECK_STATUSES as readonly string[]).includes(value);
}

/** Still working: the worker sees "Checking with gov.uk…", the office sees no Verify. */
export function rtwCheckInFlight(status: RtwCheckStatus | null | undefined): boolean {
  return status === 'queued' || status === 'running';
}

/**
 * The worker's line for the latest check on their current share code. The
 * happy path never mentions manual review: a pass is simply "Verified", and
 * while the check runs it says so.
 */
export type RtwCheckWorkerState = 'checking' | 'passed' | 're_enter' | 'with_office' | null;

export function rtwCheckWorkerState(
  status: RtwCheckStatus | null | undefined,
): RtwCheckWorkerState {
  switch (status) {
    case 'queued':
    case 'running':
      return 'checking';
    case 'passed':
      return 'passed';
    case 'rejected':
      return 're_enter';
    case 'needs_review':
      return 'with_office';
    default:
      return null;
  }
}

export const RTW_CHECK_STATUS_LABEL: Readonly<Record<RtwCheckStatus, string>> = {
  queued: 'Queued',
  running: 'Checking',
  passed: 'Passed',
  rejected: 'Re-enter requested',
  needs_review: 'Needs review',
  failed: 'Stopped',
};

export const RTW_CHECK_SOURCE_LABEL: Readonly<Record<RtwCheckSource, string>> = {
  provider: 'right-to-work provider',
  govuk: 'gov.uk (browser check)',
};
