/**
 * THC's on-the-day phone number on the event page (ADR-0134 N1).
 *
 * The office types the number on /settings however it likes to read it
 * ("020 7946 0000", "+44 (0)20 7946 0000"); the link rings digits only, with
 * a leading + kept (RFC 3966). A UK "+44 (0)" drops its trunk zero, because
 * `tel:+4402…` does not ring — the same rule as the Staff App's on-site
 * contact (apps/staff/app/shifts/[id]/links.ts). Anything with fewer than
 * ten or more than fifteen digits is not a number to dial, and there is no
 * link at all.
 */
export function telHref(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\(0\)/g, '').replace(/[^\d+]/g, '');
  const plus = digits.startsWith('+');
  digits = digits.replace(/\+/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  return `tel:${plus ? '+' : ''}${digits}`;
}

/**
 * "Timesheets for this event go to a@x.com, b@y.com" (ADR-0134 N3): the
 * addresses in the order the office keeps them, each once, compared without
 * case. Empty when there are none, and the page then draws no line.
 */
export function recipientsLine(addresses: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of addresses ?? []) {
    const address = raw.trim();
    const key = address.toLowerCase();
    if (address === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(address);
  }
  return out;
}
