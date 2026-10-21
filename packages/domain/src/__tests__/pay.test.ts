import { describe, expect, it } from 'vitest';
import vectors from '../pay.vectors.json' with { type: 'json' };
import {
  HOLIDAY_RATE,
  addMinutes,
  checkInDecision,
  checkOutDecision,
  effectiveEnd,
  effectiveStart,
  isLateCheckOut,
  isNoCheckOut,
  pay,
  payableMinutes,
  showRate,
  turnedAwayMinutes,
  unpaidBreakMinutes,
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

interface BreakVector {
  shiftMin: number;
  checkInMinFromStart: number;
  finishMinFromStart: number;
  breaks: [number, number | null][];
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

describe('§5.2b breaks inside the paid window (shared vectors, D49)', () => {
  it.each(merged<BreakVector>(vectors.breaks))('$name', ({ input, expect: expected }) => {
    expect(
      unpaidBreakMinutes(
        {
          shift: shiftOf(input.shiftMin),
          checkInAt: at(input.checkInMinFromStart),
          finishAt: at(input.finishMinFromStart),
        },
        input.breaks.map(([s, e]) => ({ startedAt: at(s), endedAt: e === null ? null : at(e) })),
      ),
    ).toBe(expected.unpaidBreakMin);
  });
});

// The rules above are the contract. What follows is the reasoning behind the
// pieces the vectors exercise only indirectly.

describe('the pay window itself (RULE-01)', () => {
  const shift = shiftOf(480);

  it('starts the paid clock at the scheduled start for an early or on-time arrival', () => {
    expect(effectiveStart(shift, at(-30))).toEqual(BASE);
    expect(effectiveStart(shift, at(0))).toEqual(BASE);
  });

  it('starts it at the actual arrival for any late arrival, in the grace or past it (ADR-0095)', () => {
    expect(effectiveStart(shift, at(1))).toEqual(at(1));
    expect(effectiveStart(shift, at(29))).toEqual(at(29));
    expect(effectiveStart(shift, at(30))).toEqual(at(30));
    expect(effectiveStart(shift, at(45))).toEqual(at(45));
  });

  it('stops the paid clock at the scheduled end inside the 15-minute check-out grace', () => {
    expect(effectiveEnd(shift, at(481))).toEqual(shift.endsAt);
    expect(effectiveEnd(shift, at(495))).toEqual(shift.endsAt);
    expect(effectiveEnd(shift, at(420))).toEqual(at(420));
  });

  it('runs it to the actual finish more than 15 minutes past the end (ADR-0184)', () => {
    expect(effectiveEnd(shift, at(496))).toEqual(at(496));
    expect(effectiveEnd(shift, at(660))).toEqual(at(660));
    expect(isLateCheckOut(shift, at(495))).toBe(false);
    expect(isLateCheckOut(shift, at(496))).toBe(true);
  });
});

/**
 * ADR-0184, THC 21.10.2026, in THC's own times: a 16:00 finish. "The 15
 * minute period between 16:00 and 16:15 (pay and charge is to 16:00 is
 * correct)"; "for the sign out between 16:15 and 20:00 we need to be able
 * to pay and charge for the time the staff actually finished their shift."
 */
describe('ADR-0184 · a sign-out past end+15 is paid to the actual finish', () => {
  const start = new Date('2026-10-21T11:00:00Z'); // 12:00 UK (BST)
  const end = new Date('2026-10-21T15:00:00Z'); // 16:00 UK
  const shift = { startsAt: start, endsAt: end };
  const uk = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return new Date(Date.UTC(2026, 9, 21, h! - 1, m!));
  };
  const settle = (out: string, extra: Partial<Parameters<typeof payableMinutes>[0]> = {}) =>
    payableMinutes({ shift, checkInAt: start, checkOutAt: uk(out), ...extra });

  it('16:10 and 16:15 are paid and charged to 16:00', () => {
    expect(settle('16:10')).toMatchObject({
      payableMin: 240,
      overrunMin: 0,
      lateCheckOutFlag: false,
    });
    expect(settle('16:15')).toMatchObject({
      payableMin: 240,
      overrunMin: 0,
      lateCheckOutFlag: false,
    });
  });

  it('17:15 is paid and charged to 17:15, the 75 minutes past 16:00 being the overrun', () => {
    expect(settle('17:15')).toMatchObject({
      status: 'settled',
      payableMin: 315,
      workedMin: 315,
      overrunMin: 75,
      lateCheckOutFlag: true,
    });
  });

  it('20:00 is paid to 20:00', () => {
    expect(settle('20:00')).toMatchObject({ payableMin: 480, overrunMin: 240 });
  });

  it('a manager-entered finish of 18:00 resolving a No check-out is paid to 18:00', () => {
    expect(settle('18:00', { noCheckOut: 'resolved' })).toMatchObject({
      payableMin: 360,
      overrunMin: 120,
    });
  });

  it('unpaid breaks come off the main part, so the overrun line stays the clock past 16:00', () => {
    const r = settle('17:15', { unpaidBreakMin: 30 });
    expect(r).toMatchObject({ payableMin: 285, overrunMin: 75 });
    expect(r.payableMin! - r.overrunMin!).toBe(210);
  });

  it('pays the same hourly rate on the overrun: one figure, holiday broken out', () => {
    const r = settle('17:15');
    const money = pay(r.payableMin!, 1400);
    expect(money.basePence).toBe(Math.round((315 / 60) * 1400));
    expect(money.holidayPence).toBe(Math.round(money.basePence * HOLIDAY_RATE));
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
    expect(vectors.showRate.cases.length).toBe(12);
  });
});
