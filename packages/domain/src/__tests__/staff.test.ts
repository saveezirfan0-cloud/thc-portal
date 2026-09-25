import { describe, expect, it } from 'vitest';
import {
  ACCEPT_REFUSAL_COPY,
  capMeter,
  explainLimit,
  APPLY_REFUSAL_COPY,
  STATIC_SCREEN_ACTION,
  STATIC_SCREEN_CONTACT,
  STATIC_SCREEN_COPY,
  SELF_CANCEL_WINDOW_HOURS,
  TURNED_AWAY_COPY,
  type StaffBooking,
  canCancelShift,
  cancelDeadline,
  formatDistance,
  radarGroups,
  readyCutoffApplies,
  readyDeadline,
  readyDeadlinePassed,
  shiftCard,
  staticScreenCase,
  turnedAwayMessage,
  turnedAwayOnTime,
} from '../staff';
import { turnedAwayMinutes } from '../pay';

const HOUR = 3_600_000;

function booking(over: Partial<StaffBooking> = {}): StaffBooking {
  return {
    status: 'confirmed',
    startsAt: new Date('2026-09-19T17:00:00Z'),
    endsAt: new Date('2026-09-19T23:30:00Z'),
    confirmedAt: new Date('2026-09-10T09:00:00Z'),
    dayBeforeConfirmedAt: null,
    onDayConfirmedAt: null,
    reconfirmRequired: false,
    cancelCause: null,
    eventCancelledAt: null,
    noCheckoutOpen: false,
    ...over,
  };
}

describe('readyDeadline (§3.5)', () => {
  it('is 12:00 UK on the day before, which in BST is 11:00 UTC', () => {
    // 19 Sep 2026 is inside British Summer Time.
    expect(readyDeadline(new Date('2026-09-19T17:00:00Z')).toISOString()).toBe(
      '2026-09-18T11:00:00.000Z',
    );
  });

  it('is 12:00 UK in GMT too, which is 12:00 UTC — not a fixed offset from the start', () => {
    expect(readyDeadline(new Date('2026-12-19T17:00:00Z')).toISOString()).toBe(
      '2026-12-18T12:00:00.000Z',
    );
  });

  it('follows the calendar, not a fixed 24 hours: an 02:00 start still asks the day before', () => {
    // 02:00 UK on the 20th → the day before is the 19th, deadline noon.
    const deadline = readyDeadline(new Date('2026-09-20T01:00:00Z'));
    expect(deadline.toISOString()).toBe('2026-09-19T11:00:00.000Z');
  });

  it('has passed once the moment itself arrives — 12:05 is the release, 12:00 the deadline', () => {
    const startsAt = new Date('2026-09-19T17:00:00Z');
    expect(readyDeadlinePassed(startsAt, new Date('2026-09-18T10:59:00Z'))).toBe(false);
    expect(readyDeadlinePassed(startsAt, new Date('2026-09-18T11:00:00Z'))).toBe(true);
  });
});

describe('readyCutoffApplies (§3.5)', () => {
  const startsAt = new Date('2026-09-19T17:00:00Z'); // deadline 2026-09-18T11:00Z (BST)

  it('applies to a booking confirmed before the deadline, and not at or after it', () => {
    expect(readyCutoffApplies(new Date('2026-09-18T10:59:00Z'), startsAt)).toBe(true);
    expect(readyCutoffApplies(new Date('2026-09-18T11:00:00Z'), startsAt)).toBe(false);
  });

  it('does not apply to a same-day booking (RULE-08)', () => {
    expect(readyCutoffApplies(new Date('2026-09-19T09:00:00Z'), startsAt)).toBe(false);
  });

  it('does not apply without a confirmedAt', () => {
    expect(readyCutoffApplies(null, startsAt)).toBe(false);
  });
});

