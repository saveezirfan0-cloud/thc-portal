import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  formatMoney,
  leftEarly,
  paidBreakMinutes,
  shiftEarnings,
  totalBreakMinutes,
} from '../earnings';
import type { ShiftDetail } from '../types';

const base: ShiftDetail = {
  bookingId: 'b',
  status: 'worked',
  confirmedAt: '2026-06-12T09:00:00Z',
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
  breaks: [],
  eventDate: '2026-06-14',
  eventCancelledAt: null,
  cancelCause: null,
  noCheckoutOpen: false,
  turnedAwayAt: null,
  turnedAwayPayMin: null,
};

describe('§5.1 the check-out confirmation', () => {
  it('pays the scheduled window when the worker arrived early and left on time', () => {
    const e = shiftEarnings(base)!;
    expect(e.payableMin).toBe(390); // 17:00–23:30
    expect(formatMoney(e.totalPence)).toBe('£91.00');
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
    // A three-hour section worked to the end: the floor is for exactly this.
    const short = {
      ...base,
      endsAt: '2026-06-14T19:00:00Z',
      checkOutAt: '2026-06-14T19:00:00Z',
    };
    const e = shiftEarnings(short)!;
    expect(e.workedMin).toBe(180);
    expect(e.payableMin).toBe(240);
    expect(e.floorApplied).toBe(true);
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

describe('RULE-14 as payroll applies it (audit D8)', () => {
  // 16:00–20:00 UK... in UTC: a four-hour section, left at 17:00.
  const early = {
    ...base,
    startsAt: '2026-06-14T16:00:00Z',
    endsAt: '2026-06-14T20:00:00Z',
    checkInAt: '2026-06-14T16:00:00Z',
    checkOutAt: '2026-06-14T17:00:00Z',
  };

  it('a Left early violation blocks the floor: one hour worked is one hour paid', () => {
    const e = shiftEarnings({ ...early, leftEarly: true })!;
    expect(e.payableMin).toBe(60);
    expect(e.floorApplied).toBe(false);
    expect(formatMoney(e.totalPence)).toBe('£14.00');
  });

  it('reads Left early from the check-out when the server does not say (ADR-0035)', () => {
    expect(leftEarly(early)).toBe(true);
    expect(shiftEarnings(early)!.payableMin).toBe(60);
    // Inside the 15 minutes before the end is not an early finish.
    expect(leftEarly({ ...early, checkOutAt: '2026-06-14T19:45:00Z' })).toBe(false);
  });

  it('the server’s answer wins over the reading', () => {
    expect(leftEarly({ ...early, leftEarly: false })).toBe(false);
    expect(shiftEarnings({ ...early, leftEarly: false })!.payableMin).toBe(240);
  });

  it('an open No check-out blocks the floor until a manager resolves it (RULE-02)', () => {
    const late = { ...early, checkOutAt: '2026-06-14T19:50:00Z', endsAt: '2026-06-14T20:00:00Z' };
    const threeHours = { ...late, checkInAt: '2026-06-14T16:50:00Z' };
    expect(shiftEarnings({ ...threeHours, noCheckoutOpen: true })!.payableMin).toBe(180);
    expect(shiftEarnings({ ...threeHours, noCheckoutOpen: false })!.payableMin).toBe(240);
  });
});

describe('breaks outside the paid window (§5.2b, audit D49)', () => {
  it('a break before the scheduled start is not deducted', () => {
    const shift = {
      ...base,
      breaks: [{ id: '1', startedAt: '2026-06-14T15:53:00Z', endedAt: '2026-06-14T16:10:00Z' }],
    };
    expect(paidBreakMinutes(shift)).toBe(10);
    expect(shiftEarnings(shift)!.unpaidBreakMin).toBe(10);
    expect(shiftEarnings(shift)!.payableMin).toBe(380);
  });

  it('a break after the scheduled end is not deducted either', () => {
    const shift = {
      ...base,
      checkOutAt: '2026-06-14T23:00:00Z',
      breaks: [{ id: '1', startedAt: '2026-06-14T22:35:00Z', endedAt: '2026-06-14T22:50:00Z' }],
    };
    expect(paidBreakMinutes(shift)).toBe(0);
  });

  it('the live timer still pauses for every break, clipped or not', () => {
    const now = new Date('2026-06-14T16:20:00Z');
    const running = {
      ...base,
      checkOutAt: null,
      breaks: [{ id: '1', startedAt: '2026-06-14T15:55:00Z', endedAt: null }],
    };
    expect(totalBreakMinutes(running, now)).toBe(25);
    expect(paidBreakMinutes(running, now)).toBe(20);
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
  });
});

describe('formatting', () => {
  it('reads as hours and minutes', () => {
    expect(formatDuration(390)).toBe('6 h 30 m');
    expect(formatDuration(240)).toBe('4 h');
    expect(formatDuration(45)).toBe('45 m');
  });
});
