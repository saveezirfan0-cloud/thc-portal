import { describe, expect, it } from 'vitest';
import {
  ACCEPT_REFUSAL_COPY,
  APPLY_REFUSAL_COPY,
  STATIC_SCREEN_CONTACT,
  SELF_CANCEL_WINDOW_HOURS,
  type StaffBooking,
  canCancelShift,
  cancelDeadline,
  formatDistance,
  radarGroups,
  readyDeadline,
  readyDeadlinePassed,
  shiftCard,
  staticScreenCase,
} from '../staff';

const HOUR = 3_600_000;

function booking(over: Partial<StaffBooking> = {}): StaffBooking {
  return {
    status: 'confirmed',
    startsAt: new Date('2026-09-19T17:00:00Z'),
    endsAt: new Date('2026-09-19T23:30:00Z'),
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

  it('names an unresolved No check-out, whose card stays in the list (RULE-02)', () => {
    expect(staticScreenCase(booking({ status: 'worked', noCheckoutOpen: true }))).toBe(
      'no_checkout',
    );
  });

  it('is null for an ordinary booking', () => {
    expect(staticScreenCase(booking())).toBe(null);
  });

  it('carries the contact line the approved design fixes', () => {
    expect(STATIC_SCREEN_CONTACT).toContain('admin@thehospitalitycompany.co.uk');
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

  it('uses the scope’s own words for a shift that filled while the screen was open', () => {
    expect(APPLY_REFUSAL_COPY.full.title).toBe('Sorry, this shift is now full');
  });
});
