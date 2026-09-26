import { describe, expect, it } from 'vitest';
import { UNAVAILABILITY_REFUSALS, ukInstant, validateUnavailability } from '@thc/domain';
import {
  AVAILABILITY_REASONS,
  CONFLICT_COPY,
  addSheetYourTime,
  entrySub,
  entryTitle,
  groupByWeek,
  remainingInSeries,
  repeatHint,
  saveLabel,
  toInput,
  ukWeekOf,
} from '../model';
import type { AddForm, UnavailabilityEntry } from '../model';

/**
 * /profile/availability's labels and the Add sheet's shaping (ADR-0042).
 * The rules are @thc/domain's and the RPC's; this pins what the worker
 * reads, in UK time, across the October clock change.
 */

const allDay = (id: string, from: string, to = from, series?: Partial<UnavailabilityEntry>) => ({
  id,
  startsAt: ukInstant(from, '00:00'),
  endsAt: ukInstant(nextDay(to), '00:00'),
  allDay: true,
  seriesId: null,
  seriesIndex: null,
  seriesCount: null,
  ...series,
});

const window = (
  id: string,
  date: string,
  from: string,
  to: string,
  series?: Partial<UnavailabilityEntry>,
) => ({
  id,
  startsAt: ukInstant(date, from),
  endsAt: ukInstant(to <= from ? nextDay(date) : date, to),
  allDay: false,
  seriesId: null,
  seriesIndex: null,
  seriesCount: null,
  ...series,
});

function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const form = (over: Partial<AddForm> = {}): AddForm => ({
  mode: 'day',
  fromDate: '2026-10-21',
  toDate: '2026-10-21',
  allDay: false,
  fromTime: '18:00',
  toTime: '23:00',
  repeatWeeks: 0,
  ...over,
});

describe('entry labels (UK time)', () => {
  it('names one all-day date, and a range by both ends with its length', () => {
    expect(entryTitle(allDay('a', '2026-09-27'))).toBe('Sun 27 Sep');
    expect(entrySub(allDay('a', '2026-09-27'))).toBe('All day');
    const range = allDay('b', '2026-09-28', '2026-10-02');
    expect(entryTitle(range)).toBe('Mon 28 Sep – Fri 2 Oct');
    expect(entrySub(range)).toBe('All day · 5 days');
  });

  it('keeps an all-day entry on the clock-change Sunday (25 h) to one day', () => {
    const day = allDay('c', '2026-10-25');
    expect(day.endsAt.getTime() - day.startsAt.getTime()).toBe(25 * 3_600_000);
    expect(entryTitle(day)).toBe('Sun 25 Oct');
    expect(entrySub(day)).toBe('All day');
  });

  it('writes a window as the UK day and times, overnight included', () => {
    expect(entryTitle(window('d', '2026-10-01', '18:00', '23:00'))).toBe(
      'Thu 1 Oct · 18:00 – 23:00',
    );
    expect(entryTitle(window('e', '2026-10-01', '22:00', '02:00'))).toBe(
      'Thu 1 Oct · 22:00 – 02:00',
    );
  });

  it('says where a weekly copy sits in its series, and where the series ends', () => {
    const series = [1, 2, 3].map((n) =>
      window(`s${n}`, ['2026-10-21', '2026-10-28', '2026-11-04'][n - 1]!, '18:00', '23:00', {
        seriesId: 'S',
        seriesIndex: n,
        seriesCount: 3,
      }),
    );
    expect(entrySub(series[0]!, series)).toBe('Repeats weekly · 1 of 3 (to Wed 4 Nov)');
    expect(entrySub(series[1]!, series)).toBe('Repeats weekly · 2 of 3');
    expect(remainingInSeries(series[1]!, series)).toBe(3);
    expect(remainingInSeries(allDay('x', '2026-10-01'), series)).toBe(1);
  });

  it('keeps 18:00 UK on both sides of the October changeover', () => {
    const before = window('b', '2026-10-21', '18:00', '23:00');
    const after = window('a', '2026-10-28', '18:00', '23:00');
    expect(entryTitle(before)).toContain('18:00 – 23:00');
    expect(entryTitle(after)).toContain('18:00 – 23:00');
    // …which is a different UTC hour, as it should be.
    expect(before.startsAt.getUTCHours()).toBe(17);
    expect(after.startsAt.getUTCHours()).toBe(18);
  });
});

