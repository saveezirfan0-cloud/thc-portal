import { UK_ZONE, formatDateIn, formatTimeIn, ukInstant, ukToday } from '@thc/domain';
import type { UnavailabilityInput, UnavailabilityRefusal } from '@thc/domain';

/**
 * Availability — the pure half of `/profile/availability` (ADR-0036,
 * docs/18 §1, `wireframes/staff/availability.html`).
 *
 * Everything here is a function of the rows `my_unavailability()` returns
 * and the Add sheet's fields, so the list, the labels and the refusal copy
 * are tested without a browser. The rules themselves — UK wall clock, the
 * refusal order, 31 days, 26 repeats — are `validateUnavailability()` in
 * `@thc/domain` and `add_my_unavailability()` in SQL; this file only says
 * them to the worker.
 */

/** One row of `my_unavailability()`. */
export interface UnavailabilityEntry {
  id: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  seriesId: string | null;
  /** 1-based position in its weekly series, counted over the whole series. */
  seriesIndex: number | null;
  seriesCount: number | null;
}

/** A confirmed shift an entry overlaps — the worker's own booking (RULE-18 window). */
export interface AvailabilityConflict {
  bookingId: string;
  event: string;
  role: string;
  venue: string;
  startsAt: Date;
  endsAt: Date;
}

/** The wireframe's warning, verbatim (docs/18 §1, ADR-0036). */
export const CONFLICT_COPY =
  'Marking yourself unavailable doesn’t cancel this shift — use Cancel or Offer on the shift.';

export const INTRO_COPY =
  'Mark days or times you can’t work. We won’t send you automatic invitations for them. You can still accept or apply for anything yourself.';

export const EMPTY_COPY =
  'Add the days or times you can’t work, and we won’t send you automatic invitations for them.';

/** What each refusal means to the worker. The codes are the RPC's. */
export const AVAILABILITY_REASONS: Record<UnavailabilityRefusal | 'not_found', string> = {
  bad_window:
    'Check the dates and times: “To” can’t be the same as “From”, and a range can’t end before it starts.',
  in_past: 'That’s in the past. Pick today or a later date.',
  too_far: 'You can mark days up to 12 months ahead.',
  too_long: 'One entry can cover up to 31 days. Add a longer break as two entries.',
  too_many:
    'That’s too many entries: up to 26 weekly repeats, and 200 upcoming entries in all. Delete some you no longer need first.',
  not_found: 'That entry has already been deleted.',
};

/** Repeat weekly for N weeks — N extra copies, at most 26 (Q10). */
export const MAX_REPEAT_WEEKS = 26;

const DAY_MS = 86_400_000;

/** A civil date moved by whole days. */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

/** Whole days from one civil date to another. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** The Monday (UK) of the week an instant falls in, `YYYY-MM-DD`. */
export function ukWeekOf(instant: Date): string {
  const day = ukToday(instant);
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, -((weekday + 6) % 7));
}

/** "Sat 27 Sep" for a civil UK date. */
export function ukDayLabel(isoDate: string): string {
  return formatDateIn(ukInstant(isoDate, '12:00'), UK_ZONE, { weekday: 'short' });
}

/** The last UK date an all-day entry covers (its end is the next midnight). */
function lastUkDay(entry: Pick<UnavailabilityEntry, 'endsAt'>): string {
  return ukToday(new Date(entry.endsAt.getTime() - 1));
}

/**
 * The card's first line.
 *
 *   all day, one date   "Sat 27 Sep"
 *   all day, a range    "Mon 29 Sep – Fri 3 Oct"
 *   a time window       "Wed 1 Oct · 18:00 – 23:00" (the screen adds "UK time")
 */
export function entryTitle(entry: UnavailabilityEntry): string {
  const first = ukToday(entry.startsAt);
  if (entry.allDay) {
    const last = lastUkDay(entry);
    return last === first ? ukDayLabel(first) : `${ukDayLabel(first)} – ${ukDayLabel(last)}`;
  }
  const window = `${formatTimeIn(entry.startsAt, UK_ZONE)} – ${formatTimeIn(entry.endsAt, UK_ZONE)}`;
  const endDay = ukToday(entry.endsAt);
  // A window over several dates names both; an overnight one reads like a
  // shift, "Fri 3 Oct · 22:00 – 02:00".
  if (daysBetween(first, endDay) > 1) {
    return `${ukDayLabel(first)} ${formatTimeIn(entry.startsAt, UK_ZONE)} – ${ukDayLabel(endDay)} ${formatTimeIn(entry.endsAt, UK_ZONE)}`;
  }
  return `${ukDayLabel(first)} · ${window}`;
}