describe('canCancelShift (RULE-04)', () => {
  const startsAt = new Date('2026-09-19T17:00:00Z');

  it('leaves the deadline exactly 72 hours before the start', () => {
    expect(cancelDeadline(startsAt).toISOString()).toBe('2026-09-16T17:00:00.000Z');
    expect(SELF_CANCEL_WINDOW_HOURS).toBe(72);
  });

  it('is offered while MORE than 72 hours remain, and gone at exactly 72', () => {
    expect(canCancelShift(startsAt, new Date(startsAt.getTime() - 73 * HOUR))).toBe(true);
    expect(canCancelShift(startsAt, new Date(startsAt.getTime() - 72 * HOUR))).toBe(false);
    expect(canCancelShift(startsAt, new Date(startsAt.getTime() - 71 * HOUR))).toBe(false);
  });
});

describe('shiftCard (§10.4, §3.5)', () => {
  it('is plain Confirmed while the shift is days away and nothing is outstanding', () => {
    expect(shiftCard(booking(), new Date('2026-09-15T09:00:00Z'))).toBe('confirmed');
  });

  it('asks for "I\'m ready" from the start of the day before, not only at the deadline', () => {
    expect(shiftCard(booking(), new Date('2026-09-18T08:00:00Z'))).toBe('needs_ready');
  });

  // §3.5 / 20260927140300: the 12:05 cutoff only releases a booking
  // confirmed before the deadline, so only those are asked.
  it('does not ask a worker who accepted after 12:00 the day before', () => {
    const b = booking({ confirmedAt: new Date('2026-09-18T14:00:00Z') });
    expect(shiftCard(b, new Date('2026-09-18T15:00:00Z'))).toBe('confirmed');
  });

  it('still asks one who accepted that morning, before the deadline', () => {
    const b = booking({ confirmedAt: new Date('2026-09-18T08:30:00Z') });
    expect(shiftCard(b, new Date('2026-09-18T09:00:00Z'))).toBe('needs_ready');
  });

  it('does not ask a booking with no confirmedAt, which the cutoff never releases', () => {
    expect(shiftCard(booking({ confirmedAt: null }), new Date('2026-09-18T08:00:00Z'))).toBe(
      'confirmed',
    );
  });

  it('stops asking once the worker has pressed it', () => {
    const b = booking({ dayBeforeConfirmedAt: new Date('2026-09-18T08:05:00Z') });
    expect(shiftCard(b, new Date('2026-09-18T09:00:00Z'))).toBe('confirmed');
  });

  it('becomes Today on the day, where stage 3 and check-in live', () => {
    expect(shiftCard(booking(), new Date('2026-09-19T09:00:00Z'))).toBe('today');
  });

  it('puts a changed time above everything else, including Today', () => {
    // A worker who reads "Today · 17:00" on a shift the office moved to 11:00
    // has been failed by the screen, so the N11 state outranks the rest.
    const b = booking({ reconfirmRequired: true });
    expect(shiftCard(b, new Date('2026-09-19T09:00:00Z'))).toBe('reconfirm');
    expect(shiftCard(b, new Date('2026-09-18T08:00:00Z'))).toBe('reconfirm');
  });

  it('is past once the role window has ended', () => {
    expect(shiftCard(booking(), new Date('2026-09-20T00:00:00Z'))).toBe('past');
  });

  it('is past even carrying a stale reconfirm flag, or it asks forever', () => {
    const b = booking({ reconfirmRequired: true });
    expect(shiftCard(b, new Date('2026-09-20T00:00:00Z'))).toBe('past');
  });

  it('never asks a worked booking to confirm: they have already checked in', () => {
    // confirm_on_day refuses anything that is not `confirmed`, so offering
    // the button would be a press that can only fail.
    const b = booking({ status: 'worked' });
    expect(shiftCard(b, new Date('2026-09-18T08:00:00Z'))).toBe('today');
  });
});

describe('the cap arithmetic reaches the worker (§10.4, RULE-20)', () => {
  const figures = {
    weekStart: '2026-09-21',
    bookedHours: 18,
    capHours: 20,
    shiftHours: 4,
  };

  it('gives §10.4\u2019s own worked example back', () => {
    const text = explainLimit(figures)!;
    expect(text).toContain('18 h');
    expect(text).toContain('4 h');
    expect(text).toContain('22 h');
    expect(text).toContain('20 h');
    expect(text).toContain('Mon 21 Sep');
  });

  it('explains nothing where there is no ceiling — null is not zero', () => {
    expect(explainLimit({ ...figures, capHours: null })).toBe(null);
    expect(capMeter({ ...figures, capHours: null })).toBe(null);
  });

  it('gives the header strip its "8 h of 20 h"', () => {
    expect(capMeter({ ...figures, bookedHours: 8 })).toBe('8 h of 20 h');
  });

  it('rounds to one place rather than printing 21.999999999999996 h', () => {
    expect(explainLimit({ ...figures, bookedHours: 17.9, shiftHours: 4.1 })).toContain('22 h');
  });
});