describe('groupByWeek', () => {
  it('groups by the UK Monday, oldest first', () => {
    const groups = groupByWeek([
      allDay('late', '2026-10-01'),
      allDay('early', '2026-09-27'),
      allDay('mon', '2026-09-28'),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['Week of Mon 21 Sep', 'Week of Mon 28 Sep']);
    expect(groups[1]!.entries.map((e) => e.id)).toEqual(['mon', 'late']);
  });

  it('puts a Sunday late-evening UK entry in its own week, not the next (BST)', () => {
    // 23:30 BST on Sunday 27 Sep is 22:30Z — still that Sunday in the UK.
    expect(ukWeekOf(ukInstant('2026-09-27', '23:30'))).toBe('2026-09-21');
  });
});

describe('the Add sheet', () => {
  it('sends a day, a range, all day or a window exactly as validateUnavailability takes it', () => {
    expect(toInput(form({ allDay: true }))).toEqual({
      fromDate: '2026-10-21',
      toDate: null,
      fromTime: null,
      toTime: null,
      repeatWeeks: 0,
    });
    expect(toInput(form({ mode: 'range', toDate: '2026-10-24', repeatWeeks: 2 }))).toEqual({
      fromDate: '2026-10-21',
      toDate: '2026-10-24',
      fromTime: '18:00',
      toTime: '23:00',
      repeatWeeks: 2,
    });
    const now = new Date('2026-09-25T12:00:00Z');
    expect(validateUnavailability(toInput(form({ repeatWeeks: 5 })), now).ok).toBe(true);
  });

  it('labels Save with the number of entries a repeat makes', () => {
    expect(saveLabel({ repeatWeeks: 0 })).toBe('Save');
    expect(saveLabel({ repeatWeeks: 5 })).toBe('Save 6 entries');
  });

  it('explains the repeat, and that the UK time holds across the clock change', () => {
    expect(repeatHint(form())).toBe('Up to 26 weeks. Leave at 0 for just this day.');
    expect(repeatHint(form({ repeatWeeks: 2 }))).toBe(
      'Every Wednesday to Wed 4 Nov. Keeps 18:00 UK across the clock change.',
    );
    expect(repeatHint(form({ repeatWeeks: 2, allDay: true }))).toBe(
      'Every Wednesday to Wed 4 Nov.',
    );
  });

  it('adds a "your time" line only when the phone is not on UK time (§1.8)', () => {
    expect(addSheetYourTime(form(), 'Europe/London')).toBeNull();
    expect(addSheetYourTime(form({ allDay: true }), 'Europe/Madrid')).toBeNull();
    expect(addSheetYourTime(form({ fromDate: '2026-10-01' }), 'Europe/Madrid')).toBe(
      '19:00 – 00:00 your time (Madrid)',
    );
    expect(addSheetYourTime(form({ fromDate: '2026-10-01' }), 'America/New_York')).toBe(
      '13:00 – 18:00 your time (New York)',
    );
  });
});

describe('copy', () => {
  it('has a sentence for every refusal the RPC can return', () => {
    for (const reason of UNAVAILABILITY_REFUSALS) {
      expect(AVAILABILITY_REASONS[reason]).toBeTruthy();
    }
  });

  it('carries the conflict warning verbatim (docs/19 §1)', () => {
    expect(CONFLICT_COPY.replace(/’/g, "'")).toBe(
      "Marking yourself unavailable doesn't cancel this shift — use Cancel or Offer on the shift.",
    );
  });
});
