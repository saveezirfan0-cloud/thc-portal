/**
 * Phone search for the office's lists (/staff, /onboarding).
 *
 * Numbers are stored as E.164 (`+447700900456`) but a manager types what is
 * in front of them — `07700 900456`, `+44 7700 900456`, `900456`. Both sides
 * are reduced to digits and a UK `+44` / `0044` prefix to the national `0`,
 * so any of those finds the same person. The raw digits are compared too, so
 * `447700…` typed without the plus still matches.
 *
 * Only a phone-shaped query (digits, spaces, `+ - ( ) .`) with at least four
 * digits is tried, so a name or an Employee ID like `THC-00873` never
 * reaches it and two or three digits do not light up half the list.
 */
const PHONE_SHAPED = /^[\d\s+\-().]+$/;
const MIN_DIGITS = 4;

function forms(value: string): string[] {
  const compact = value.trim().replace(/[\s\-().]/g, '');
  const digits = compact.replace(/\D/g, '');
  const international = /^(\+|00)44/.exec(compact);
  if (!international) return [digits];
  return [`0${digits.slice(international[1] === '+' ? 2 : 4)}`, digits];
}

export function isPhoneQuery(query: string): boolean {
  const needle = query.trim();
  return PHONE_SHAPED.test(needle) && needle.replace(/\D/g, '').length >= MIN_DIGITS;
}

export function phoneMatches(phone: string | null | undefined, query: string): boolean {
  if (!phone || !isPhoneQuery(query)) return false;
  const haystacks = forms(phone);
  return forms(query).some((needle) => haystacks.some((hay) => hay.includes(needle)));
}
