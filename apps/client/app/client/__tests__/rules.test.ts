import { describe, expect, it } from 'vitest';
import {
  byDateDescending,
  documentFor,
  documentLink,
  feedbackErrorMessage,
  feedbackOpen,
  issuedByEvent,
  fillOf,
  filterByTab,
  groupBySection,
  statusTone,
} from '../rules';
import type { LineupRow, PortalEvent, RoleSection } from '../rules';

/** The Gala Dinner from wireframes/client/event.html: three roles, 17 staff. */
const section = (over: Partial<RoleSection> & Pick<RoleSection, 'role'>): RoleSection => ({
  shiftId: `shift-${over.role}`,
  eventId: 'ev-1',
  startsAt: '2026-09-19T06:00:00Z',
  endsAt: '2026-09-19T14:00:00Z',
  headcount: 2,
  confirmed: 2,
  ...over,
});

const person = (
  over: Partial<LineupRow> & Pick<LineupRow, 'name' | 'role' | 'sortKey'>,
): LineupRow => ({
  bookingId: `b-${over.name}`,
  eventId: 'ev-1',
  shiftId: `shift-${over.role}`,
  startsAt: '2026-09-19T06:00:00Z',
  endsAt: '2026-09-19T14:00:00Z',
  photoPath: null,
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
  onsiteContact: 'Marco Vitale · Banqueting manager',
  startsAt: '2026-09-19T06:00:00Z',
  endsAt: '2026-09-19T22:30:00Z',
  status: 'upcoming',
  ...over,
});

describe('"N of M confirmed" (§11.1)', () => {
  it('sums confirmed against the booked headcount', () => {
    const fill = fillOf([
      section({ role: 'Chef', headcount: 2, confirmed: 2 }),
      section({ role: 'Kitchen Porter', headcount: 3, confirmed: 3 }),
      section({ role: 'Waiting Staff', headcount: 12, confirmed: 12 }),
    ]);
    expect(fill).toEqual({ confirmed: 17, headcount: 17, percent: 100, tone: 'green' });
  });

  it('is amber while a section is short', () => {
    const fill = fillOf([
      section({ role: 'Chef', headcount: 4, confirmed: 4 }),
      section({ role: 'Waiting Staff', headcount: 13, confirmed: 9 }),
    ]);
    expect(fill.confirmed).toBe(13);
    expect(fill.headcount).toBe(17);
    expect(fill.tone).toBe('amber');
  });

  // The buffer is THC's own over-booking and never reaches the customer
  // (§3.2). client_role_sections_v does not return it, so M is headcount.
  it('never counts a buffer slot, because M is the headcount booked', () => {
    expect(fillOf([section({ role: 'Chef', headcount: 6, confirmed: 6 })])).toMatchObject({
      confirmed: 6,
      headcount: 6,
      percent: 100,
    });
  });

  it('does not divide by zero on an event with no sections', () => {
    expect(fillOf([])).toEqual({ confirmed: 0, headcount: 0, percent: 0, tone: 'green' });
  });

  it('clamps an over-filled section rather than showing 120%', () => {
    expect(fillOf([section({ role: 'Chef', headcount: 5, confirmed: 6 })]).percent).toBe(100);
  });
});

describe('the document button (§11.1, §11.3)', () => {
  it('offers the allocation sheet before the event', () => {
    expect(documentFor('upcoming')).toBe('allocation');
  });

  // §11.3: "No time restriction on when it can be emailed or downloaded —
  // the manager can send or download it at any point, including mid-event".
  it('still offers the allocation sheet during the event', () => {
    expect(documentFor('ongoing')).toBe('allocation');
  });

  it('becomes the signed timesheet once completed', () => {
    expect(documentFor('completed')).toBe('signout');
  });

  it('offers nothing for a cancelled event', () => {
    expect(documentFor('cancelled')).toBeNull();
  });
});

describe('when feedback unlocks (§11.2)', () => {
  const started = new Date('2026-09-19T06:00:00Z');

  it('is locked before the event window starts', () => {
    expect(feedbackOpen(event(), new Date('2026-09-19T05:59:59Z'))).toBe(false);
  });

  it('opens exactly at the start', () => {
    expect(feedbackOpen(event({ status: 'ongoing' }), started)).toBe(true);
  });

  // The scope sets no closing rule, so it stays open afterwards.
  it('stays open after the event completes', () => {
    expect(feedbackOpen(event({ status: 'completed' }), new Date('2026-09-25T00:00:00Z'))).toBe(
      true,
    );
  });

  it('is never open on a cancelled event, whatever the clock says', () => {
    expect(feedbackOpen(event({ status: 'cancelled' }), new Date('2026-09-25T00:00:00Z'))).toBe(
      false,
    );
  });
});

