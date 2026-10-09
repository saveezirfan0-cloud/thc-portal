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

/**
 * "20 hours a week in term time", "up to 20 hours per week during term-time"
 * … anywhere in a line. Used to READ the limit (the decision then checks it
 * against RULE-20); it never on its own makes a line acceptable — see
 * `TERM_TIME_LINE_PATTERNS`.
 */
export const TERM_TIME_LIMIT_PATTERN =
  /(\d{1,2})\s*hours?\s*(?:a|per|each)\s*week[^.]*?\bterm[\s-]?time|\bterm[\s-]?time[^.]*?(\d{1,2})\s*hours?\s*(?:a|per|each)\s*week/i;

/**
 * A WHOLE condition line that is only the student term-time limit, and so
 * needs no human: the limit is read from it and held to RULE-20. Anchored,
 * so "… up to 20 hours a week in term time, except …" is not one.
 */
export const TERM_TIME_LINE_PATTERNS: readonly RegExp[] = [
  /^(?:they|this person|the applicant)?\s*(?:can|may)\s+work\s+(?:in\s+the\s+UK\s+)?(?:for\s+)?(?:up\s+to|a\s+maximum\s+of|no\s+more\s+than|a\s+total\s+of)?\s*\d{1,2}\s+hours?\s+(?:a|per|each)\s+week\s+(?:during|in)\s+(?:the\s+)?term[\s-]?time\.?$/i,
  /^(?:they|this person|the applicant)?\s*(?:cannot|can't|must\s+not)\s+work\s+(?:in\s+the\s+UK\s+)?(?:for\s+)?more\s+than\s+\d{1,2}\s+hours?\s+(?:a|per|each)\s+week\s+(?:during|in)\s+(?:the\s+)?term[\s-]?time\.?$/i,
  /^(?:maximum\s+of\s+|up\s+to\s+)?\d{1,2}\s+hours?\s+(?:a|per|each)\s+week\s+(?:during|in)\s+(?:the\s+)?term[\s-]?time\.?$/i,
];

/**
 * WHOLE condition lines that restrict nothing the system does not already
 * apply. Anchored at both ends: "Can work in any job" is benign, "Can work in
 * any job for up to 20 hours a week" is not (QA 25.09).
 */
const SUBJECT = String.raw`(?:they|this person|the applicant)?\s*`;
export const BENIGN_CONDITION_PATTERNS: readonly RegExp[] = [
  /^no\s+(?:work\s+)?(?:restrictions?|conditions?)\.?$/i,
  /^no\s+restrictions?\s+on\s+(?:the\s+)?(?:type\s+of\s+)?work\.?$/i,
  new RegExp(
    String.raw`^${SUBJECT}can\s+work\s+in\s+(?:the\s+)?UK\s+(?:with\s+)?no\s+(?:time\s+)?limit\.?$`,
    'i',
  ),
  new RegExp(String.raw`^${SUBJECT}can\s+work\s+in\s+any\s+job\.?$`, 'i'),
  new RegExp(
    String.raw`^${SUBJECT}can\s+work\s+full[\s-]?time\s+during\s+(?:official\s+)?(?:university\s+|college\s+)?(?:vacations?|holidays?)\.?$`,
    'i',
  ),
  // Live wording (28.09.2026): "They cannot work as a professional sportsperson or coach."
  new RegExp(
    String.raw`^${SUBJECT}cannot\s+work\s+as\s+a\s+professional\s+sports\s?person(?:\s+or\s+(?:sports\s+)?coach)?\.?$`,
    'i',
  ),
  // Live wording (06.10.2026): "There is no limit on how long they can stay in the UK."
  /^there\s+is\s+no\s+limit\s+on\s+how\s+long\s+(?:they|this\s+person|the\s+applicant)\s+can\s+(?:stay|remain|live)\s+in\s+the\s+UK\.?$/i,
  new RegExp(String.raw`^${SUBJECT}cannot\s+be\s+self[\s-]?employed\.?$`, 'i'),
  new RegExp(
    String.raw`^${SUBJECT}cannot\s+fill\s+a\s+permanent\s+full[\s-]?time\s+vacancy\.?$`,
    'i',
  ),
  new RegExp(
    String.raw`^${SUBJECT}cannot\s+work\s+as\s+(?:a|an)\s+(?:entertainer|doctor\s+or\s+dentist\s+in\s+training)\.?$`,
    'i',
  ),
];

/**
 * gov.uk's lead-in to a visa's conditions, seen on the live service
 * (28.09.2026): "On their current visa, they can work in any job except those
 * listed in the conditions below." It restricts nothing by itself — the lines
 * it points at are each checked on their own — so it is recognised whole,
 * and only in exactly this form ("except as a doctor" still goes to the
 * office).
 */
export const CONDITIONS_LEAD_IN =
  /^on\s+their\s+current\s+(?:visa|permission|immigration\s+permission),?\s+(?:they|this\s+person)\s+can\s+work\s+in\s+any\s+job\s+except\s+(?:those|the\s+ones?|jobs?)\s+listed\s+in\s+the\s+conditions\s+below\.?$/i;

/**
 * Words that change what a line allows. A line carrying one — or any digit —
 * is only ever accepted as one of the anchored term-time lines above;
 * otherwise it goes to the office.
 */
export const RESTRICTIVE_WORDS =
  /\d|\bhours?\b|\bexcept\b|\bonly\b|\bnot\b|\bunless\b|\bmaximum\b|\blimit/i;

/** The hours limit a record puts on term time, or null. */
export function termTimeLimitFrom(conditions: readonly string[]): number | null {
  for (const line of conditions) {
    const match = TERM_TIME_LIMIT_PATTERN.exec(line);
    if (match) return Number(match[1] ?? match[2]);
  }
  return null;
}

function normaliseLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

/** A line needing no human: a whole benign line, or a whole term-time line. */
export function conditionRecognised(line: string): boolean {
  const l = normaliseLine(line);
  if (CONDITIONS_LEAD_IN.test(l)) return true;
  if (TERM_TIME_LINE_PATTERNS.some((p) => p.test(l))) return true;
  if (!BENIGN_CONDITION_PATTERNS.some((p) => p.test(l))) return false;
  // Belt and braces: a benign pattern never admits a line with a number or
  // a qualifying word in it ("no limit" in the no-time-limit line aside).
  return !RESTRICTIVE_WORDS.test(l.replace(/\bno\s+(?:time\s+)?limit\b/i, ''));
}

/**
 * A condition line is judged one SENTENCE at a time: gov.uk prints "They can
 * work in any job. There is no limit on how long they can stay in the UK." as
 * ONE line (06.10.2026). A line is recognised only when every sentence in it
 * is, so a restrictive sentence beside a benign one still goes to the office.
 */
function sentencesOf(line: string): string[] {
  return line.split(/(?<=[.!?])\s+(?=[A-Z])/).filter((s) => s.length > 0);
}

/** Conditions that are neither a whole term-time line nor a whole benign line (per sentence). */
export function unrecognisedConditions(conditions: readonly string[]): string[] {
  return conditions
    .map(normaliseLine)
    .filter((c) => c.length > 0)
    .filter((c) => !sentencesOf(c).every((s) => conditionRecognised(s)));
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

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Minutes to wait after failed attempt N (1-based) before attempt N + 1.
 * Five attempts span about three hours: 2 min, 10 min, 30 min, 2 h. The
 * retries are for a gov.uk that was briefly unreachable, so the first ones
 * are quick; a failure that waiting cannot fix never gets here
 * (`RTW_CHECK_PERMANENT_ERRORS`). The same literal is `rtw_check_backoff()`
 * in SQL (20261006170000).
 */
export const RTW_CHECK_BACKOFF_MINUTES: readonly number[] = [2, 10, 30, 120];

/**
 * Error codes where gov.uk gave a RESULT page and the system could not read
 * it. The adapter prints that page to PDF for the office (it is the evidence
 * a person needs when every automatic route has run out).
 */
export const RTW_CHECK_RESULT_PAGE_ERRORS: readonly string[] = [
  'govuk_no_expiry',
  'govuk_unreadable_date',
  'govuk_contradictory_result',
];

/**
 * Of those, the ones a retry cannot change: two different end dates, or a
 * page that says both "can" and "cannot work". They go straight to the
 * office. `govuk_no_expiry` is NOT here: the office is the LAST resort, so a
 * page whose date was not found is read again (a page that had not finished
 * loading reads differently a minute later) until the attempts run out.
 * `govuk_unrecognised_result` is not here either: a maintenance page looks
 * the same, clears in minutes, and is not a report to file on a worker.
 */
export const RTW_CHECK_PERMANENT_ERRORS: readonly string[] = [
  'govuk_unreadable_date',
  'govuk_contradictory_result',
];

/**
 * A result page with no end date reads the same on every attempt except when
 * it had not finished loading, which the adapter already covers inside one
 * attempt (whole page, waited for load). So the office gets it after this many
 * attempts, not after all five.
 */
export const RTW_CHECK_NO_DATE_MAX_ATTEMPTS = 3;

export function isPermanentRtwError(code: string | null | undefined): boolean {
  return typeof code === 'string' && RTW_CHECK_PERMANENT_ERRORS.includes(code);
}

export function isResultPageRtwError(code: string | null | undefined): boolean {
  return typeof code === 'string' && RTW_CHECK_RESULT_PAGE_ERRORS.includes(code);
}

/** What an error code means, in words the office can act on. Unknown codes are shown as they are. */
export function rtwCheckErrorLabel(code: string | null | undefined): string {
  if (!code) return 'unknown error';
  if (code === 'govuk_no_expiry')
    return 'gov.uk confirmed the right to work but the end date could not be read from the page';
  if (code === 'govuk_unreadable_date')
    return 'gov.uk printed an end date the system could not read';
  if (code === 'govuk_unrecognised_result')
    return 'the gov.uk result page was not one the system recognises';
  if (code === 'govuk_contradictory_result')
    return 'the gov.uk result page said both that the person can and cannot work';
  if (code === 'govuk_timeout' || code.startsWith('timeout'))
    return 'gov.uk did not answer in time';
  if (code === 'govuk_browser_launch_failed') return 'the checking browser could not start';
  if (code === 'govuk_empty_page') return 'gov.uk returned an empty page';
  if (code.startsWith('govuk_page_changed'))
    return 'gov.uk’s pages no longer match what the system expects';
  if (code === 'not_configured') return 'the check is not configured';
  if (/^http_5\d\d$/.test(code)) return 'gov.uk is unavailable';
  return code;
}

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
    if (isPermanentRtwError(error)) {
      return {
        action: 'needs_review',
        officeReason: `${capitalise(rtwCheckErrorLabel(error))}. Read gov.uk’s report and verify by hand, or run the check again.`,
      };
    }
    const limit =
      error === 'govuk_no_expiry'
        ? Math.min(context.maxAttempts, RTW_CHECK_NO_DATE_MAX_ATTEMPTS)
        : context.maxAttempts;
    if (context.attempt < limit) return { action: 'retry', error };
    return {
      action: 'needs_review',
      officeReason: `The automatic check could not be completed after ${context.attempt} attempts (${rtwCheckErrorLabel(error)}). Run it again, or check the share code on gov.uk by hand.`,
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
      `gov.uk shows no time limit, but the ${BRANCH_WORDS[branch]} branch always has an end date. If gov.uk is right, change the branch to EU settled on the worker’s profile (Overview → Right to Work → Change) and verify; otherwise confirm the status and the date by hand.`,
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
        `gov.uk limits term time to ${termLimit} hours a week; the profile's course level gives ${expected}. Check the course level before verifying.`,
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

/**
 * The status chip. A check back in the queue after a failed attempt is
 * "Retrying", not "Queued": the office should not read it as never started.
 */
export function rtwCheckStatusLabel(
  status: RtwCheckStatus,
  attempts: number | null | undefined,
): string {
  if (status === 'queued' && (attempts ?? 0) > 0) return 'Retrying';
  return RTW_CHECK_STATUS_LABEL[status];
}
