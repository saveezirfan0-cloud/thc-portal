/**
 * A name as it is printed on the passport (ADR-0187).
 *
 * The right-to-work check, payroll, the sign-in log and every badge match or
 * print this name, and the office reads it on a card beside a photo. A
 * surname typed as "M." or a first name as "J" cannot be matched against
 * anything, so the application form refuses it, the server action refuses it
 * again, and `submit_application()` refuses it a third time through
 * `name_fault()` (migration 20261023130000) — the same rule in the same
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
