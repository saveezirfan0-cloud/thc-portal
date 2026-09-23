/**
 * The gov.uk share code — Scope §2.5 (format corrected 31.07.2026).
 *
 * "Exactly 9 alphanumeric characters (letters and numbers), starting with
 * "W", e.g. W123AB4CD; case-insensitive; spaces are ignored on input (people
 * often paste it as three groups of three, e.g. "W12 3AB 4CD") … The input
 * field should validate against this format … before submitting to gov.uk."
 *
 * The earlier "letters only" wording in the scope is wrong and must not come
 * back: W123AB4CD has digits in it.
 *
 * The same pattern is repeated in SQL (`is_valid_share_code()`, migration
 * 20260923120000) because the database refuses a malformed code even when
 * the call does not come through this app. `onboarding.sql.test.ts` holds
 * the two to the same literal.
 */

/** Upper-case, whitespace removed. The form the database stores. */
export const SHARE_CODE_PATTERN = /^W[A-Z0-9]{8}$/;

/** The pattern as the SQL migration spells it — asserted equal in tests. */
export const SHARE_CODE_SQL_PATTERN = '^W[A-Z0-9]{8}$';

export const SHARE_CODE_EXAMPLE = 'W123AB4CD';

/** Case-insensitive, spaces ignored (§2.5). Nothing else is forgiven. */
export function normaliseShareCode(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

export function isValidShareCode(raw: string | null | undefined): boolean {
  if (!raw) return false;
  return SHARE_CODE_PATTERN.test(normaliseShareCode(raw));
}

/**
 * The field's error line, or null when the code is fine. Copy from
 * `wireframes/staff/onboarding-1.html` (EU/EEA — share code invalid).
 */
export function shareCodeError(raw: string | null | undefined): string | null {
  if (!raw || normaliseShareCode(raw) === '') return 'Enter your share code.';
  if (isValidShareCode(raw)) return null;
  return `Share code must be 9 letters and numbers starting with W — e.g. ${SHARE_CODE_EXAMPLE}. Spaces are fine, we'll remove them.`;
}

/** "W123AB4CD" → "W12 3AB 4CD", the way gov.uk prints it. Display only. */
export function formatShareCode(raw: string): string {
  const code = normaliseShareCode(raw);
  if (!SHARE_CODE_PATTERN.test(code)) return code;
  return `${code.slice(0, 3)} ${code.slice(3, 6)} ${code.slice(6)}`;
}
