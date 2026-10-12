import { describe, expect, it } from 'vitest';
import vectors from '../series.vectors.json' with { type: 'json' };
import {
  NOT_AVAILABLE_ALL_DAYS,
  type SeriesSection,
  projectSeriesWeeks,
  seriesGate,
  seriesHoursBlocked,
  seriesPosition,
  seriesPositionLabel,
  seriesSiblings,
} from '../series';
import type { RotaGuardInput } from '../rotaGuard';

describe('same staff on all days: projected hours (shared vectors, ADR-0116)', () => {
  it.each(vectors.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const weeks = projectSeriesWeeks(c.days);
    expect(weeks.map((w) => ({ weekStart: w.weekStart, hours: w.hours }))).toEqual(c.expect.weeks);
    const blocked = seriesHoursBlocked(
      weeks,
      () => ({
        capHours: c.context.capHours,
        band: c.context.band as RotaGuardInput['band'],
        bookedHours: c.context.bookedHours,
      }),
      c.mode as RotaGuardInput['mode'],
    );
    expect(blocked).toBe(c.expect.blocked);
  });

  it('covers both outcomes, so neither side can drift to always-true or always-false', () => {
    expect(new Set(vectors.cases.map((c) => c.expect.blocked))).toEqual(new Set([true, false]));
  });

  it('the request that started it: Fri 20, Sat 21, Sun 22 Nov at 8 h each, in a student-visa term week', () => {
    const c = vectors.cases.find((v) => v.name.startsWith('student_term_three_8h'))!;
    expect(c.days.map((d) => d.startsOn)).toEqual(['2026-11-20', '2026-11-21', '2026-11-22']);
    expect(c.expect.blocked).toBe(true);
  });
});

const section = (over: Partial<SeriesSection> & { shiftId: string }): SeriesSection => ({
  eventId: `ev-${over.shiftId}`,
  seriesId: 'series-1',
  roleId: 'bar',
  sameStaffAllDays: true,
  eventCancelled: false,
  endsAt: new Date('2026-11-21T23:00:00Z'),
  startsOn: '2026-11-21',
  hours: 8,
  ...over,
});

describe('which sections a flagged section must also be fillable on', () => {
  const NOW = new Date('2026-11-01T09:00:00Z');
  const fri = section({ shiftId: 'fri', endsAt: new Date('2026-11-20T23:00:00Z') });
  const sat = section({ shiftId: 'sat' });
  const sun = section({ shiftId: 'sun', endsAt: new Date('2026-11-22T23:00:00Z') });

  it('are the other days of the series with the same role and the flag on', () => {
    expect(seriesSiblings(sat, [fri, sat, sun], NOW).map((s) => s.shiftId)).toEqual(['fri', 'sun']);
  });

  it('are none when this section is not flagged: the requirement is per role', () => {
    expect(seriesSiblings({ ...sat, sameStaffAllDays: false }, [fri, sun], NOW)).toEqual([]);
  });

  it('are none for a single-day event', () => {
    expect(seriesSiblings({ ...sat, seriesId: null }, [fri, sun], NOW)).toEqual([]);
  });

  it('leave out a day that does not ask for the same staff, another role, another series and a cancelled day', () => {
    const others = [
      { ...fri, sameStaffAllDays: false },
      { ...sun, roleId: 'chef' },
      section({ shiftId: 'x', seriesId: 'series-2' }),
      section({ shiftId: 'y', eventCancelled: true }),
    ];
    expect(seriesSiblings(sat, others, NOW)).toEqual([]);
  });

  it('leave out a day that has already ended: it cannot be rostered', () => {
    const past = section({ shiftId: 'past', endsAt: new Date('2026-10-31T23:00:00Z') });
    expect(seriesSiblings(sat, [past, sun], NOW).map((s) => s.shiftId)).toEqual(['sun']);
  });

  it("never include the event's own other sections", () => {
    const same = section({ shiftId: 'sat-2', eventId: sat.eventId });
    expect(seriesSiblings(sat, [same, sun], NOW).map((s) => s.shiftId)).toEqual(['sun']);
  });
});

describe('the series gate', () => {
  it('passes a worker who clears every day', () => {
    expect(
      seriesGate({ siblingGates: [null, null], unavailableOnASibling: false, hoursBlocked: false }),
    ).toBeNull();
  });

  it('passes when there are no siblings at all', () => {
    expect(
      seriesGate({ siblingGates: [], unavailableOnASibling: false, hoursBlocked: false }),
    ).toBeNull();
  });

  it.each([
    'wrong_role',
    'blocked',
    'booked_elsewhere',
    'self_cancelled',
    'do_not_return',
    'hours_limit',
    'rtw_expired',
  ])('refuses a worker the pool gates on another day: %s', (gate) => {
    expect(
      seriesGate({ siblingGates: [null, gate], unavailableOnASibling: false, hoursBlocked: false }),
    ).toBe(NOT_AVAILABLE_ALL_DAYS);
  });

  it('refuses a worker who marked another day unavailable', () => {
    expect(
      seriesGate({ siblingGates: [null], unavailableOnASibling: true, hoursBlocked: false }),
    ).toBe(NOT_AVAILABLE_ALL_DAYS);
  });

  it('refuses a worker whose projected hours are over their cap', () => {
    expect(
      seriesGate({ siblingGates: [null], unavailableOnASibling: false, hoursBlocked: true }),
    ).toBe(NOT_AVAILABLE_ALL_DAYS);
  });
});

describe('Day 2 of 3', () => {
  const members = [
    { eventId: 'sun', date: '2026-11-22', cancelled: false },
    { eventId: 'fri', date: '2026-11-20', cancelled: false },
    { eventId: 'sat', date: '2026-11-21', cancelled: false },
  ];

  it('numbers the days by date', () => {
    expect(seriesPosition('sat', members)).toEqual({ day: 2, of: 3 });
    expect(seriesPositionLabel(seriesPosition('fri', members)!)).toBe('Day 1 of 3');
    expect(seriesPositionLabel(seriesPosition('sun', members)!)).toBe('Day 3 of 3');
  });

  it('says nothing for an event that stands alone', () => {
    expect(seriesPosition('fri', [members[1]!])).toBeNull();
    expect(seriesPosition('nobody', members)).toBeNull();
  });

  it('does not count a cancelled day, and numbers nothing on it', () => {
    const cancelled = members.map((m) => (m.eventId === 'sat' ? { ...m, cancelled: true } : m));
    expect(seriesPosition('sun', cancelled)).toEqual({ day: 2, of: 2 });
    expect(seriesPosition('sat', cancelled)).toBeNull();
  });
});
