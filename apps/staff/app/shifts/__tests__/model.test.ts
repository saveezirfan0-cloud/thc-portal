import { describe, expect, it } from 'vitest';
import type { StaffBooking } from '@thc/domain';
import { checkOutClosesAt, isCurrent, myShiftCard, myShifts, shiftGroup } from '../model';

/**
 * My shifts (§10.4, wireframes/staff/shifts.html): what is current, how it
 * is grouped, and what an ended card says. The screenshot that prompted it:
 * on Fri 25 Sep 2026 a "Confirmed · Fri 11" card from two weeks earlier
 * sorted above "Today · 06:00 – 12:00" and kept the nav badge at 3.
 */

// Friday 25 September 2026, 14:00 BST.
const NOW = new Date('2026-09-25T13:00:00Z');

type Row = StaffBooking & { id: string };

const row = (id: string, over: Partial<Row> = {}): Row => ({
  id,
  status: 'confirmed',
  startsAt: new Date('2026-09-26T17:00:00Z'),
  endsAt: new Date('2026-09-26T23:00:00Z'),
  confirmedAt: new Date('2026-09-01T09:00:00Z'),
  dayBeforeConfirmedAt: null,
  onDayConfirmedAt: null,
  reconfirmRequired: false,
  cancelCause: null,
  eventCancelledAt: null,
  noCheckoutOpen: false,
  ...over,
});

/** A UK wall-clock window on a date — BST in September, so UTC+1. */
const at = (day: string, from: string, to: string) => {
  const start = new Date(`${day}T${from}:00+01:00`);
  let end = new Date(`${day}T${to}:00+01:00`);
  if (end <= start) end = new Date(end.getTime() + 86_400_000);
  return { startsAt: start, endsAt: end };
};

describe('isCurrent — the check-out window is the cut-off (RULE-02, end + 4 h)', () => {
  const shift = row('s', at('2026-09-25', '06:00', '12:00'));

  it('keeps a shift that ended until its check-out window closes', () => {
    expect(checkOutClosesAt(shift).toISOString()).toBe('2026-09-25T15:00:00.000Z');
    expect(isCurrent(shift, new Date('2026-09-25T14:59:59Z'))).toBe(true);
  });

  it('drops it at end + 4 h exactly, the moment check-out locks', () => {
    expect(isCurrent(shift, new Date('2026-09-25T15:00:00Z'))).toBe(false);
  });

  it('never drops an unresolved No check-out — §10.4 keeps that card', () => {
    const locked = row('nc', { ...at('2026-09-11', '11:00', '16:00'), noCheckoutOpen: true });
    expect(isCurrent(locked, NOW)).toBe(true);
  });
});

describe('shiftGroup — Europe/London calendar days', () => {
  it('reads Today, Tomorrow, the rest of this Mon–Sun week, then Later', () => {
    // Fri 25: today. Sat 26: tomorrow. Sun 27: this week. Mon 28: later.
    expect(shiftGroup(at('2026-09-25', '18:00', '23:00').startsAt, NOW)).toBe('today');
    expect(shiftGroup(at('2026-09-26', '18:00', '23:00').startsAt, NOW)).toBe('tomorrow');
    expect(shiftGroup(at('2026-09-27', '18:00', '23:00').startsAt, NOW)).toBe('this_week');
    expect(shiftGroup(at('2026-09-28', '09:00', '17:00').startsAt, NOW)).toBe('later');
  });

  it('on a Monday the whole week after tomorrow is "This week"', () => {
    const monday = new Date('2026-09-21T08:00:00Z');
    expect(shiftGroup(at('2026-09-23', '09:00', '17:00').startsAt, monday)).toBe('this_week');
    expect(shiftGroup(at('2026-09-27', '09:00', '17:00').startsAt, monday)).toBe('this_week');
    expect(shiftGroup(at('2026-09-28', '09:00', '17:00').startsAt, monday)).toBe('later');
  });

  it('on a Sunday tomorrow is Monday and nothing is "This week"', () => {
    const sunday = new Date('2026-09-27T10:00:00Z');
    expect(shiftGroup(at('2026-09-28', '09:00', '17:00').startsAt, sunday)).toBe('tomorrow');
    expect(shiftGroup(at('2026-09-29', '09:00', '17:00').startsAt, sunday)).toBe('later');
  });

  it('uses the UK day, not UTC: 00:30 BST on the 26th is tomorrow at 23:00 BST on the 25th', () => {
    const lateEvening = new Date('2026-09-25T22:00:00Z'); // 23:00 BST, Fri 25
    const justAfterMidnight = new Date('2026-09-25T23:30:00Z'); // 00:30 BST, Sat 26
    expect(shiftGroup(justAfterMidnight, lateEvening)).toBe('tomorrow');
  });

  it('an overnight shift from yesterday still inside its window is "Earlier"', () => {
    expect(shiftGroup(at('2026-09-24', '18:00', '02:00').startsAt, NOW)).toBe('earlier');
  });
});

