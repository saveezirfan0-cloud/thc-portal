import { describe, expect, it } from 'vitest';
import {
  HOLIDAY_RATE,
  effectiveEnd,
  effectiveStart,
  isNoCheckOut,
  pay,
  payableMinutes,
  turnedAwayMinutes,
} from '../pay';

// A 14:00–22:00 role section on 14 June 2026 (BST, UTC+1).
const shift = {
  startsAt: new Date('2026-06-14T13:00:00Z'),
  endsAt: new Date('2026-06-14T21:00:00Z'),
};
const at = (uk: string) => new Date(`2026-06-14T${uk}:00Z`);

describe('RULE-01 pay window', () => {
  it('does not pay for arriving early', () => {
    // 13:30 UK for a 14:00 start.
    expect(effectiveStart(shift, at('12:30'))).toEqual(shift.startsAt);
    const result = payableMinutes({ shift, checkInAt: at('12:30'), checkOutAt: at('21:00') });
    expect(result.payableMin).toBe(8 * 60);
  });

  it('pays from the scheduled start when check-in is inside the 30-minute grace', () => {
    // 14:20 UK, 20 minutes late but inside grace.
    expect(effectiveStart(shift, at('13:20'))).toEqual(shift.startsAt);
    const result = payableMinutes({ shift, checkInAt: at('13:20'), checkOutAt: at('21:00') });
    expect(result.payableMin).toBe(8 * 60);
  });

  it('pays from the actual time when check-in is past the grace', () => {
    // 14:45 UK, reclassified from No-show to Late via "Get back".
    expect(effectiveStart(shift, at('13:45'))).toEqual(at('13:45'));
    const result = payableMinutes({ shift, checkInAt: at('13:45'), checkOutAt: at('21:00') });
    expect(result.payableMin).toBe(7 * 60 + 15);
  });

  it('deducts leaving early', () => {
    const result = payableMinutes({ shift, checkInAt: at('13:00'), checkOutAt: at('20:00') });
    expect(result.workedMin).toBe(7 * 60);
  });

  it('never pays past the scheduled end, however late the check-out', () => {
    expect(effectiveEnd(shift, at('21:10'))).toEqual(shift.endsAt);
    expect(effectiveEnd(shift, at('23:30'))).toEqual(shift.endsAt);

    const justLate = payableMinutes({ shift, checkInAt: at('13:00'), checkOutAt: at('21:10') });
    const veryLate = payableMinutes({ shift, checkInAt: at('13:00'), checkOutAt: at('23:30') });
    expect(justLate.payableMin).toBe(8 * 60);
    expect(veryLate.payableMin).toBe(8 * 60);
  });

  it('flags a check-out past 15 minutes without changing the money', () => {
    const inside = payableMinutes({ shift, checkInAt: at('13:00'), checkOutAt: at('21:10') });
    const outside = payableMinutes({ shift, checkInAt: at('13:00'), checkOutAt: at('21:40') });
    expect(inside.lateCheckOutFlag).toBe(false);
    expect(outside.lateCheckOutFlag).toBe(true);
    expect(outside.payableMin).toBe(inside.payableMin);
  });

  it('deducts unpaid breaks', () => {
    const result = payableMinutes({
      shift,
      checkInAt: at('13:00'),
      checkOutAt: at('21:00'),
      unpaidBreakMin: 30,
    });
    expect(result.workedMin).toBe(7 * 60 + 30);
  });
});

describe('RULE-02 no check-out', () => {
  it('leaves the payable time undetermined rather than defaulting to the end', () => {
    const result = payableMinutes({ shift, checkInAt: at('13:00'), checkOutAt: null });
    expect(result.status).toBe('undetermined');
    expect(result.payableMin).toBeNull();
  });

  it('takes over four hours after the scheduled end, not before', () => {
    expect(isNoCheckOut(shift, at('23:59'))).toBe(false);
    expect(isNoCheckOut(shift, new Date('2026-06-15T01:00:00Z'))).toBe(true);
  });

  it('settles once a manager supplies the finish time', () => {
    const resolved = payableMinutes({ shift, checkInAt: at('13:00'), checkOutAt: at('20:30') });
    expect(resolved.status).toBe('settled');
    // 14:00 to 21:30 UK is 7h30m, comfortably above the four-hour floor.
    expect(resolved.payableMin).toBe(450);
  });
});

