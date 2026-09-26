import { describe, expect, it } from 'vitest';
import {
  NO_FILTERS,
  applyFilters,
  emptyReason,
  feedbackToGo,
  filterByTab,
  filtersActive,
  isRemoved,
  nextUp,
  roleBreakdown,
  timesheetStatus,
  venuesOf,
  momentIn,
} from '../rules';
import type { LineupRow, PortalEvent, RoleSection } from '../rules';

/**
 * The event list's additions (ADR-0049): the role split, the feedback
 * nudge, the timesheet's status, the filters, the empty state's reason and
 * the "Next up" strip. Presentation only, from the rows the list already
 * has, so every one of them is a pure function pinned here.
 */

const section = (over: Partial<RoleSection> & Pick<RoleSection, 'role'>): RoleSection => ({
  shiftId: `shift-${over.role}-${over.startsAt ?? ''}`,
  eventId: 'ev-1',
  startsAt: '2026-09-19T06:00:00Z',
  endsAt: '2026-09-19T14:00:00Z',
  headcount: 2,
  confirmed: 2,
  ...over,
});

const person = (over: Partial<LineupRow> & Pick<LineupRow, 'name'>): LineupRow => ({
  bookingId: `b-${over.name}`,
  eventId: 'ev-1',
  shiftId: null,
  role: 'Waiting Staff',
  startsAt: '2026-09-19T16:00:00Z',
  endsAt: '2026-09-19T22:30:00Z',
  photoPath: null,
  sortKey: over.name.toLowerCase(),
  feedbackGiven: false,
  ...over,
});

const event = (over: Partial<PortalEvent> = {}): PortalEvent => ({
  id: 'ev-1',
  title: 'Gala Dinner',
  venueName: 'Leonardo Royal Hotel',
  venueAddress: '10 Godliman St, EC4V 5AJ',
  eventDate: '2026-09-19',
  poNumber: '4471-A',
  onsiteContact: null,
  startsAt: '2026-09-19T06:00:00Z', // 07:00 BST
  endsAt: '2026-09-19T22:30:00Z', // 23:30 BST
  status: 'upcoming',
  ...over,
});

describe('the per-role split under the fill bar (§11.1, ADR-0049)', () => {
  it('orders roles by their own start (RULE-18), not alphabetically', () => {
    const roles = roleBreakdown([
      section({ role: 'Waiting', startsAt: '2026-09-19T16:00:00Z', headcount: 10, confirmed: 8 }),
      section({ role: 'Bar', startsAt: '2026-09-19T17:00:00Z', headcount: 7, confirmed: 5 }),
      section({ role: 'Chef', startsAt: '2026-09-19T06:00:00Z', headcount: 2, confirmed: 2 }),
    ]);
    expect(roles.map((r) => `${r.role} ${r.confirmed}/${r.headcount}`)).toEqual([
      'Chef 2/2',
      'Waiting 8/10',
      'Bar 5/7',
    ]);
  });

  it('marks a short role, and only a short one', () => {
    const roles = roleBreakdown([
      section({ role: 'Chef', headcount: 2, confirmed: 2 }),
      section({ role: 'Bar', startsAt: '2026-09-19T17:00:00Z', headcount: 7, confirmed: 5 }),
    ]);
    expect(roles.map((r) => r.short)).toEqual([false, true]);
  });

  it('adds two shifts of the same role into one entry', () => {
    const roles = roleBreakdown([
      section({ role: 'Waiting', startsAt: '2026-09-19T17:00:00Z', headcount: 6, confirmed: 6 }),
      section({ role: 'Waiting', startsAt: '2026-09-19T11:00:00Z', headcount: 4, confirmed: 2 }),
    ]);
    expect(roles).toEqual([{ role: 'Waiting', confirmed: 8, headcount: 10, short: true }]);
  });

  it('is empty for an event with no sections', () => {
    expect(roleBreakdown([])).toEqual([]);
  });
});

