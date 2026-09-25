import { UK_ZONE, formatDateTimeIn } from '@thc/domain';

/**
 * `datetime-local` gives a wall clock with no zone. §1.8 says the "Actual
 * finish (UK time)" field is UK time, so it is read as UK and converted to
 * the instant the server stores — not as the manager's own zone, which is
 * the bug this avoids for anyone working outside the UK.
 *
 * A module of its own, with no import from the dialog or the server
 * action: the dialog pulls in `./actions`, which is `@thc/db/server` and
 * therefore `server-only`, and a pure conversion must stay testable
 * without either.
 */
export function ukLocalToIso(local: string): string {
  const [date, time] = local.split('T');
  const [y, m, d] = (date ?? '').split('-').map(Number);
  const [hh, mm] = (time ?? '').split(':').map(Number);
  const guess = Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0);
  // Europe/London is UTC or UTC+1; find the offset that round-trips.
  for (const offset of [0, -3600_000]) {
    const candidate = new Date(guess + offset);
    const back = formatDateTimeIn(candidate, UK_ZONE);
    const wanted = formatDateTimeIn(new Date(guess), 'UTC');
    if (back === wanted) return candidate.toISOString();
  }
  return new Date(guess).toISOString();
}
