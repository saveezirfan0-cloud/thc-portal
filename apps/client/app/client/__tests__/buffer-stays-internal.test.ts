import { describe, expect, it } from 'vitest';
import {
  arrivalsWithinHeadcount,
  cappedConfirmed,
  documentPendingLine,
  eventEnded,
  feedbackInviteText,
  feedbackToGo,
  fillOf,
  groupBySection,
  listFaces,
  roleBreakdown,
  sectionCountLabel,
  sectionTone,
  tabCounts,
} from '../rules';
import type { LineupRow, PortalEvent, RoleSection } from '../rules';

/**
 * Round 2 of the live walk (ADR-0133): the counts the customer reads hold
 * every section to the headcount they booked, so THC's buffer never shows
 * (§3.2, wireframes/client/events.html "buffer slots are internal and
 * never shown"); the tab badges count live events; the feedback banner and
 * the document line say what is true at the moment they are read.
 */

const section = (
  role: string,
  headcount: number,
  confirmed: number,
  over: Partial<RoleSection> = {},
): RoleSection => ({
  shiftId: `s-${role}`,
  eventId: 'ev-1',
  role,
  startsAt: '2026-10-22T06:00:00Z',
  endsAt: '2026-10-22T17:00:00Z',
  headcount,
  confirmed,
  ...over,
});

/** The walk's AUDIT-Future Conference Day: Host 2/2, Waiting Staff 6/4, Bar Staff 0/2. */
const conference = [
  section('Host', 2, 2),
  section('Waiting Staff', 4, 6),
  section('Bar Staff', 2, 0, { startsAt: '2026-10-22T08:00:00Z' }),
];

describe('"N of M confirmed" never counts the buffer (CW-01)', () => {
  it('reads Host 2/2 + Waiting Staff 6/4 + Bar Staff 0/2 as "6 of 8", amber — not "8 of 8", green', () => {
    expect(fillOf(conference)).toEqual({ confirmed: 6, headcount: 8, percent: 75, tone: 'amber' });
  });

  it('splits it per role as "4/4", never "6/4", and flags the empty role', () => {
    expect(
      roleBreakdown(conference).map(
        (r) => `${r.role} ${r.confirmed}/${r.headcount}${r.short ? '!' : ''}`,
      ),
    ).toEqual(['Host 2/2', 'Waiting Staff 4/4', 'Bar Staff 0/2!']);
  });

  it('is green when every role is full, buffer or not, and still reads M of M', () => {
    const staffed = [
      section('Host', 2, 2),
      section('Waiting Staff', 4, 6),
      section('Bar Staff', 2, 3),
    ];
    expect(fillOf(staffed)).toEqual({ confirmed: 8, headcount: 8, percent: 100, tone: 'green' });
    expect(roleBreakdown(staffed).every((r) => !r.short && r.confirmed === r.headcount)).toBe(true);
  });

  it('keeps two sections of one role apart before adding them: a full lunch cannot hide an empty dinner', () => {
    const shifts = [
      section('Waiting', 4, 6, { shiftId: 's-lunch' }),
      section('Waiting', 4, 0, { shiftId: 's-dinner', startsAt: '2026-10-22T16:00:00Z' }),
    ];
    expect(fillOf(shifts)).toMatchObject({ confirmed: 4, headcount: 8, tone: 'amber' });
    expect(roleBreakdown(shifts)).toEqual([
      { role: 'Waiting', confirmed: 4, headcount: 8, short: true },
    ]);
  });

  it('caps one section at its headcount and never below zero', () => {
    expect(cappedConfirmed({ confirmed: 6, headcount: 4 })).toBe(4);
    expect(cappedConfirmed({ confirmed: 1, headcount: 4 })).toBe(1);
    expect(cappedConfirmed({ confirmed: 3, headcount: 0 })).toBe(0);
  });

  it('labels the event page section pill "4 of 4 confirmed", green, for 6 on a headcount of 4', () => {
    const group = { confirmed: 6, headcount: 4 };
    expect(sectionCountLabel(group, false)).toBe('4 of 4 confirmed');
    expect(sectionCountLabel(group, true)).toBe('4 of 4 worked');
    expect(sectionTone(group, false)).toBe('green');
    expect(sectionCountLabel({ confirmed: 0, headcount: 2 }, false)).toBe('0 of 2 confirmed');
    // No section to compare against: what there is.
    expect(sectionCountLabel({ confirmed: 2, headcount: null }, false)).toBe('2 confirmed');
  });

  it('holds "N of M arrived" to the headcount too, section by section', () => {
    const counts = {
      confirmed: 8,
      arrived: 7,
      bySection: {
        's-Host': { confirmed: 2, arrived: 2 },
        's-Waiting Staff': { confirmed: 6, arrived: 5 },
      },
    };
    expect(arrivalsWithinHeadcount(counts, conference)).toEqual({
      confirmed: 6,
      arrived: 6,
      bySection: {
        's-Host': { confirmed: 2, arrived: 2 },
        's-Waiting Staff': { confirmed: 4, arrived: 4 },
      },
    });
    // A section the sections read did not return keeps its own figures.
    expect(
      arrivalsWithinHeadcount(
        { confirmed: 3, arrived: 1, bySection: { 's-x': { confirmed: 3, arrived: 1 } } },
        conference,
      ),
    ).toMatchObject({ confirmed: 3, arrived: 1 });
    expect(arrivalsWithinHeadcount(undefined, conference)).toBeUndefined();
  });
});