describe('the line-up, grouped and ordered (§11.2, §11.3)', () => {
  const sections = [
    section({
      role: 'Waiting Staff',
      startsAt: '2026-09-19T16:00:00Z',
      endsAt: '2026-09-19T22:30:00Z',
    }),
    section({ role: 'Chef', startsAt: '2026-09-19T06:00:00Z', endsAt: '2026-09-19T14:00:00Z' }),
  ];

  const lineup = [
    person({ name: 'Ben Ashworth', role: 'Waiting Staff', sortKey: 'ashworth' }),
    person({ name: 'Daniel Okafor', role: 'Chef', sortKey: 'okafor' }),
    person({ name: 'Luca Moretti', role: 'Chef', sortKey: 'moretti' }),
    person({ name: 'Chloe Baptiste', role: 'Waiting Staff', sortKey: 'baptiste' }),
  ];

  it('orders role groups by the role window, not alphabetically (RULE-18)', () => {
    expect(groupBySection(lineup, sections).map((g) => g.role)).toEqual(['Chef', 'Waiting Staff']);
  });

  it('orders people inside a role by surname, as the PDF does (§11.3)', () => {
    const groups = groupBySection(lineup, sections);
    const chef = groups.find((g) => g.role === 'Chef');
    const waiting = groups.find((g) => g.role === 'Waiting Staff');
    expect(chef?.people.map((p) => p.name)).toEqual(['Luca Moretti', 'Daniel Okafor']);
    expect(waiting?.people.map((p) => p.name)).toEqual(['Ben Ashworth', 'Chloe Baptiste']);
  });

  it('carries the role window and the confirmed count onto the group header', () => {
    const chef = groupBySection(lineup, sections).find((g) => g.role === 'Chef');
    expect(chef?.startsAt).toBe('2026-09-19T06:00:00Z');
    expect(chef?.confirmed).toBe(2);
  });

  // §1.7: a removed worker stays on a past line-up as "Deleted account #id"
  // so the headcount is not skewed. Their sort key is the anonymised label,
  // never the real surname the row no longer shows.
  it('keeps a removed worker on the line-up, sorted last', () => {
    const withRemoved = [
      ...lineup,
      person({ name: 'Deleted account #1042', role: 'Chef', sortKey: 'zzzz-deleted-1042' }),
    ];
    const chef = groupBySection(withRemoved, sections).find((g) => g.role === 'Chef');
    expect(chef?.people.map((p) => p.name)).toEqual([
      'Luca Moretti',
      'Daniel Okafor',
      'Deleted account #1042',
    ]);
    expect(chef?.confirmed).toBe(3);
  });

  it('does not drop a role that has no matching section row', () => {
    const orphan = [person({ name: 'Ada Byron', role: 'Mixologist', sortKey: 'byron' })];
    expect(groupBySection(orphan, []).map((g) => g.role)).toEqual(['Mixologist']);
  });

  // Two sections of one role are two groups, each under its own window,
  // exactly as the PDF keys them by shift id. Grouping by role name merged
  // them under the first section's window.
  it('keeps two sections of one role apart, each with its own window', () => {
    const twoShifts = [
      section({
        shiftId: 'ws-am',
        role: 'Waiting Staff',
        startsAt: '2026-09-19T06:00:00Z',
        endsAt: '2026-09-19T14:00:00Z',
      }),
      section({
        shiftId: 'ws-pm',
        role: 'Waiting Staff',
        startsAt: '2026-09-19T16:00:00Z',
        endsAt: '2026-09-19T22:30:00Z',
      }),
    ];
    const people = [
      person({
        name: 'Chloe Baptiste',
        role: 'Waiting Staff',
        sortKey: 'baptiste',
        shiftId: 'ws-pm',
      }),
      person({
        name: 'Ben Ashworth',
        role: 'Waiting Staff',
        sortKey: 'ashworth',
        shiftId: 'ws-am',
      }),
      person({ name: 'Tom Reid', role: 'Waiting Staff', sortKey: 'reid', shiftId: 'ws-pm' }),
    ];
    const groups = groupBySection(people, twoShifts);
    expect(groups.map((g) => [g.key, g.role, g.startsAt, g.confirmed])).toEqual([
      ['ws-am', 'Waiting Staff', '2026-09-19T06:00:00Z', 1],
      ['ws-pm', 'Waiting Staff', '2026-09-19T16:00:00Z', 2],
    ]);
    expect(groups[1]?.endsAt).toBe('2026-09-19T22:30:00Z');
    expect(groups[1]?.people.map((p) => p.name)).toEqual(['Chloe Baptiste', 'Tom Reid']);
  });

  it('falls back to role + window when a row has no shift id, as the PDF does', () => {
    const people = [
      person({
        name: 'Ben Ashworth',
        role: 'Waiting Staff',
        sortKey: 'ashworth',
        shiftId: null,
        startsAt: '2026-09-19T06:00:00Z',
      }),
      person({
        name: 'Tom Reid',
        role: 'Waiting Staff',
        sortKey: 'reid',
        shiftId: null,
        startsAt: '2026-09-19T16:00:00Z',
      }),
    ];
    expect(groupBySection(people, []).map((g) => g.startsAt)).toEqual([
      '2026-09-19T06:00:00Z',
      '2026-09-19T16:00:00Z',
    ]);
  });
});