describe('myShifts — the list the screen and the badge read', () => {
  const rows = [
    row('later', at('2026-10-03', '11:00', '16:00')),
    // The screenshot's stale card: Fri 11 Sep, 11:00–16:00 UK, still `confirmed`.
    row('stale', at('2026-09-11', '11:00', '16:00')),
    row('today', at('2026-09-25', '06:00', '12:00')),
    row('tomorrow', at('2026-09-26', '18:00', '01:00')),
    row('worked-old', { ...at('2026-09-18', '17:00', '23:00'), status: 'worked' }),
    row('invite', { ...at('2026-09-27', '09:00', '17:00'), status: 'invited' }),
    row('cancelled', { ...at('2026-09-27', '09:00', '17:00'), status: 'cancelled' }),
    row('sunday', at('2026-09-27', '12:00', '18:00')),
  ];
  const list = myShifts(rows, NOW);

  it('sorts upcoming soonest first, under the headers in reading order', () => {
    expect(list.upcoming.map((g) => [g.label, g.bookings.map((b) => b.id)])).toEqual([
      ['Today', ['today']],
      ['Tomorrow', ['tomorrow']],
      ['This week', ['sunday']],
      ['Later', ['later']],
    ]);
  });

  it('moves ended shifts past their check-out window to Past, most recent first', () => {
    expect(list.past.map((b) => b.id)).toEqual(['worked-old', 'stale']);
  });

  it('counts only the upcoming list for the badge — not the past, not invitations', () => {
    expect(list.upcomingCount).toBe(4);
  });

  it('omits empty groups', () => {
    const only = myShifts([row('t', at('2026-09-25', '18:00', '23:00'))], NOW);
    expect(only.upcoming.map((g) => g.group)).toEqual(['today']);
    expect(myShifts([], NOW)).toEqual({ upcoming: [], past: [], upcomingCount: 0 });
  });
});

describe('myShiftCard — `shiftCard()` with its `past` told apart', () => {
  const today = at('2026-09-25', '06:00', '12:00');

  it('is not "Confirmed" once a confirmed shift has ended without a check-in', () => {
    expect(myShiftCard(row('c', today), NOW)).toBe('not_checked_in');
  });

  it('a worked shift inside its check-out window has "ended"', () => {
    expect(myShiftCard(row('w', { ...today, status: 'worked' }), NOW)).toBe('ended');
  });

  it('an unresolved No check-out outranks everything', () => {
    expect(myShiftCard(row('n', { ...today, status: 'worked', noCheckoutOpen: true }), NOW)).toBe(
      'no_checkout',
    );
  });

  it('leaves every live card to the domain', () => {
    expect(myShiftCard(row('t', at('2026-09-25', '18:00', '23:00')), NOW)).toBe('today');
    expect(myShiftCard(row('l', at('2026-10-03', '11:00', '16:00')), NOW)).toBe('confirmed');
    // Tomorrow's shift, the day before, "I'm ready" not yet pressed.
    expect(myShiftCard(row('r', at('2026-09-26', '18:00', '23:00')), NOW)).toBe('needs_ready');
  });
});
