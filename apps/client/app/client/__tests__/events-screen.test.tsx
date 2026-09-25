import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { DocumentKind, LineupRow, PortalEvent, RoleSection } from '../rules';

/**
 * §11.1 against its ADR-0034 additions, state by state, as the first paint
 * draws them (static markup, so the list opens on the Upcoming tab with no
 * filters): the tab label, the "Next up" strip, the phone card's bar and
 * role split, the feedback nudge, the download's weight, the venue select
 * and the three empty states. The filtering itself is pinned in
 * list-rules.test.ts.
 */
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    prefetch: _prefetch,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    prefetch?: boolean;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { EmptyList, EventsScreen, TimesheetStatus } = await import('../EventsScreen');

const NOW = '2026-09-19T08:00:00Z'; // 09:00 BST, Sat 19 Sep

const event = (over: Partial<PortalEvent> & Pick<PortalEvent, 'id' | 'title'>): PortalEvent => ({
  venueName: 'Leonardo Royal Hotel',
  venueAddress: '10 Godliman St, EC4V 5AJ',
  eventDate: '2026-09-19',
  poNumber: null,
  onsiteContact: null,
  startsAt: '2026-09-19T06:00:00Z', // 07:00 BST
  endsAt: '2026-09-19T22:30:00Z', // 23:30 BST
  status: 'upcoming',
  ...over,
});

const gala = event({ id: 'ev-gala', title: 'Gala Dinner', status: 'ongoing', poNumber: '4471-A' });
const launch = event({
  id: 'ev-launch',
  title: 'Product Launch',
  venueName: 'The Shard',
  startsAt: '2026-09-26T17:00:00Z',
  endsAt: '2026-09-26T21:00:00Z',
});
const lunch = event({
  id: 'ev-lunch',
  title: 'Lunch Service',
  startsAt: '2026-09-12T10:00:00Z',
  endsAt: '2026-09-12T15:00:00Z',
  status: 'completed',
});

const sections: RoleSection[] = [
  {
    shiftId: 's-wait',
    eventId: 'ev-gala',
    role: 'Waiting',
    startsAt: '2026-09-19T16:00:00Z',
    endsAt: '2026-09-19T22:30:00Z',
    headcount: 10,
    confirmed: 8,
  },
  {
    shiftId: 's-bar',
    eventId: 'ev-gala',
    role: 'Bar',
    startsAt: '2026-09-19T17:00:00Z',
    endsAt: '2026-09-19T22:30:00Z',
    headcount: 7,
    confirmed: 5,
  },
  {
    shiftId: 's-launch',
    eventId: 'ev-launch',
    role: 'Waiting',
    startsAt: '2026-09-26T17:00:00Z',
    endsAt: '2026-09-26T21:00:00Z',
    headcount: 4,
    confirmed: 4,
  },
];

const worker = (name: string, eventId: string, feedbackGiven = false): LineupRow => ({
  bookingId: `b-${eventId}-${name}`,
  eventId,
  role: 'Waiting',
  startsAt: '2026-09-19T16:00:00Z',
  endsAt: '2026-09-19T22:30:00Z',
  name,
  photoPath: null,
  sortKey: name.toLowerCase(),
  feedbackGiven,
});

const lineup: LineupRow[] = [
  worker('Aisha Bello', 'ev-gala', true),
  worker('Luca Moretti', 'ev-gala'),
  worker('Tom Reid', 'ev-gala'),
  worker('Deleted account #4821', 'ev-gala'),
  worker('Priya Sharma', 'ev-launch'),
];

const render = (
  events: PortalEvent[],
  documents: Record<string, DocumentKind[]> = { 'ev-gala': ['allocation'] },
) =>
  renderToStaticMarkup(
    <EventsScreen
      events={events}
      sections={sections}
      lineup={lineup}
      photos={{}}
      documents={documents}
      now={NOW}
    />,
  );

/** The phone card for one event, cut out of the markup. */
const card = (markup: string, title: string): string => {
  const cards = markup.split('<div class="ecard');
  return cards.find((c) => c.includes(`<div class="t">${title}</div>`)) ?? '';
};

describe('the tabs fit a phone (ADR-0034)', () => {
  it('labels the first tab "Upcoming", still counting ongoing events in it', () => {
    const markup = render([gala, launch, lunch]);
    expect(markup).toContain('Upcoming<span class="n">2</span>');
    expect(markup).not.toContain('Upcoming &amp; ongoing');
  });
});

describe('the "Next up" strip (ADR-0034)', () => {
  it('points at the event running now, with its UK end time and its fill', () => {
    const markup = render([gala, launch, lunch]);
    const open = '<a href="/client/events/ev-gala" class="ev-next live">';
    expect(markup).toContain(open);
    const strip = markup.slice(markup.indexOf(open), markup.indexOf('ev-filters'));
    expect(strip).toContain('Happening now');
    expect(strip).toContain('<b>Gala Dinner</b>');
    expect(strip).toContain('until 23:30 UK');
    expect(strip).toContain('13 of 17 confirmed');
  });

  it('otherwise points at the next upcoming event', () => {
    const markup = render([launch, lunch]);
    expect(markup).toContain('class="ev-next"');
    expect(markup).toContain('>Next<');
    expect(markup).toContain('Sat 26 Sep 18:00 UK');
  });

  it('is absent when nothing is upcoming or ongoing', () => {
    expect(render([lunch])).not.toContain('ev-next');
  });
});

