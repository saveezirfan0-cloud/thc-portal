/**
 * A name as it is printed on the passport (ADR-0189).
 *
 * The right-to-work check, payroll, the sign-in log and every badge match or
 * print this name, and the office reads it on a card beside a photo. A
 * surname typed as "M." or a first name as "J" cannot be matched against
 * anything, so the application form refuses it, the server action refuses it
 * again, and `submit_application()` refuses it a third time through
 * `name_fault()` (migration 20261023130100) — the same rule in the same
 * order, held to `legalName.vectors.json` by both suites.
 *
 * What is refused is what cannot be a whole name: an initial (one letter,
 * with or without a full stop), any abbreviation with a full stop ("St.",
 * "J.R."), digits and symbols. What is NOT refused is anything that could be
 * a real name: hyphens, apostrophes, accents, spaces, two-letter names, and
 * capitalisation, which is left exactly as typed ("McDonald", "van der Berg",
 * "carlos"). The form cannot know a passport; it can only refuse the things a
 * passport never prints.
 */

/** The longest first-and-middle or surname a worker can have on file. */
export const LEGAL_NAME_MAX = 100;

export const NAME_FAULTS = ['required', 'too_long', 'initial', 'characters'] as const;
export type NameFault = (typeof NAME_FAULTS)[number];

/** Hyphen, non-breaking hyphen, hyphen-minus and en dash: parts of one name. */
const PART_SPLIT = /[\s‐‑–-]+/u;
/** One letter and nothing else (its accent marks included). */
const ONE_LETTER = /^\p{L}\p{M}*$/u;
/** Letters first, then letters, marks, spaces, hyphens, dashes and apostrophes. */
const NAME_CHARS = /^\p{L}[\p{L}\p{M}'’‐‑–\s-]*$/u;

/**
 * Why `raw` is not a whole name, or null when it is. `optional` is for the
 * middle-name field, where nothing at all is fine but "J." is not.
 *
 * The order is the SQL function's: required, too long, an initial or a full
 * stop, then characters — so one input always gets the same reason from all
 * three gates.
 */
export function nameFault(raw: string, optional = false): NameFault | null {
  const text = raw.normalize('NFC').trim();
  if (!text) return optional ? null : 'required';
  if (Array.from(text).length > LEGAL_NAME_MAX) return 'too_long';
  if (text.includes('.')) return 'initial';
  if (text.split(PART_SPLIT).some((part) => ONE_LETTER.test(part))) return 'initial';
  if (!NAME_CHARS.test(text)) return 'characters';
  return null;
}

/**
 * First and middle names as the one `staff.first_name` value they are stored
 * in (the passport's "given names"): whitespace tidied, nothing else changed.
 */
export function givenNames(first: string, middle: string): string {
  return [first, middle]
    .map((part) => part.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join(' ');
}

// ---------------------------------------------------------------------
// The office's correction of a name already on file (ADR-0193)
// ---------------------------------------------------------------------

/** The activity log's only account of why a name was changed. */
export const NAME_CORRECTION_REASON_MIN = 10;
export const NAME_CORRECTION_REASON_MAX = 300;

export type NameCorrectionRefusal =
  | `first_${NameFault}`
  | `last_${NameFault}`
  | 'unchanged'
  | 'reason_required'
  | 'reason_too_short'
  | 'reason_too_long';

export type NameCorrectionValidation =
  | { ok: true; first: string; last: string; reason: string }
  | {
      ok: false;
      field: 'first' | 'last' | 'reason';
      reason: NameCorrectionRefusal;
    };

/** NFC, trimmed, runs of whitespace as one space — what `office_correct_name()` stores. */
export function tidyName(raw: string): string {
  return raw.normalize('NFC').trim().replace(/\s+/g, ' ');
}

/**
 * `office_correct_name()`'s own checks, in its order, so the dialog says what
 * the database would: the first-and-middle names, the surname, "that is the
 * name already on file", then the reason. The codes are the database's.
 */
export function validateNameCorrection(
  input: { first: string; last: string; reason: string },
  current?: { first: string; last: string } | null,
): NameCorrectionValidation {
  const first = tidyName(input.first);
  const last = tidyName(input.last);
  const firstFault = nameFault(first);
  if (firstFault) return { ok: false, field: 'first', reason: `first_${firstFault}` };
  const lastFault = nameFault(last);
  if (lastFault) return { ok: false, field: 'last', reason: `last_${lastFault}` };
  if (current && current.first === first && current.last === last) {
    return { ok: false, field: 'first', reason: 'unchanged' };
  }
  const reason = input.reason.trim();
  if (!reason) return { ok: false, field: 'reason', reason: 'reason_required' };
  const length = Array.from(reason).length;
  if (length < NAME_CORRECTION_REASON_MIN) {
    return { ok: false, field: 'reason', reason: 'reason_too_short' };
  }
  if (length > NAME_CORRECTION_REASON_MAX) {
    return { ok: false, field: 'reason', reason: 'reason_too_long' };
  }
  return { ok: true, first, last, reason };
}

const GIVEN = 'first and middle names';
const part = (what: string, fault: NameFault): string =>
  ({
    required: `Enter the ${what} as printed on the passport.`,
    initial: `Enter the ${what} in full, as printed on the passport — no initials or full stops.`,
    characters: `The ${what} can only use letters, spaces, hyphens and apostrophes.`,
    too_long: `The ${what}: ${LEGAL_NAME_MAX} characters at most.`,
  })[fault];

/** The office's words for each refusal, whether the dialog or the database made it. */
export const NAME_CORRECTION_MESSAGES: Readonly<Record<NameCorrectionRefusal, string>> = {
  first_required: part(GIVEN, 'required'),
  first_initial: part(GIVEN, 'initial'),
  first_characters: part(GIVEN, 'characters'),
  first_too_long: part(GIVEN, 'too_long'),
  last_required: part('surname', 'required'),
  last_initial: part('surname', 'initial'),
  last_characters: part('surname', 'characters'),
  last_too_long: part('surname', 'too_long'),
  unchanged: 'That is the name already on file.',
  reason_required: 'Give a reason for the activity log.',
  reason_too_short: `The reason needs at least ${NAME_CORRECTION_REASON_MIN} characters.`,
  reason_too_long: `The reason can be at most ${NAME_CORRECTION_REASON_MAX} characters.`,
};
