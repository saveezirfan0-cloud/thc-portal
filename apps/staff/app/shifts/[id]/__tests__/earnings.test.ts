import { describe, expect, it } from 'vitest';
import {
  breakMinutes,
  chargeableSeconds,
  formatClock,
  formatDuration,
  formatMoney,
  openBreakSeconds,
  shiftEarnings,
  totalBreakMinutes,
} from '../earnings';
import type { ShiftDetail } from '../types';

const base: ShiftDetail = {
  bookingId: 'b',
  status: 'worked',
  confirmedAt: '2026-06-12T09:00:00Z',
  cancelCause: null,
  eventCancelledAt: null,
  noCheckoutOpen: false,
  leftEarly: false,
  eventDate: '2026-06-14',
  eventTitle: 'Gala Dinner',
  venueName: 'Leonardo Royal',
  venueAddress: '10 Godliman St',
  onsiteContact: null,
  notes: null,
  dressCode: null,
  roleName: 'Waiting Staff',
  startsAt: '2026-06-14T16:00:00Z',
  endsAt: '2026-06-14T22:30:00Z',
  payRate: 14,
  venueLat: 51.5,
  venueLng: -0.1,
  geofenceRadiusM: 150,
  breaksLogged: true,
  checkInAt: '2026-06-14T15:52:00Z',
  checkOutAt: '2026-06-14T22:32:00Z',
  noCheckOut: 'none',
  turnedAwayAt: null,
  breaks: [],
};

describe('§5.1 the check-out confirmation', () => {
  it('pays the scheduled window when the worker arrived early and left on time', () => {
    const e = shiftEarnings(base)!;
    expect(e.payableMin).toBe(390); // 17:00–23:30
    expect(formatMoney(e.totalPence)).toBe('£91.00');
    // RULE-01: the "Worked" row is the PAID window, not the press times.
    expect(e.paidFrom.toISOString()).toBe('2026-06-14T16:00:00.000Z');
    expect(e.paidTo.toISOString()).toBe('2026-06-14T22:30:00.000Z');
  });

  it('deducts an unpaid break', () => {
    const e = shiftEarnings({
      ...base,
      breaks: [{ id: '1', startedAt: '2026-06-14T19:00:00Z', endedAt: '2026-06-14T19:20:00Z' }],
    })!;
    expect(e.unpaidBreakMin).toBe(20);
    expect(e.payableMin).toBe(370);
  });

  it('holds no holiday figure at all — the worker sees the base rate only (§9.8)', () => {
    const e = shiftEarnings(base)!;
    expect(e).not.toHaveProperty('holidayPence');
    expect(e.hourlyRatePence).toBe(1400);
  });

  it('shows nothing until there is a finish time — RULE-02 has no default', () => {
    expect(shiftEarnings({ ...base, checkOutAt: null })).toBeNull();
  });

  it('lifts a short shift to the four-hour minimum and says so (RULE-14)', () => {
    const short = {
      ...base,
      endsAt: '2026-06-14T20:00:00Z',
      checkOutAt: '2026-06-14T18:00:00Z',
    };
    const e = shiftEarnings(short)!;
    expect(e.workedMin).toBe(120);
    expect(e.payableMin).toBe(240);
    expect(e.floorApplied).toBe(true);
    // A worker who left at 19:00 UK reads "17:00 – 19:00", not the scheduled end.
    expect(e.paidTo.toISOString()).toBe('2026-06-14T18:00:00.000Z');
  });

  /**
   * RULE-14: "A logged 'Left early' Violation always blocks the floor,
   * resolved or not — the normal RULE-01 pay-window deduction applies
   * instead, no minimum." The screen used to floor it anyway, showing a
   * four-hour total that `payable_shifts_v` would never export.
   */
  it('does not floor a shift with a Left-early violation on file', () => {
    const short = {
      ...base,
      leftEarly: true,
      endsAt: '2026-06-14T20:00:00Z',
      checkOutAt: '2026-06-14T18:00:00Z',
    };
    const e = shiftEarnings(short)!;
    expect(e.payableMin).toBe(120);
    expect(e.floorApplied).toBe(false);
  });

  it('shows no figure while a No check-out violation is unresolved, and floors again once resolved', () => {
    const open = { ...base, checkOutAt: base.checkInAt, noCheckOut: 'unresolved' as const };
    expect(shiftEarnings(open)).toBeNull();
    const resolved = {
      ...base,
      noCheckOut: 'resolved' as const,
      endsAt: '2026-06-14T20:00:00Z',
      checkOutAt: '2026-06-14T18:00:00Z',
    };
    expect(shiftEarnings(resolved)!.floorApplied).toBe(true);
  });

  it('ignores breaks entirely where the client pays for them (§5.2b)', () => {
    const paid = {
      ...base,
      breaksLogged: false,
      breaks: [{ id: '1', startedAt: '2026-06-14T19:00:00Z', endedAt: '2026-06-14T19:40:00Z' }],
    };
    expect(shiftEarnings(paid)!.unpaidBreakMin).toBe(0);
  });
});