const ev = (over: Partial<PortalEvent> & Pick<PortalEvent, 'id'>): PortalEvent => ({
  title: over.id,
  venueName: 'Leonardo Royal Hotel',
  venueAddress: '10 Godliman St',
  eventDate: '2026-10-16',
  poNumber: null,
  onsiteContact: null,
  startsAt: '2026-10-16T06:00:00Z',
  endsAt: '2026-10-16T22:30:00Z',
  status: 'upcoming',
  ...over,
});

const NOW = new Date('2026-10-14T12:00:00Z');

describe('the tab badges count live events only (CW-14)', () => {
  it('leaves a cancelled event out of "Upcoming N" and "Past N"', () => {
    const events = [
      ev({
        id: 'live',
        status: 'ongoing',
        startsAt: '2026-10-14T07:00:00Z',
        endsAt: '2026-10-14T15:00:00Z',
      }),
      ev({ id: 'gala' }),
      ev({ id: 'conf', startsAt: '2026-10-22T06:00:00Z', endsAt: '2026-10-22T17:00:00Z' }),
      ev({
        id: 'tea',
        status: 'cancelled',
        startsAt: '2026-10-24T12:00:00Z',
        endsAt: '2026-10-24T17:00:00Z',
      }),
      ev({
        id: 'dinner',
        status: 'completed',
        startsAt: '2026-10-12T17:00:00Z',
        endsAt: '2026-10-12T22:00:00Z',
      }),
      ev({
        id: 'old-off',
        status: 'cancelled',
        startsAt: '2026-10-01T17:00:00Z',
        endsAt: '2026-10-01T22:00:00Z',
      }),
    ];
    expect(tabCounts(events, NOW)).toEqual({ upcoming: 3, past: 1 });
  });
});

describe('the feedback banner once the event is over (CW-10)', () => {
  it('says "has started" while it runs, "has finished" once it ended', () => {
    const running = ev({ id: 'r', status: 'ongoing', endsAt: '2026-10-14T15:00:00Z' });
    expect(feedbackInviteText(running, NOW)).toMatch(/^The event has started — you can now leave/);
    const over = ev({ id: 'o', status: 'completed', endsAt: '2026-10-13T22:00:00Z' });
    expect(feedbackInviteText(over, NOW)).toBe(
      "This event has finished — you can leave feedback for anyone you haven't yet. One entry per person per event.",
    );
  });

  it('goes by the clock as well as the status, which lags it by a refresh', () => {
    const stale = ev({ id: 's', status: 'ongoing', endsAt: '2026-10-14T11:59:00Z' });
    expect(eventEnded(stale, NOW)).toBe(true);
    expect(feedbackInviteText(stale, NOW)).toMatch(/has finished/);
    expect(eventEnded(ev({ id: 'f', endsAt: '2026-10-14T12:01:00Z' }), NOW)).toBe(false);
  });
});