describe('the list download links (§11.1)', () => {
  it('links to the document route once the office has issued that kind', () => {
    expect(documentLink(event({ id: 'ev-9' }), ['allocation'])).toEqual({
      kind: 'allocation',
      href: '/client/events/ev-9/document?kind=allocation',
    });
    expect(
      documentLink(event({ id: 'ev-9', status: 'completed' }), ['allocation', 'signout']),
    ).toEqual({
      kind: 'signout',
      href: '/client/events/ev-9/document?kind=signout',
    });
  });

  it('offers the right kind but no link while nothing is issued', () => {
    expect(documentLink(event(), [])).toEqual({ kind: 'allocation', href: null });
    // An allocation sheet is not a stand-in for the signed timesheet.
    expect(documentLink(event({ status: 'completed' }), ['allocation'])).toEqual({
      kind: 'signout',
      href: null,
    });
  });

  it('offers nothing for a cancelled event, even if a document exists', () => {
    expect(documentLink(event({ status: 'cancelled' }), ['allocation'])).toBeNull();
  });

  it('reads the documents view once and folds it per event', () => {
    expect(
      issuedByEvent([
        { event_id: 'a', kind: 'allocation' },
        { event_id: 'a', kind: 'signout' },
        { event_id: 'b', kind: 'allocation' },
        { event_id: 'b', kind: 'allocation' },
        { event_id: 'c', kind: 'something-else' },
      ]),
    ).toEqual({ a: ['allocation', 'signout'], b: ['allocation'] });
  });
});

describe('feedback refusals in the customer’s words (§11.5)', () => {
  it('tells a bad rating apart from an event that has not started (both 22023)', () => {
    expect(feedbackErrorMessage({ code: '22023', message: 'Rating must be between 1 and 5' })).toBe(
      'Choose a rating between 1 and 5 stars.',
    );
    expect(
      feedbackErrorMessage({ code: '22023', message: 'Feedback opens once the event has started' }),
    ).toBe('Feedback opens once the event has started.');
  });

  it('does not guess when a 22023 says neither', () => {
    expect(feedbackErrorMessage({ code: '22023', message: 'something else' })).toBe(
      'That could not be saved.',
    );
  });

  it('keeps the other refusals', () => {
    expect(feedbackErrorMessage({ code: '23505' })).toMatch(/already been left/);
    expect(feedbackErrorMessage({ code: '42501' })).toMatch(/not on one of your events/);
    expect(feedbackErrorMessage({ code: 'XX000', message: 'boom' })).toBe(
      'That could not be saved.',
    );
  });

  it('never shows a section number or rule id to the customer', () => {
    for (const code of ['22023', '23505', '42501', null]) {
      for (const message of [
        'Rating must be between 1 and 5',
        'Feedback opens once the event has started',
        'x',
      ]) {
        expect(feedbackErrorMessage({ code, message })).not.toMatch(/§|RULE-/);
      }
    }
  });
});

describe('the Upcoming / Past / All tabs (§11.1)', () => {
  const now = new Date('2026-09-19T12:00:00Z');
  const ongoing = event({
    id: 'now',
    startsAt: '2026-09-19T06:00:00Z',
    endsAt: '2026-09-19T22:30:00Z',
    status: 'ongoing',
  });
  const future = event({
    id: 'later',
    startsAt: '2026-09-26T11:00:00Z',
    endsAt: '2026-09-26T19:00:00Z',
  });
  const past = event({
    id: 'before',
    startsAt: '2026-09-12T07:00:00Z',
    endsAt: '2026-09-12T16:00:00Z',
    status: 'completed',
  });
  const all = [ongoing, future, past];

  it('keeps an event that is running now in Upcoming, not Past', () => {
    expect(filterByTab(all, 'upcoming', now).map((e) => e.id)).toEqual(['now', 'later']);
  });

  it('files an event in Past only once its window has ended', () => {
    expect(filterByTab(all, 'past', now).map((e) => e.id)).toEqual(['before']);
  });

  it('All shows everything', () => {
    expect(filterByTab(all, 'all', now)).toHaveLength(3);
  });

  it('keeps a cancelled event in the list rather than hiding it', () => {
    const cancelled = event({
      id: 'off',
      status: 'cancelled',
      startsAt: '2026-09-21T17:00:00Z',
      endsAt: '2026-09-21T21:00:00Z',
    });
    expect(filterByTab([cancelled], 'upcoming', now).map((e) => e.id)).toEqual(['off']);
  });

  it('orders newest first', () => {
    expect(byDateDescending(all).map((e) => e.id)).toEqual(['later', 'now', 'before']);
  });
});

describe('status pills', () => {
  it('matches the wireframe tones', () => {
    expect(statusTone('ongoing')).toBe('green');
    expect(statusTone('upcoming')).toBe('cyan');
    expect(statusTone('completed')).toBe('neutral');
    expect(statusTone('cancelled')).toBe('neutral');
  });
});