describe('the feedback nudge (§11.2, ADR-0049)', () => {
  const started = new Date('2026-09-19T08:00:00Z');
  const thirteen = Array.from({ length: 13 }, (_, i) =>
    person({ name: `Worker ${i + 1}`, feedbackGiven: i < 8 }),
  );

  it('counts the confirmed workers still without feedback on a completed event', () => {
    expect(feedbackToGo(event({ status: 'completed' }), thirteen, started)).toEqual({
      toGo: 5,
      total: 13,
    });
  });

  it('shows during the event too, once it has started', () => {
    expect(feedbackToGo(event({ status: 'ongoing' }), thirteen, started)).toEqual({
      toGo: 5,
      total: 13,
    });
  });

  it('never shows on an upcoming event, whatever the clock says', () => {
    expect(feedbackToGo(event({ status: 'upcoming' }), thirteen, started)).toBeNull();
    expect(
      feedbackToGo(event({ status: 'upcoming' }), thirteen, new Date('2026-09-18T12:00:00Z')),
    ).toBeNull();
  });

  it('never shows before the start, as the event page keeps its buttons locked', () => {
    const early = new Date('2026-09-19T05:59:00Z');
    expect(feedbackToGo(event({ status: 'ongoing' }), thirteen, early)).toBeNull();
  });

  it('never shows on a cancelled event', () => {
    expect(feedbackToGo(event({ status: 'cancelled' }), thirteen, started)).toBeNull();
  });

  it('disappears once every worker has feedback', () => {
    const done = thirteen.map((p) => ({ ...p, feedbackGiven: true }));
    expect(feedbackToGo(event({ status: 'completed' }), done, started)).toBeNull();
  });

  it('leaves a removed worker out of both numbers, since they cannot be rated (§1.7)', () => {
    const rows = [
      person({ name: 'Aisha Bello' }),
      person({ name: 'Luca Moretti', feedbackGiven: true }),
      person({ name: 'Deleted account #4821' }),
    ];
    expect(isRemoved(rows[2]!)).toBe(true);
    expect(feedbackToGo(event({ status: 'completed' }), rows, started)).toEqual({
      toGo: 1,
      total: 2,
    });
  });

  it("counts this event's line-up only", () => {
    const rows = [person({ name: 'Aisha Bello' }), person({ name: 'Tom Reid', eventId: 'ev-2' })];
    expect(feedbackToGo(event({ status: 'completed' }), rows, started)).toEqual({
      toGo: 1,
      total: 1,
    });
  });
});

describe("the signed timesheet's status on a past event (§11.3, ADR-0049)", () => {
  it('is ready exactly when the final copy has been issued', () => {
    expect(timesheetStatus('completed', ['allocation', 'signout'])).toBe('ready');
  });

  it('is pending while only the allocation sheet exists', () => {
    expect(timesheetStatus('completed', ['allocation'])).toBe('pending');
    expect(timesheetStatus('completed', [])).toBe('pending');
  });

  it('says nothing before the event is over, or for a cancelled one', () => {
    expect(timesheetStatus('upcoming', ['allocation'])).toBeNull();
    expect(timesheetStatus('ongoing', ['allocation'])).toBeNull();
    expect(timesheetStatus('cancelled', ['signout'])).toBeNull();
  });
});