describe('the quiet line in place of a dead download (CW-04)', () => {
  it('says the Allocation Timesheet is sent the day before while that is still ahead', () => {
    expect(documentPendingLine('allocation', ev({ id: 'g' }), NOW)).toBe(
      'Allocation Timesheet: sent the day before, once every role is confirmed',
    );
  });

  it('says only "not issued yet" on the day, while running, and for the Completed Timesheet', () => {
    const today = ev({ id: 't', startsAt: '2026-10-14T17:00:00Z' });
    expect(documentPendingLine('allocation', today, NOW)).toBe(
      'Allocation Timesheet not issued yet',
    );
    const running = ev({ id: 'r', status: 'ongoing', startsAt: '2026-10-14T07:00:00Z' });
    expect(documentPendingLine('allocation', running, NOW)).toBe(
      'Allocation Timesheet not issued yet',
    );
    expect(documentPendingLine('signout', ev({ id: 'c', status: 'completed' }), NOW)).toBe(
      'Completed Timesheet not issued yet',
    );
  });
});

/**
 * ADR-0134 (product owner, 14.10.2026: "only up to headcount"):
 * `client_lineup_v` returns at most `headcount` people per section — the
 * checked-in first, then the earliest confirmed — and keeps a worker the
 * customer already rated. The screens draw what the view returns, so the
 * faces, the pill, "N of M arrived" and the feedback nudge all follow the
 * same trimmed set; pgTAP 815 holds which rows those are.
 */
describe('the line-up stops at the headcount (ADR-0134)', () => {
  const person = (n: number, over: Partial<LineupRow> = {}): LineupRow => ({
    bookingId: `b-${n}`,
    eventId: 'ev-1',
    shiftId: 's-Waiting Staff',
    role: 'Waiting Staff',
    startsAt: '2026-10-22T06:00:00Z',
    endsAt: '2026-10-22T17:00:00Z',
    name: `Worker ${n}`,
    sortKey: `worker ${n}`,
    feedbackGiven: false,
    ...over,
  });
  // What the view now returns for Waiting Staff 4 (six confirmed): four rows,
  // and a section count already held to four.
  const waiting = section('Waiting Staff', 4, 4);
  const trimmed = [1, 2, 3, 4].map((n) => person(n));
  const started = ev({
    id: 'ev-1',
    status: 'ongoing',
    startsAt: '2026-10-14T06:00:00Z',
    endsAt: '2026-10-14T17:00:00Z',
  });

  it('draws four faces under "4 of 4 confirmed", and asks for feedback on four', () => {
    const [group] = groupBySection(trimmed, [waiting]);
    expect(group!.people).toHaveLength(4);
    expect(sectionCountLabel(group!, false)).toBe('4 of 4 confirmed');
    expect(listFaces([started], trimmed)).toHaveLength(4);
    expect(feedbackToGo(started, trimmed, NOW)).toEqual({ toGo: 4, total: 4 });
  });

  it('keeps a rated worker past the headcount without the count ever reading "5 of 4"', () => {
    const kept = [...trimmed, person(5, { feedbackGiven: true, feedbackRating: 2 })];
    const [group] = groupBySection(kept, [waiting]);
    expect(group!.people.map((p) => p.bookingId)).toContain('b-5');
    expect(sectionCountLabel(group!, false)).toBe('4 of 4 confirmed');
    expect(fillOf([waiting])).toMatchObject({ confirmed: 4, headcount: 4, tone: 'green' });
    // The rated one is done; the four seated are still to go.
    expect(feedbackToGo(started, kept, NOW)).toEqual({ toGo: 4, total: 5 });
  });

  it('agrees with the capped view counts: the client cap is a no-op on them', () => {
    expect(cappedConfirmed(waiting)).toBe(4);
    const view = {
      confirmed: 4,
      arrived: 3,
      bySection: { 's-Waiting Staff': { confirmed: 4, arrived: 3 } },
    };
    expect(arrivalsWithinHeadcount(view, [waiting])).toEqual(view);
  });
});