describe('staticScreenCase (§10.4)', () => {
  it('names the cancelled event', () => {
    expect(staticScreenCase(booking({ eventCancelledAt: new Date() }))).toBe('event_cancelled');
  });

  it('names an office withdrawal, and only an office withdrawal', () => {
    expect(staticScreenCase(booking({ status: 'cancelled', cancelCause: 'office_withdraw' }))).toBe(
      'withdrawn',
    );
    // The worker's own cancel is not a dead end they need explaining to them.
    expect(staticScreenCase(booking({ status: 'cancelled', cancelCause: 'self_cancel' }))).toBe(
      null,
    );
  });

  it('treats the 12:05 release (N6b) as the office taking the shift back, per the wireframe', () => {
    expect(staticScreenCase(booking({ status: 'cancelled', cancelCause: 'ready_cutoff' }))).toBe(
      'withdrawn',
    );
  });

  it('puts a cancelled event ahead of how the booking itself ended', () => {
    expect(
      staticScreenCase(
        booking({
          status: 'cancelled',
          cancelCause: 'event_cancelled',
          eventCancelledAt: new Date(),
        }),
      ),
    ).toBe('event_cancelled');
  });

  it('names an unresolved No check-out, whose card stays in the list (RULE-02)', () => {
    expect(staticScreenCase(booking({ status: 'worked', noCheckoutOpen: true }))).toBe(
      'no_checkout',
    );
  });

  it('is null for an ordinary booking', () => {
    expect(staticScreenCase(booking())).toBe(null);
  });

  it('carries the contact line the approved design fixes', () => {
    expect(STATIC_SCREEN_CONTACT).toBe(
      'If you believe there has been an error, please contact us at: admin@thehospitalitycompany.co.uk',
    );
    expect(STATIC_SCREEN_ACTION).toBe('OK, I understand');
  });

  it('carries the three §10.4 sentences verbatim', () => {
    expect(STATIC_SCREEN_COPY.event_cancelled.title).toBe('This event has been cancelled');
    expect(STATIC_SCREEN_COPY.withdrawn.title).toBe('You’ve been removed from this shift');
    // The No check-out sentence is ONE heading: the half after the dash is
    // the part that tells the worker somebody is already on it.
    expect(STATIC_SCREEN_COPY.no_checkout.title).toBe(
      'We didn’t receive your check-out for this shift — the office is following up with you directly.',
    );
  });
});

describe('the strict-buffer turn-away screen (§3.2, RULE-15)', () => {
  // A 17:00 UK start (BST); the grace runs to 17:30.
  const shift = {
    startsAt: new Date('2026-06-14T16:00:00Z'),
    endsAt: new Date('2026-06-14T22:30:00Z'),
  };
  const payFor = (iso: string) => turnedAwayMinutes(shift, new Date(iso));

  const ON_TIME =
    'Thanks for coming — this shift is already fully staffed, so you’re not needed today. We’ve logged that you arrived on time and you’ll be paid for 4 hours. Please check your app for other shifts.';
  const LATE =
    'Thanks for coming — this shift is already fully staffed, so you’re not needed today. Please check your app for other shifts.';

  it('tells an on-time worker they are paid four hours, in the §3.2 words', () => {
    expect(payFor('2026-06-14T15:58:00Z')).toBe(240);
    expect(turnedAwayMessage(payFor('2026-06-14T15:58:00Z'))).toBe(ON_TIME);
  });

  it('keeps the four-hour sentence for an attempt late but inside the grace', () => {
    // RULE-15 "on time" is the grace window, not the scheduled start.
    expect(turnedAwayMessage(payFor('2026-06-14T16:29:00Z'))).toBe(ON_TIME);
  });

  it('drops the second sentence once the grace has elapsed — a late turn-away is paid nothing', () => {
    expect(payFor('2026-06-14T16:30:00Z')).toBe(0);
    const late = turnedAwayMessage(payFor('2026-06-14T16:30:00Z'));
    expect(late).toBe(LATE);
    expect(late).not.toContain('4 hours');
    expect(late).not.toContain('on time');
  });

  it('never promises pay it has no decision for', () => {
    expect(turnedAwayOnTime(null)).toBe(false);
    expect(turnedAwayOnTime(undefined)).toBe(false);
    expect(turnedAwayOnTime(0)).toBe(false);
    expect(turnedAwayOnTime(240)).toBe(true);
    expect(turnedAwayMessage(null)).toBe(LATE);
  });

  it('carries the wireframe’s pill, heading and second button', () => {
    expect(TURNED_AWAY_COPY.badge).toBe('Not needed today');
    expect(TURNED_AWAY_COPY.tone).toBe('amber');
    expect(TURNED_AWAY_COPY.title).toBe('Thanks for coming');
    expect(TURNED_AWAY_COPY.radar).toBe('Open Radar');
  });
});