describe('the search, venue and date filters (ADR-0049)', () => {
  const gala = event();
  const lunch = event({
    id: 'ev-2',
    title: 'Lunch Service',
    venueName: 'The Shard',
    poNumber: null,
    startsAt: '2026-09-12T10:00:00Z',
    endsAt: '2026-09-12T15:00:00Z',
    status: 'completed',
  });
  const launch = event({
    id: 'ev-3',
    title: 'Product Launch',
    venueName: 'Leonardo Royal Hotel',
    poNumber: 'PL-77',
    startsAt: '2026-09-26T17:00:00Z',
    endsAt: '2026-09-26T21:00:00Z',
  });
  const all = [gala, lunch, launch];
  const ids = (list: PortalEvent[]) => list.map((e) => e.id);

  it('with no filters, keeps everything', () => {
    expect(ids(applyFilters(all, NO_FILTERS))).toEqual(['ev-1', 'ev-2', 'ev-3']);
    expect(filtersActive(NO_FILTERS)).toBe(false);
  });

  it('searches the title, the venue and the PO number, ignoring case', () => {
    expect(ids(applyFilters(all, { ...NO_FILTERS, query: 'gala' }))).toEqual(['ev-1']);
    expect(ids(applyFilters(all, { ...NO_FILTERS, query: 'SHARD' }))).toEqual(['ev-2']);
    expect(ids(applyFilters(all, { ...NO_FILTERS, query: 'pl-77' }))).toEqual(['ev-3']);
  });

  it('treats a search of only spaces as no search', () => {
    expect(filtersActive({ ...NO_FILTERS, query: '   ' })).toBe(false);
    expect(applyFilters(all, { ...NO_FILTERS, query: '   ' })).toHaveLength(3);
  });

  it('matches the venue exactly', () => {
    expect(ids(applyFilters(all, { ...NO_FILTERS, venue: 'Leonardo Royal Hotel' }))).toEqual([
      'ev-1',
      'ev-3',
    ]);
  });

  it('keeps both ends of the date range', () => {
    const range = { ...NO_FILTERS, from: '2026-09-12', to: '2026-09-19' };
    expect(ids(applyFilters(all, range))).toEqual(['ev-1', 'ev-2']);
    expect(filtersActive(range)).toBe(true);
  });

  it('includes an event at 23:30 UK on the To date', () => {
    // Summer: 23:30 BST is 22:30Z. Winter: 23:30 GMT is 23:30Z.
    const summer = event({ startsAt: '2026-09-19T22:30:00Z' });
    const winter = event({ id: 'ev-w', startsAt: '2026-12-05T23:30:00Z' });
    expect(applyFilters([summer], { ...NO_FILTERS, to: '2026-09-19' })).toHaveLength(1);
    expect(applyFilters([winter], { ...NO_FILTERS, to: '2026-12-05' })).toHaveLength(1);
  });

  it('files an event by its UK day, not its UTC day', () => {
    // 00:30 BST on the 20th is still the 19th in UTC: it is the 20th's
    // event, as the Date column prints it, so a range ending on the 19th
    // leaves it out and a range starting on the 20th takes it in.
    const afterMidnight = event({ startsAt: '2026-09-19T23:30:00Z' });
    expect(applyFilters([afterMidnight], { ...NO_FILTERS, to: '2026-09-19' })).toEqual([]);
    expect(applyFilters([afterMidnight], { ...NO_FILTERS, from: '2026-09-20' })).toHaveLength(1);
  });

  it('matches nothing when From is after To, rather than swapping them', () => {
    expect(applyFilters(all, { ...NO_FILTERS, from: '2026-09-26', to: '2026-09-12' })).toEqual([]);
  });

  it('combines with the search, the venue and the tab', () => {
    const now = new Date('2026-09-19T08:00:00Z');
    const upcoming = filterByTab(all, 'upcoming', now);
    const filters = {
      query: 'launch',
      venue: 'Leonardo Royal Hotel',
      from: '2026-09-20',
      to: '2026-09-30',
    };
    expect(ids(applyFilters(upcoming, filters))).toEqual(['ev-3']);
    expect(applyFilters(filterByTab(all, 'past', now), filters)).toEqual([]);
  });

  it('offers each venue once, A to Z', () => {
    expect(venuesOf(all)).toEqual(['Leonardo Royal Hotel', 'The Shard']);
    expect(venuesOf([gala])).toEqual(['Leonardo Royal Hotel']);
  });
});

describe('why the list is empty (ADR-0049)', () => {
  it('says nothing while there are rows', () => {
    expect(emptyReason(3, 2, 1)).toBeNull();
  });

  it('tells "no events at all" apart from "none in this tab"', () => {
    expect(emptyReason(0, 0, 0)).toBe('none');
    expect(emptyReason(3, 0, 0)).toBe('tab');
  });

  it('blames the filters only when the tab had rows to hide', () => {
    expect(emptyReason(3, 2, 0)).toBe('filters');
  });
});

