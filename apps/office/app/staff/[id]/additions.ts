import { formatUkDate } from '../staff';
import { formatUkStamp } from './profile';
import type { AvailabilityRow, EmergencyContact } from './types';

/**
 * Presentation rules for the docs/19 additions on /staff/:id — the
 * Availability tab (ADR-0043), the Emergency contact card (ADR-0044) and
 * the Referrals card (ADR-0047). Pure, so Vitest drives them directly.
 *
 * The availability entries are UK wall-clock by construction: the worker
 * picks UK dates and "(UK time)" hours (§1.8), and an all-day entry is UK
 * midnight to UK midnight — 23 h on 29.03.2026, 25 h on 25.10.2026. So
 * every date and hour here is read in Europe/London, whatever the viewer's
 * zone, and the tab says "UK time" in its header.
 */
const UK = 'Europe/London';
const DAY_MS = 24 * 60 * 60 * 1000;

/** "2026-10-25" — the UK calendar date an instant falls on. */
export function ukDateKey(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: UK,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** "Tue 23 Sep" in UK time. ICU's "Sept" is cut to the wireframe's "Sep". */
export function ukDay(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: UK,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('weekday')} ${part('day')} ${part('month').slice(0, 3)}`;
}

function ukTime(at: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: UK,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}

/**
 * The When (UK) column. All day: "Tue 23 Sep · all day", or a range
 * "Mon 29 Sep – Fri 3 Oct · all day" — the stored end is the midnight
 * AFTER the last day (half-open), so the last day is the one before it. A
 * window: "Wed 1 Oct · 18:00 – 23:00"; one that runs past UK midnight says
 * so rather than letting "22:00 – 02:00" read as a four-hour gap in the day.
 */
export function availabilityWhen(
  row: Pick<AvailabilityRow, 'starts_at' | 'ends_at' | 'all_day'>,
): string {
  const start = new Date(row.starts_at);
  const end = new Date(row.ends_at);
  if (row.all_day) {
    const last = new Date(end.getTime() - 1);
    return ukDateKey(start) === ukDateKey(last)
      ? `${ukDay(start)} · all day`
      : `${ukDay(start)} – ${ukDay(last)} · all day`;
  }
  if (ukDateKey(start) === ukDateKey(end)) {
    return `${ukDay(start)} · ${ukTime(start)} – ${ukTime(end)}`;
  }
  if (end.getTime() - start.getTime() < DAY_MS) {
    return `${ukDay(start)} · ${ukTime(start)} – ${ukTime(end)} next day`;
  }
  return `${ukDay(start)} ${ukTime(start)} – ${ukDay(end)} ${ukTime(end)}`;
}

function hoursAndMinutes(ms: number): string {
  const minutes = Math.round(ms / 60000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/**
 * The Length column. A single all-day entry is its real length in hours —
 * 24 h, or 23 h / 25 h across a clock change — because that is what the
 * gate measures. Several days read as days.
 */
export function availabilityLength(
  row: Pick<AvailabilityRow, 'starts_at' | 'ends_at' | 'all_day'>,
): string {
  const ms = new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime();
  if (row.all_day) {
    const days = Math.round(ms / DAY_MS);
    return days <= 1 ? hoursAndMinutes(ms) : `${days} days`;
  }
  return hoursAndMinutes(ms);
}

/** The Repeats column: "weekly · 6 (to Wed 5 Nov)", or null for a one-off. */
export function availabilityRepeats(
  row: Pick<AvailabilityRow, 'series_id' | 'series_count' | 'series_last_start'>,
): string | null {
  if (!row.series_id || row.series_count <= 1 || !row.series_last_start) return null;
  return `weekly · ${row.series_count} (to ${ukDay(new Date(row.series_last_start))})`;
}

/**
 * An E.164 number grouped for reading. A UK mobile/landline in the
 * wireframe's "+44 7700 900456" shape; anything else as stored — guessing
 * another country's grouping would be worse than none.
 */
export function formatPhone(e164: string): string {
  const uk = /^\+44(\d{10})$/.exec(e164);
  if (uk?.[1]) return `+44 ${uk[1].slice(0, 4)} ${uk[1].slice(4)}`;
  return e164;
}

/** "18.09.2026 14:36 UK time · by the worker" — an audit stamp, UK only (§1.8). */
export function contactUpdatedLine(
  contact: Pick<EmergencyContact, 'updatedAt' | 'updatedBy' | 'updatedByName'>,
): string {
  const who =
    contact.updatedBy === 'worker'
      ? 'by the worker'
      : contact.updatedBy === 'office'
        ? `by the office${contact.updatedByName ? ` (${contact.updatedByName})` : ''}`
        : null;
  return who ? `${formatUkStamp(contact.updatedAt)} · ${who}` : formatUkStamp(contact.updatedAt);
}

/** The Added column. */
export function addedOn(iso: string): string {
  return formatUkDate(iso);
}