describe('the phone card carries the fill bar and the role split (§11.1, ADR-0034)', () => {
  it('draws the bar and "Waiting 8/10 · Bar 5/7" under "13 of 17 confirmed"', () => {
    const galaCard = card(render([gala]), 'Gala Dinner');
    expect(galaCard).toContain('<b>13</b> of 17 confirmed');
    expect(galaCard).toContain('role="progressbar"');
    expect(galaCard).toContain('Waiting 8/10');
    expect(galaCard).toContain('Bar 5/7');
    // Both short, so both amber.
    expect(galaCard.match(/class="short"/g)).toHaveLength(2);
  });

  it('shows the split in the desktop Confirmed cell too', () => {
    const markup = render([gala]);
    const table = markup.slice(0, markup.indexOf('class="cards"'));
    expect(table).toContain('class="ev-roles"');
  });

  it('leaves out a one-role split, which would repeat "N of M"', () => {
    const launchCard = card(render([launch]), 'Product Launch');
    expect(launchCard).toContain('role="progressbar"');
    expect(launchCard).not.toContain('ev-roles');
  });
});

describe('the feedback nudge (§11.2, ADR-0034)', () => {
  it('counts the workers still to rate on a started event, leaving out a removed one', () => {
    const galaCard = card(render([gala]), 'Gala Dinner');
    expect(galaCard).toContain(
      '<a href="/client/events/ev-gala" class="ev-nudge">Leave feedback · 2 of 3 to go</a>',
    );
  });

  it('never appears on an upcoming event', () => {
    expect(render([launch])).not.toContain('Leave feedback');
  });
});

describe('the document is the primary action (ADR-0034)', () => {
  it('fills a live download and pairs it with a bordered Details', () => {
    const galaCard = card(render([gala]), 'Gala Dinner');
    expect(galaCard).toContain(
      '<a class="btn sm primary" href="/client/events/ev-gala/document?kind=allocation">↓ Allocation sheet</a>',
    );
    expect(galaCard).toContain('<a href="/client/events/ev-gala" class="btn sm">Details →</a>');
  });

  it('keeps a copy not yet issued as the plain, disabled button', () => {
    const launchCard = card(render([launch]), 'Product Launch');
    expect(launchCard).toMatch(
      /<button[^>]*class="btn sm"[^>]*disabled=""[^>]*>↓ Allocation sheet/,
    );
    expect(launchCard).not.toContain('primary');
  });
});

describe("the signed timesheet's status (§11.3, ADR-0034)", () => {
  it('says plainly whether it has been issued', () => {
    expect(renderToStaticMarkup(<TimesheetStatus status="ready" />)).toContain(
      'Signed timesheet ready',
    );
    expect(renderToStaticMarkup(<TimesheetStatus status="pending" />)).toContain(
      'Timesheet not issued yet',
    );
  });

  it('is not drawn on an event that has not finished', () => {
    const markup = render([gala, launch]);
    expect(markup).not.toContain('Signed timesheet ready');
    expect(markup).not.toContain('Timesheet not issued yet');
  });
});

describe('the filters (ADR-0034)', () => {
  it('offers From and To dates and the search', () => {
    const markup = render([gala, launch]);
    expect(markup.match(/type="date"/g)).toHaveLength(2);
    expect(markup).toContain('>From</label>');
    expect(markup).toContain('>To</label>');
    expect(markup).toContain('placeholder="Search events"');
  });

  it('offers a venue select only when there is more than one venue', () => {
    expect(render([gala, launch])).toContain('<option value="" selected="">All venues</option>');
    expect(render([gala, launch])).toContain('<option value="The Shard">The Shard</option>');
    expect(render([gala])).not.toContain('All venues');
  });

  it('has no "Clear filters" until a filter is set', () => {
    expect(render([gala, launch])).not.toContain('Clear filters');
  });
});

describe('an empty list says why (ADR-0034)', () => {
  it('with no events at all', () => {
    const markup = render([]);
    expect(markup).toContain('No events yet');
    expect(markup).not.toContain('Clear filters');
    expect(markup).toContain('0 events');
  });

  it('with none in this tab, offering the others rather than "Clear filters"', () => {
    const markup = render([lunch]);
    expect(markup).toContain('You have no upcoming or ongoing events.');
    expect(markup).toContain('Show all events');
    expect(markup).not.toContain('Clear filters');
  });

  it('with every row hidden by the filters, offering "Clear filters"', () => {
    const noop = () => undefined;
    const markup = renderToStaticMarkup(
      <EmptyList
        reason="filters"
        tab="upcoming"
        hidden={2}
        onShowAll={noop}
        onClearFilters={noop}
      />,
    );
    expect(markup).toContain('No events match your filters');
    expect(markup).toContain('2 events in this tab are hidden by your search and filters.');
    expect(markup).toContain('Clear filters');
  });
});

describe('no money on the list (§11.1)', () => {
  it('prints no currency or rate anywhere', () => {
    const markup = render([gala, launch, lunch]);
    for (const word of ['£', 'rate', 'margin', 'per hour']) expect(markup).not.toContain(word);
  });
});
