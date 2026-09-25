import { describe, expect, it } from 'vitest';
import type { StaffBooking } from '@thc/domain';
import {
  READY_DEADLINE_LINE,
  cancelUntilLine,
  checkInCaption,
  describeReconfirm,
  limitSentence,
  myShifts,
  outwardCode,
  shiftsBadge,
  venueLine,
} from '../list';

/** 17:00–23:30 UK on Sunday 14 June 2026 (BST). */
const START = new Date('2026-06-14T16:00:00Z');
const END = new Date('2026-06-14T22:30:00Z');
const NOW = new Date('2026-06-14T13:32:00Z'); // the wireframe's 14:32 UK, on the day

const booking = (over: Partial<StaffBooking> = {}): StaffBooking => ({
  status: 'confirmed',
  startsAt: START,
  endsAt: END,
  dayBeforeConfirmedAt: new Date('2026-06-13T09:00:00Z'),
  onDayConfirmedAt: null,
  reconfirmRequired: false,
  cancelCause: null,
  eventCancelledAt: null,
  noCheckoutOpen: false,
  ...over,
});

const daysFrom = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);

describe('§10.4 which bookings My shifts lists', () => {
  it('lists today and the upcoming, not the history', () => {
    const today = booking();
    const upcoming = booking({ startsAt: daysFrom(START, 3), endsAt: daysFrom(END, 3) });
    const workedYesterday = booking({
      status: 'worked',
      startsAt: daysFrom(START, -1),
      endsAt: daysFrom(END, -1),
    });
    const noShowedLastWeek = booking({
      startsAt: daysFrom(START, -7),
      endsAt: daysFrom(END, -7),
    });
    expect(myShifts([workedYesterday, noShowedLastWeek, today, upcoming], NOW)).toEqual([
      today,
      upcoming,
    ]);
  });

  it('keeps the No check-out booking until a manager resolves it (§3.6, RULE-02)', () => {
    const open = booking({
      status: 'worked',
      startsAt: daysFrom(START, -1),
      endsAt: daysFrom(END, -1),
      noCheckoutOpen: true,
    });
    expect(myShifts([open], NOW)).toEqual([open]);
  });

  it('lists neither invitations nor cancelled bookings', () => {
    expect(
      myShifts([booking({ status: 'invited' }), booking({ status: 'cancelled' })], NOW),
    ).toEqual([]);
  });
});

describe('§10.4 the Shifts badge is the needs-action count', () => {
  it('counts the stage-2 and changed-time cards, not every booked shift', () => {
    const tomorrow = daysFrom(START, 1);
    const needsReady = booking({
      startsAt: tomorrow,
      endsAt: daysFrom(END, 1),
      dayBeforeConfirmedAt: null,
    });
    const changed = booking({
      startsAt: daysFrom(START, 6),
      endsAt: daysFrom(END, 6),
      reconfirmRequired: true,
    });
    const today = booking();
    const plain = booking({ startsAt: daysFrom(START, 9), endsAt: daysFrom(END, 9) });
    // Four cards listed, two need action — the wireframe's "3!" is that count.
    expect(myShifts([needsReady, changed, today, plain], NOW)).toHaveLength(4);
    expect(shiftsBadge([needsReady, changed, today, plain], NOW)).toBe(2);
  });

  it('is zero with nothing to press', () => {
    expect(shiftsBadge([booking()], NOW)).toBe(0);
  });
});

describe('§3.5 the "Time changed" line', () => {
  it('turns the stored field codes into the wireframe sentence', () => {
    expect(describeReconfirm('starts_at')).toBe('Start time moved by the office');
    expect(describeReconfirm('ends_at')).toBe('End time moved by the office');
    expect(describeReconfirm('starts_at,ends_at')).toBe('Start and end time moved by the office');
    expect(describeReconfirm('dress_code')).toBe('Dress code changed by the office');
    expect(describeReconfirm('venue_address')).toBe('Venue changed by the office');
    expect(describeReconfirm('event_date')).toBe('Date moved by the office');
    expect(describeReconfirm('starts_at,dress_code')).toBe(
      'Start time moved by the office · Dress code changed by the office',
    );
  });

  it('keeps the previous window when the office records it', () => {
    expect(describeReconfirm('starts_at (was 12:00–00:30)')).toBe(
      'Start time moved by the office (was 12:00–00:30)',
    );
  });

  it('never shows a column name, and passes a real sentence through', () => {
    for (const code of ['starts_at', 'ends_at', 'dress_code', 'venue_address', 'event_date']) {
      expect(describeReconfirm(code)).not.toContain('_');
    }
    expect(describeReconfirm('Briefing moved to 15:30')).toBe('Briefing moved to 15:30');
    expect(describeReconfirm(null)).toBe('The office changed this shift.');
    expect(describeReconfirm('')).toBe('The office changed this shift.');
  });
});