describe('radarGroups (RULE-17, §10.4)', () => {
  const row = (id: string, over: Partial<Parameters<typeof radarGroups>[0][number]> = {}) => ({
    shiftId: id,
    qualified: false,
    hoursLimit: false,
    appliedAt: null,
    distanceKm: 1,
    startsAt: new Date('2026-09-19T17:00:00Z'),
    ...over,
  });

  it('splits wave 1 from wave 2', () => {
    const groups = radarGroups([row('a', { qualified: true }), row('b')]);
    expect(groups.qualified.map((r) => r.shiftId)).toEqual(['a']);
    expect(groups.other.map((r) => r.shiftId)).toEqual(['b']);
  });

  it('pulls an applied shift out of its wave group rather than listing it twice', () => {
    const groups = radarGroups([
      row('a', { qualified: true, appliedAt: new Date() }),
      row('b', { appliedAt: new Date() }),
    ]);
    expect(groups.qualified).toHaveLength(0);
    expect(groups.other).toHaveLength(0);
    expect(groups.applied.map((r) => r.shiftId)).toEqual(['a', 'b']);
  });

  it('keeps the order it was given — the SQL already sorted by distance', () => {
    const groups = radarGroups([
      row('far', { qualified: true, distanceKm: 9 }),
      row('near', { qualified: true, distanceKm: 1 }),
    ]);
    expect(groups.qualified.map((r) => r.shiftId)).toEqual(['far', 'near']);
  });
});

describe('formatDistance', () => {
  it('keeps one decimal close in and drops it further out', () => {
    expect(formatDistance(1.2)).toBe('1.2 km');
    expect(formatDistance(12.4)).toBe('12 km');
  });

  it('shows a dash rather than 0 km when the worker has no home location on file', () => {
    expect(formatDistance(null)).toBe('—');
  });
});

describe('refusal copy', () => {
  it('tells a worker whose invitation is gone that it is gone, and one who is blocked that it is not', () => {
    expect(ACCEPT_REFUSAL_COPY.taken.title).toBe('Sorry, this shift has been taken');
    expect(ACCEPT_REFUSAL_COPY.overlap.title).toContain('overlapping');
    expect(ACCEPT_REFUSAL_COPY.hours_limit.title).toBe('Limit Reached');
  });

  it('does not tell a worker past their right to work that they are over their hours', () => {
    // accept_invite answers rtw_expired since 20260925100000.
    expect(ACCEPT_REFUSAL_COPY.rtw_expired).toEqual(APPLY_REFUSAL_COPY.rtw_expired);
    expect(ACCEPT_REFUSAL_COPY.rtw_expired.title).not.toBe(ACCEPT_REFUSAL_COPY.hours_limit.title);
    expect(ACCEPT_REFUSAL_COPY.event_ended.title).toBe('This shift has already ended');
  });

  it('uses the scope’s own words for a shift that filled while the screen was open', () => {
    expect(APPLY_REFUSAL_COPY.full.title).toBe('Sorry, this shift is now full');
  });
});
