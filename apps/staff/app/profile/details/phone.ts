import { DIAL_CODES, toE164 } from '../../apply/form';

/**
 * The international phone control, shared with `/apply` (§2.1, ADR-0009).
 *
 * The emergency contact's phone uses the same picker and the same E.164
 * assembly the application form does (docs/18 §2: "the same international
 * picker"), so the two cannot disagree about what "+44 07700 900123" is.
 * This file adds only the reverse: splitting a stored E.164 number back
 * into the picker's code and the national part, for editing.
 */

export { DIAL_CODES, toE164 };

/** The default the form opens on, as `/apply` does. */
export const DEFAULT_DIAL_CODE = '+44';

/**
 * `+447700900456` → `{ dialCode: '+44', national: '7700900456' }`.
 *
 * Longest match wins, so `+353…` is Ireland and not `+3…`; a number whose
 * code is not in the list (or no number at all) opens on the UK code with
 * whatever digits there are, and the worker sees it to correct.
 */
export function splitE164(value: string | null | undefined): {
  dialCode: string;
  national: string;
} {
  const phone = (value ?? '').trim();
  if (!phone.startsWith('+')) return { dialCode: DEFAULT_DIAL_CODE, national: phone };
  const match = [...new Set(DIAL_CODES.map((c) => c.code as string))]
    .filter((code) => phone.startsWith(code))
    .sort((a, b) => b.length - a.length)[0];
  if (!match) return { dialCode: DEFAULT_DIAL_CODE, national: phone };
  return { dialCode: match, national: phone.slice(match.length) };
}