describe('the "Next up" strip (ADR-0049)', () => {
  const morning = new Date('2026-09-19T05:00:00Z'); // 06:00 BST, Sat 19 Sep

  it('shows the soonest upcoming event, today, in UK time', () => {
    const later = event({ id: 'ev-late', title: 'Awards Night', startsAt: '2026-09-26T17:00:00Z' });
    const next = nextUp([later, event()], morning);
    expect(next?.event.id).toBe('ev-1');
    expect(next?.live).toBe(false);
    expect(next?.when).toBe('today 07:00 UK time');
  });

  it('says "tomorrow" by the UK calendar, and names any later day', () => {
    const tomorrow = event({ startsAt: '2026-09-20T06:00:00Z' });
    expect(nextUp([tomorrow], morning)?.when).toBe('tomorrow 07:00 UK time');
    const october = event({ startsAt: '2026-10-01T06:00:00Z' });
    expect(nextUp([october], morning)?.when).toBe('Thu 1 Oct 07:00 UK time');
    const january = event({ startsAt: '2027-01-08T09:00:00Z' });
    expect(nextUp([january], morning)?.when).toBe('Fri 8 Jan 2027 09:00 UK time');
  });

  it('judges "today" in the UK, not in UTC', () => {
    // 00:30 BST on Sunday the 20th is 23:30Z on Saturday the 19th.
    const justAfterMidnight = new Date('2026-09-19T23:30:00Z');
    const sunday = event({ startsAt: '2026-09-20T06:00:00Z' });
    expect(nextUp([sunday], justAfterMidnight)?.when).toBe('today 07:00 UK time');
  });

  it('prefers an event running now, with its end time', () => {
    const running = event({ id: 'ev-now', title: 'Lunch Service', status: 'ongoing' });
    const next = nextUp([event({ startsAt: '2026-09-19T16:00:00Z' }), running], morning);
    expect(next?.event.id).toBe('ev-now');
    expect(next?.live).toBe(true);
    expect(next?.when).toBe('until 23:30 UK time');
  });

  it('names the day an overnight event ends on', () => {
    const overnight = event({ status: 'ongoing', endsAt: '2026-09-20T01:00:00Z' });
    expect(nextUp([overnight], morning)?.when).toBe('until tomorrow 02:00 UK time');
  });

  it('is empty with nothing ahead: completed and cancelled never count', () => {
    expect(nextUp([], morning)).toBeNull();
    expect(
      nextUp([event({ status: 'completed' }), event({ id: 'ev-c', status: 'cancelled' })], morning),
    ).toBeNull();
  });
});

describe('momentIn · the strip\'s "your time" (§1.8)', () => {
  // 20:00 BST on Sat 19 Sep is already 23:00 in Dubai and 12:00 in LA.
  const evening = new Date('2026-09-19T19:00:00Z');

  it("writes the same instant on the viewer's own clock", () => {
    expect(momentIn('2026-09-19T20:30:00Z', evening, false, 'Asia/Dubai')).toBe('tomorrow 00:30');
    expect(momentIn('2026-09-19T20:30:00Z', evening, false, 'Europe/London')).toBe('today 21:30');
    expect(momentIn('2026-09-19T20:30:00Z', evening, false, 'America/Los_Angeles')).toBe(
      'today 13:30',
    );
  });

  it('judges "today" on the viewer\'s calendar, and drops it for an "until" today', () => {
    expect(momentIn('2026-09-19T19:45:00Z', evening, true, 'Asia/Dubai')).toBe('23:45');
    expect(momentIn('2026-09-19T20:30:00Z', evening, true, 'Asia/Dubai')).toBe('tomorrow 00:30');
  });

  it("names a later day in the viewer's zone", () => {
    expect(momentIn('2026-09-24T21:00:00Z', evening, false, 'Asia/Dubai')).toBe('Fri 25 Sep 01:00');
  });
});
