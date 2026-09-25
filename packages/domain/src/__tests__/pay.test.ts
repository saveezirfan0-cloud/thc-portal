import { describe, expect, it } from 'vitest';
import vectors from '../pay.vectors.json' with { type: 'json' };
import {
  HOLIDAY_RATE,
  addMinutes,
  checkInDecision,
  checkOutDecision,
  effectiveEnd,
  effectiveStart,
  isNoCheckOut,
  pay,
  payableMinutes,
  showRate,
  turnedAwayMinutes,
} from '../pay';
import type { NoCheckOutState, ShowRateBooking } from '../pay';

/**
 * The §5.1–5.2 vectors, run against the TypeScript half of the contract.
 * Postgres runs the same cases against check_in_decision / check_out_decision /
 * payable_minutes / turned_away_minutes in supabase/tests/070_check_in_out.sql,
 * so neither implementation can drift without the other failing.
 */

/** 14:00–22:00 UK on 14 June 2026 (BST). Offsets are minutes from the start. */
const BASE = new Date('2026-06-14T13:00:00Z');
const at = (minFromStart: number) => addMinutes(BASE, minFromStart);
const shiftOf = (shiftMin: number) => ({ startsAt: BASE, endsAt: at(shiftMin) });

interface VectorGroup<I> {
  defaults?: Partial<I>;
  cases: { name: string; input: Partial<I>; expect: Record<string, unknown> }[];
}

/** Every case carries a complete input: the group's defaults, then its own keys. */
function merged<I>(group: unknown): { name: string; input: I; expect: Record<string, unknown> }[] {
  const g = group as VectorGroup<I>;
  return g.cases.map((c) => ({ ...c, input: { ...(g.defaults ?? {}), ...c.input } as I }));
}

interface CheckInVector {
  shiftMin: number;
  atMinFromStart: number;
  insideGeofence: boolean;
  confirmedMinFromStart: number | null;
  slotsFilled: number;
  headcount: number;
  strictBuffer: boolean;
}

interface CheckOutVector {
  shiftMin: number;
  atMinFromStart: number;
  insideGeofence: boolean;
  checkInMinFromStart: number;
  lastOnSiteMinFromStart: number | null;
}

interface PayVector {
  shiftMin: number;
  checkInMinFromStart: number;
  checkOutMinFromStart: number | null;
  unpaidBreakMin: number;
  leftEarlyViolation: boolean;
  noCheckOut: NoCheckOutState;
}

interface TurnAwayVector {
  shiftMin: number;
  attemptMinFromStart: number;
}

describe('§5.1 check-in (shared vectors)', () => {
  it.each(merged<CheckInVector>(vectors.checkIn))('$name', ({ input, expect: expected }) => {
    expect(
      checkInDecision({
        shift: shiftOf(input.shiftMin),
        at: at(input.atMinFromStart),
        insideGeofence: input.insideGeofence,
        confirmedAt: input.confirmedMinFromStart === null ? null : at(input.confirmedMinFromStart),
        slotsFilled: input.slotsFilled,
        headcount: input.headcount,
        strictBuffer: input.strictBuffer,
      }),
    ).toEqual(expected);
  });
});

describe('§5.1 check-out (shared vectors)', () => {
  it.each(merged<CheckOutVector>(vectors.checkOut))('$name', ({ input, expect: expected }) => {
    const result = checkOutDecision({
      shift: shiftOf(input.shiftMin),
      at: at(input.atMinFromStart),
      insideGeofence: input.insideGeofence,
      checkInAt: at(input.checkInMinFromStart),
      lastOnSiteAt: input.lastOnSiteMinFromStart === null ? null : at(input.lastOnSiteMinFromStart),
    });

    // The vectors speak in offsets; the decision returns the instant it records.
    const { recordedAt, ...rest } = result;
    expect({
      ...rest,
      recordedMinFromStart:
        recordedAt === null ? null : Math.round((recordedAt.getTime() - BASE.getTime()) / 60_000),
    }).toEqual(expected);
  });
});

describe('RULE-01/02/14 pay window (shared vectors)', () => {
  it.each(merged<PayVector>(vectors.pay))('$name', ({ input, expect: expected }) => {
    expect(
      payableMinutes({
        shift: shiftOf(input.shiftMin),
        checkInAt: at(input.checkInMinFromStart),
        checkOutAt: input.checkOutMinFromStart === null ? null : at(input.checkOutMinFromStart),
        unpaidBreakMin: input.unpaidBreakMin,
        leftEarlyViolation: input.leftEarlyViolation,
        noCheckOut: input.noCheckOut,
      }),
    ).toEqual(expected);
  });
});

describe('RULE-15 buffer turn-away (shared vectors)', () => {
  it.each(merged<TurnAwayVector>(vectors.turnAway))('$name', ({ input, expect: expected }) => {
    expect(turnedAwayMinutes(shiftOf(input.shiftMin), at(input.attemptMinFromStart))).toBe(
      expected.payMin,
    );
  });
});

// The rules above are the contract. What follows is the reasoning behind the
// pieces the vectors exercise only indirectly.

describe('the pay window itself (RULE-01)', () => {
  const shift = shiftOf(480);

  it('starts the paid clock at the scheduled start for an early or in-grace arrival', () => {
    expect(effectiveStart(shift, at(-30))).toEqual(BASE);
    expect(effectiveStart(shift, at(0))).toEqual(BASE);
    expect(effectiveStart(shift, at(29))).toEqual(BASE);
  });

  it('starts it at the actual arrival once the grace has elapsed', () => {
    expect(effectiveStart(shift, at(30))).toEqual(at(30));
    expect(effectiveStart(shift, at(45))).toEqual(at(45));
  });

  it('never runs the paid clock past the scheduled end', () => {
    expect(effectiveEnd(shift, at(481))).toEqual(shift.endsAt);
    expect(effectiveEnd(shift, at(660))).toEqual(shift.endsAt);
    expect(effectiveEnd(shift, at(420))).toEqual(at(420));
  });
});

describe('RULE-02 no check-out', () => {
  const shift = shiftOf(480);

  it('takes over exactly four hours after the scheduled end, not before', () => {
    expect(isNoCheckOut(shift, at(719))).toBe(false);
    expect(isNoCheckOut(shift, at(720))).toBe(true);
  });
});

describe('holiday pay (§9.8)', () => {
  it('is broken out at 12.07% and never blended', () => {
    expect(HOLIDAY_RATE).toBe(0.1207);
    const money = pay(480, 1400);
    expect(money.basePence).toBe(11200);
    expect(money.holidayPence).toBe(Math.round(11200 * 0.1207));
    // The two are returned separately so nothing can silently add them.
    expect(money).not.toHaveProperty('totalPence');
  });
});

describe('§6 the show-rate (BG-03, RULE-14, §9.5)', () => {
  // The same cases, by name, run against staff_show_rate() in
  // supabase/tests/596_show_rate_derived.sql.
  for (const c of merged<{ bookings: ShowRateBooking[] }>(vectors.showRate)) {
    it(c.name, () => {
      expect(showRate(c.input.bookings)).toBe(c.expect.rate);
    });
  }

  it('has every case the SQL side replays', () => {
    expect(vectors.showRate.cases.length).toBe(11);
  });
});