/** The card's second line: "All day · 5 days", "Repeats weekly · 3 of 6 (to Wed 22 Oct)". */
export function entrySub(
  entry: UnavailabilityEntry,
  series: readonly UnavailabilityEntry[] = [],
): string {
  const parts: string[] = [];
  if (entry.allDay) {
    const days = daysBetween(ukToday(entry.startsAt), lastUkDay(entry)) + 1;
    parts.push(days > 1 ? `All day · ${days} days` : 'All day');
  }
  if (entry.seriesId && entry.seriesIndex && entry.seriesCount) {
    const last = series
      .filter((other) => other.seriesId === entry.seriesId)
      .reduce<UnavailabilityEntry | null>(
        (latest, other) => (!latest || other.startsAt > latest.startsAt ? other : latest),
        null,
      );
    const to =
      entry.seriesIndex === 1 && last && last.id !== entry.id
        ? ` (to ${ukDayLabel(ukToday(last.startsAt))})`
        : '';
    parts.push(`Repeats weekly · ${entry.seriesIndex} of ${entry.seriesCount}${to}`);
  }
  return parts.join(' · ');
}

export interface WeekGroup {
  /** The UK Monday, `YYYY-MM-DD`. */
  weekOf: string;
  label: string;
  entries: UnavailabilityEntry[];
}

/** "Week of Mon 22 Sep" groups, oldest first, entries in start order. */
export function groupByWeek(entries: readonly UnavailabilityEntry[]): WeekGroup[] {
  const sorted = [...entries].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const groups: WeekGroup[] = [];
  for (const entry of sorted) {
    const weekOf = ukWeekOf(entry.startsAt);
    let group = groups.find((g) => g.weekOf === weekOf);
    if (!group) {
      group = { weekOf, label: `Week of ${ukDayLabel(weekOf)}`, entries: [] };
      groups.push(group);
    }
    group.entries.push(entry);
  }
  return groups;
}

/** How many copies of this entry's series are still listed — "All 6". */
export function remainingInSeries(
  entry: UnavailabilityEntry,
  entries: readonly UnavailabilityEntry[],
): number {
  if (!entry.seriesId) return 1;
  return entries.filter((other) => other.seriesId === entry.seriesId).length;
}

/** The Add sheet's state. Dates `YYYY-MM-DD`, times `HH:MM`, both UK. */
export interface AddForm {
  mode: 'day' | 'range';
  fromDate: string;
  toDate: string;
  allDay: boolean;
  fromTime: string;
  toTime: string;
  repeatWeeks: number;
}

/** What the sheet sends — the input `validateUnavailability()` and the RPC take. */
export function toInput(form: AddForm): UnavailabilityInput {
  return {
    fromDate: form.fromDate,
    toDate: form.mode === 'range' ? form.toDate || form.fromDate : null,
    fromTime: form.allDay ? null : form.fromTime,
    toTime: form.allDay ? null : form.toTime,
    repeatWeeks: form.repeatWeeks,
  };
}

/** "Save", or "Save 6 entries" once the repeat makes several. */
export function saveLabel(form: Pick<AddForm, 'repeatWeeks'>): string {
  const count = Math.max(0, Math.floor(form.repeatWeeks)) + 1;
  return count > 1 ? `Save ${count} entries` : 'Save';
}

/**
 * The hint under "Repeat weekly for · weeks". With a repeat it names the
 * weekday and the last date — "Every Wednesday to Wed 5 Nov." — and, for a
 * time window, that the UK time holds across a clock change (ADR-0036 §3).
 */
export function repeatHint(form: AddForm): string {
  const weeks = Math.floor(form.repeatWeeks);
  if (!(weeks > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(form.fromDate)) {
    return `Up to ${MAX_REPEAT_WEEKS} weeks. Leave at 0 for just this day.`;
  }
  const weekday = formatDateIn(ukInstant(form.fromDate, '12:00'), UK_ZONE, {
    weekday: 'long',
  }).split(' ')[0];
  const last = ukDayLabel(addDays(form.fromDate, 7 * weeks));
  const keeps = form.allDay ? '' : ` Keeps ${form.fromTime} UK across the clock change.`;
  return `Every ${weekday} to ${last}.${keeps}`;
}

/**
 * The §1.8 "your time" line under the two "(UK time)" inputs, or null when
 * the phone is on UK time, the entry is all day, or the fields are not a
 * window yet. "19:00 – 00:00 your time (Madrid)".
 */
export function addSheetYourTime(form: AddForm, zone: string): string | null {
  if (zone === UK_ZONE || form.allDay) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.fromDate)) return null;
  if (!/^\d{2}:\d{2}$/.test(form.fromTime) || !/^\d{2}:\d{2}$/.test(form.toTime)) return null;
  const endDate =
    form.mode === 'range' && form.toDate
      ? form.toDate
      : form.toTime <= form.fromTime
        ? addDays(form.fromDate, 1)
        : form.fromDate;
  const start = ukInstant(form.fromDate, form.fromTime);
  const end = ukInstant(endDate, form.toTime);
  const city = zone.split('/').pop()?.replace(/_/g, ' ') ?? zone;
  return `${formatTimeIn(start, zone)} – ${formatTimeIn(end, zone)} your time (${city})`;
}

/** Today in the UK, for the date inputs' defaults and `min`. */
export function ukTodayIso(now: Date = new Date()): string {
  return ukToday(now);
}