// The 4-hour floor must never manufacture money out of a window nobody
// worked. Each of these used to come back `settled` with payableMin 240.
describe('RULE-02 / RULE-14 an empty window is undetermined, never floored', () => {
  it('a check-out on the check-in timestamp is a No check-out, not a zero-length shift', () => {
    const result = payableMinutes({ shift, checkInAt: at('13:00'), checkOutAt: at('13:00') });
    expect(result.status).toBe('undetermined');
    expect(result.payableMin).toBeNull();
    expect(result.floorApplied).toBe(false);
  });

  it('a check-out before the check-in pays nothing rather than four hours', () => {
    const result = payableMinutes({ shift, checkInAt: at('17:00'), checkOutAt: at('16:00') });
    expect(result.status).toBe('undetermined');
    expect(result.payableMin).toBeNull();
  });

  it('a check-in after the scheduled end intersects nothing', () => {
    // 22:30 UK on a section that ended at 22:00: RULE-14's floor is for
    // "a worker who actually checked in and worked the shift".
    const result = payableMinutes({ shift, checkInAt: at('21:30'), checkOutAt: at('22:00') });
    expect(result.status).toBe('undetermined');
    expect(result.payableMin).toBeNull();
  });

  it('still floors a genuinely short shift', () => {
    // The guard must not swallow RULE-14: five worked minutes is four paid hours.
    const result = payableMinutes({ shift, checkInAt: at('13:00'), checkOutAt: at('13:05') });
    expect(result.status).toBe('settled');
    expect(result.workedMin).toBe(5);
    expect(result.payableMin).toBe(240);
    expect(result.floorApplied).toBe(true);
  });
});

describe('RULE-14 four-hour minimum', () => {
  it('lifts a short shift to four hours', () => {
    const short = {
      startsAt: new Date('2026-06-14T13:00:00Z'),
      endsAt: new Date('2026-06-14T15:00:00Z'),
    };
    const result = payableMinutes({ shift: short, checkInAt: at('13:00'), checkOutAt: at('15:00') });
    expect(result.workedMin).toBe(120);
    expect(result.payableMin).toBe(240);
    expect(result.floorApplied).toBe(true);
  });

  it('is removed by a Left early violation', () => {
    const short = {
      startsAt: new Date('2026-06-14T13:00:00Z'),
      endsAt: new Date('2026-06-14T15:00:00Z'),
    };
    const result = payableMinutes({
      shift: short,
      checkInAt: at('13:00'),
      checkOutAt: at('14:00'),
      leftEarlyViolation: true,
    });
    expect(result.payableMin).toBe(60);
    expect(result.floorApplied).toBe(false);
  });

  it('does not inflate a shift already longer than four hours', () => {
    const result = payableMinutes({ shift, checkInAt: at('13:00'), checkOutAt: at('21:00') });
    expect(result.floorApplied).toBe(false);
  });
});

describe('RULE-15 buffer turn-away', () => {
  it('pays a fixed four hours when the attempt was on time', () => {
    expect(turnedAwayMinutes(shift, at('13:20'))).toBe(240);
  });

  it('pays nothing when the attempt was late', () => {
    expect(turnedAwayMinutes(shift, at('13:45'))).toBe(0);
  });

  it('is fixed regardless of how long the shift was', () => {
    const long = {
      startsAt: new Date('2026-06-14T13:00:00Z'),
      endsAt: new Date('2026-06-14T23:00:00Z'),
    };
    expect(turnedAwayMinutes(long, at('13:00'))).toBe(240);
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