describe('the running break total', () => {
  it('runs an unfinished break to now, so the chargeable timer keeps falling', () => {
    const now = new Date('2026-06-14T19:30:00Z');
    const running = {
      ...base,
      checkOutAt: null,
      breaks: [{ id: '1', startedAt: '2026-06-14T19:00:00Z', endedAt: null }],
    };
    expect(totalBreakMinutes(running, now)).toBe(30);
    expect(openBreakSeconds(running, now)).toBe(1800);
  });
});

/**
 * RULE-01 on the live counter (wireframe (d): "02:14:36" at 19:14, "Checked
 * in 16:52 · paid from 17:00"). The chargeable clock starts at the PAID
 * start; the old counter ran from the press, so an early arrival watched
 * unpaid minutes counted as chargeable.
 */
describe('§5.1 the chargeable counter', () => {
  const on = { ...base, checkOutAt: null };

  it('starts at the scheduled start for an early check-in', () => {
    // 16:52 check-in, 17:00 start, 19:14:36 now → 2:14:36 from 17:00.
    const now = new Date('2026-06-14T18:14:36Z');
    expect(chargeableSeconds({ ...on, checkInAt: '2026-06-14T15:52:00Z' }, now)).toBe(
      2 * 3600 + 14 * 60 + 36,
    );
    expect(formatClock(chargeableSeconds({ ...on, checkInAt: '2026-06-14T15:52:00Z' }, now))).toBe(
      '02:14:36',
    );
  });

  it('starts at the scheduled start for a check-in inside the grace', () => {
    const now = new Date('2026-06-14T17:00:00Z');
    expect(chargeableSeconds({ ...on, checkInAt: '2026-06-14T16:10:00Z' }, now)).toBe(3600);
  });

  it('starts at the press for a late check-in past the grace', () => {
    const now = new Date('2026-06-14T17:00:00Z');
    expect(chargeableSeconds({ ...on, checkInAt: '2026-06-14T16:40:00Z' }, now)).toBe(1200);
  });

  it('reads zero, never negative, before the paid start', () => {
    const now = new Date('2026-06-14T15:55:00Z');
    expect(chargeableSeconds({ ...on, checkInAt: '2026-06-14T15:52:00Z' }, now)).toBe(0);
  });

  it('pauses while on a break and deducts finished ones', () => {
    const now = new Date('2026-06-14T19:39:00Z');
    const withBreak = {
      ...on,
      checkInAt: '2026-06-14T15:52:00Z',
      breaks: [{ id: '1', startedAt: '2026-06-14T19:31:00Z', endedAt: null }],
    };
    // 16:00Z → 19:39Z is 3:39:00; 8 minutes on break → 3:31:00, and it holds
    // there while the break runs (wireframe (f) "Chargeable time · paused").
    expect(chargeableSeconds(withBreak, now)).toBe(3 * 3600 + 31 * 60);
    const later = new Date('2026-06-14T19:40:00Z');
    expect(chargeableSeconds(withBreak, later)).toBe(3 * 3600 + 31 * 60);
  });

  it('keeps running past the scheduled end — the sub-line says what is paid (wireframe (h))', () => {
    const now = new Date('2026-06-14T22:31:02Z');
    const done = {
      ...on,
      checkInAt: '2026-06-14T15:52:00Z',
      breaks: [{ id: '1', startedAt: '2026-06-14T19:31:00Z', endedAt: '2026-06-14T19:51:00Z' }],
    };
    expect(formatClock(chargeableSeconds(done, now))).toBe('06:11:02');
    expect(breakMinutes('2026-06-14T19:31:00Z', '2026-06-14T19:51:00Z')).toBe(20);
  });
});

describe('formatting', () => {
  it('reads as hours and minutes', () => {
    expect(formatDuration(390)).toBe('6 h 30 m');
    expect(formatDuration(240)).toBe('4 h');
    expect(formatDuration(45)).toBe('45 m');
  });

  it('formats the counter as HH:MM:SS', () => {
    expect(formatClock(0)).toBe('00:00:00');
    expect(formatClock(3661)).toBe('01:01:01');
    expect(formatClock(-5)).toBe('00:00:00');
  });
});