describe('§10.4 the open-shift venue line', () => {
  it('appends the outward postcode: "Hurst Manor, RH17"', () => {
    expect(outwardCode('Hurst Manor, Cuckfield RH17 5LB')).toBe('RH17');
    expect(outwardCode('53 Park Lane, London W1K 1QA')).toBe('W1K');
    expect(outwardCode('10 Godliman St, EC4V 5AJ')).toBe('EC4V');
    expect(outwardCode('Royal Victoria Dock, E16 1XL')).toBe('E16');
    expect(outwardCode('Somewhere, SW1A 1AA ')).toBe('SW1A');
    expect(venueLine('Hurst Manor', 'Cuckfield RH17 5LB')).toBe('Hurst Manor, RH17');
  });

  it('prints the name alone when the address carries no postcode', () => {
    expect(outwardCode('The Barn, Long Lane')).toBeNull();
    expect(outwardCode(null)).toBeNull();
    expect(venueLine('The Barn', 'Long Lane')).toBe('The Barn');
  });
});

describe('RULE-04 "Cancel available until"', () => {
  it('reads as the wireframe for a UK viewer', () => {
    // 72 h before Sunday 14 June 17:00 UK is Thursday 11 June 17:00 UK.
    expect(cancelUntilLine(START, 'Europe/London')).toEqual({
      primary: 'Cancel available until Thu 11, 17:00 (72 h before start)',
    });
  });

  it('adds the "your time" line only for a viewer outside the UK (§1.8)', () => {
    const line = cancelUntilLine(START, 'Europe/Berlin');
    expect(line.primary).toBe('Cancel available until Thu 11, 17:00 (72 h before start)');
    expect(line.secondary).toBe('Thu 11, 18:00 your time');
  });
});

describe('§3.5 stage 2 deadline copy', () => {
  it('says "12:00 today", because the card only ever shows on the day before', () => {
    expect(READY_DEADLINE_LINE.deadline).toBe('12:00 today (UK time)');
  });
});

describe('RULE-20 the Limit reached sentence', () => {
  it('is the wireframe sentence, with the basis and date when the row carries them', () => {
    expect(limitSentence({ shiftHours: 8, capHours: 20 })).toBe(
      'This 8 h shift would take you over your 20 h/week limit',
    );
    expect(limitSentence({ shiftHours: 8, capHours: 20, basis: 'term', until: '2026-12-13' })).toBe(
      'This 8 h shift would take you over your 20 h/week limit (term time until 13.12.2026)',
    );
    expect(limitSentence({ shiftHours: 6.5, capHours: 48, basis: 'holiday' })).toBe(
      'This 6.5 h shift would take you over your 48 h/week limit (university holiday)',
    );
  });

  it('has nothing to say where there is no ceiling', () => {
    expect(limitSentence({ shiftHours: 8, capHours: null })).toBeNull();
  });
});

describe('§10.4 the today card caption', () => {
  it('counts down to the start once the window is open', () => {
    expect(checkInCaption(START, new Date('2026-06-14T15:32:00Z'))).toBe(
      'Check-in opens now · shift starts in 28 min',
    );
    expect(checkInCaption(START, new Date('2026-06-14T15:30:00Z'))).toBe(
      'Check-in opens now · shift starts in 30 min',
    );
  });

  it('names the opening time, in UK time, before the 30-minute window (§5.1)', () => {
    expect(checkInCaption(START, NOW)).toBe(
      'Check-in opens at 16:30 UK time · shift starts in 2 h 28 m',
    );
  });

  it('says the shift has started once it has', () => {
    expect(checkInCaption(START, new Date('2026-06-14T16:05:00Z'))).toBe(
      'Check-in opens now · shift has started',
    );
  });
});
