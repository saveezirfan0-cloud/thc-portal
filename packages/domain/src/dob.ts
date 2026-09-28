/**
 * Date of birth — how it is typed (ADR-0068) and when a change to it is
 * accepted (ADR-0070).
 *
 * The date of birth is what gov.uk matches a share code against (ADR-0025,
 * ADR-0041), what decides whether a 48-hour opt-out can be signed
 * (`canSignOptOut`, RULE-20) and what the HMRC New Starter report carries
 * (§9.9). Since 28.09.2026 it can be corrected after onboarding by three
 * routes, each held to the same rule, `dobChangeProblem()`, and to
 * `dob_change_problem()` in SQL (20261001210000) — both driven by the
 * `dobs` group of changeRequest.vectors.json:
 *
 *   - the office's "Correct" on /staff/:id and /onboarding/:id
 *     (`office_correct_dob`, owners and managers only);
 *   - the worker's "New share code" form on the Documents hub, which sends
 *     the date with the code (`submit_share_code_with_dob`);
 *   - Request a change → Date of birth (`request_dob_change`), approved by
 *     the office.
 *
 * The rule is /apply's (§2.1, `submit_application`): a real date, not in
 * the future, at most 100 completed years ago, and 18 or over in UK time.
 * A change also has to be a change.
 */

import { ageOn } from './onboarding';

/** §2.1: "under 18 is refused out loud". */
export const DOB_MIN_AGE = 18;
/** Older than this is a typo, not a worker — `MAX_AGE` on /apply. */
export const DOB_MAX_AGE = 100;

export type DobProblem = 'dob_required' | 'dob_invalid' | 'under_18';
export type DobChangeRefusal = DobProblem | 'unchanged';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A `yyyy-mm-dd` that names a day that exists (31/02 does not). */
export function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Whether a date can be a worker's date of birth on `today` (a UK civil
 * date, `ukToday()`). Null when it can.
 */
export function dobProblem(dob: string | null | undefined, today: string): DobProblem | null {
  const value = (dob ?? '').trim();
  if (value === '') return 'dob_required';
  if (!isRealIsoDate(value)) return 'dob_invalid';
  if (value > today) return 'dob_invalid';
  const age = ageOn(value, today);
  if (age > DOB_MAX_AGE) return 'dob_invalid';
  if (age < DOB_MIN_AGE) return 'under_18';
  return null;
}

/**
 * A correction: `dobProblem()`, and then not the date already on file — a
 * no-op is refused so the audit trail only records real changes.
 */
export function dobChangeProblem(
  proposed: string | null | undefined,
  current: string | null | undefined,
  today: string,
): DobChangeRefusal | null {
  const problem = dobProblem(proposed, today);
  if (problem) return problem;
  if (current && (proposed ?? '').trim() === current.slice(0, 10)) return 'unchanged';
  return null;
}

// ---------------------------------------------------------------------
// The office's correction (ADR-0070)
// ---------------------------------------------------------------------

/** "Why" is the audit trail's only account of the change: say something. */
export const DOB_CORRECTION_REASON_MIN = 10;
/** The audit row's reason, as `profile_change_requests.decision_reason`. */
export const DOB_CORRECTION_REASON_MAX = 300;

export type DobCorrectionRefusal =
  DobChangeRefusal | 'reason_required' | 'reason_too_short' | 'reason_too_long';

export type DobCorrectionValidation =
  | { ok: true; dob: string; reason: string }
  | { ok: false; field: 'dob' | 'reason'; reason: DobCorrectionRefusal };

/** The Correct dialog's check — `office_correct_dob()` refuses the same, in this order. */
export function validateDobCorrection(
  input: { dob: string; reason: string },
  current: string | null,
  today: string,
): DobCorrectionValidation {
  const dobRefusal = dobChangeProblem(input.dob, current, today);
  if (dobRefusal) return { ok: false, field: 'dob', reason: dobRefusal };
  const reason = input.reason.trim();
  const length = Array.from(reason).length;
  if (length === 0) return { ok: false, field: 'reason', reason: 'reason_required' };
  if (length < DOB_CORRECTION_REASON_MIN) {
    return { ok: false, field: 'reason', reason: 'reason_too_short' };
  }
  if (length > DOB_CORRECTION_REASON_MAX) {
    return { ok: false, field: 'reason', reason: 'reason_too_long' };
  }
  return { ok: true, dob: input.dob.trim(), reason };
}

/** What each refusal says to a manager (the Correct dialog, the change-request queue). */
export const DOB_CORRECTION_MESSAGES: Readonly<Record<DobCorrectionRefusal, string>> = {
  dob_required: 'Enter the date of birth.',
  dob_invalid: 'Enter a real date of birth, as day, month and year.',
  under_18: 'That date makes them under 18, and under-18s cannot work with us.',
  unchanged: 'That is the date of birth already on file.',
  reason_required: 'Give a reason — it goes in the activity log.',
  reason_too_short: `Give a reason of at least ${DOB_CORRECTION_REASON_MIN} characters — it goes in the activity log.`,
  reason_too_long: `Keep the reason to ${DOB_CORRECTION_REASON_MAX} characters.`,
};

// ---------------------------------------------------------------------
// Typing it (ADR-0068) — lifted from apps/staff/app/apply/dob.ts so the
// Back Office's Correct dialog types a date the way /apply does.
// ---------------------------------------------------------------------

/**
 * What the text box shows, re-formatted from whatever was typed or pasted.
 *
 * The field shows `DD/MM/YYYY` (UK order, §1.8) and inserts the slashes
 * itself, so "05061998" reads back as "05/06/1998". A slash typed after a
 * single digit pads it ("5/6/1998" → "05/06/1998"). Browser autofill for
 * `bday` may hand over `1998-06-05`, which is turned round the same way.
 */
export function formatDobTyping(raw: string): string {
  const iso = /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/.exec(raw);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;

  const parts: string[] = [];
  let current = '';
  let trailingSlash = false;
  for (const ch of raw) {
    if (parts.length === 3) break;
    if (/\d/.test(ch)) {
      trailingSlash = false;
      current += ch;
      const full = parts.length < 2 ? current.length === 2 : current.length === 4;
      if (full) {
        parts.push(current);
        current = '';
      }
    } else if (/[/.\-\s]/.test(ch)) {
      if (current.length === 1 && parts.length < 2) {
        parts.push(`0${current}`);
        current = '';
      }
      // Only a slash typed straight after a complete day or month is kept,
      // so it can be seen; the next digit would have added it anyway.
      trailingSlash = current === '' && parts.length > 0 && parts.length < 3;
    }
  }
  const shown = [...parts, current].filter(Boolean).join('/');
  return trailingSlash ? `${shown}/` : shown;
}

/**
 * The form's value for what the box shows: `yyyy-mm-dd` once complete. A
 * complete entry becomes that shape even when the day does not exist
 * (31/02 → `…-02-31`), so the validator still says "Enter a real date"; a
 * half-typed one is passed through as typed, which it refuses the same way.
 */
export function dobValueFrom(shown: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(shown);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : shown;
}

/** What the box shows for a stored value (`yyyy-mm-dd`, or a half-typed one). */
export function dobShownFrom(value: string): string {
  return formatDobTyping(value);
}
