import { describe, expect, it } from 'vitest';
import { formatDuration, formatMoney, shiftEarnings, totalBreakMinutes } from '../earnings';
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
    const short = {
      ...base,
      endsAt: '2026-06-14T20:00:00Z',
      checkOutAt: '2026-06-14T18:00:00Z',
    };
    const e = shiftEarnings(short)!;
    expect(e.workedMin).toBe(120);
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
