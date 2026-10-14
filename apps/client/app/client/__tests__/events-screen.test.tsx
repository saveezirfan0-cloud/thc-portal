import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocumentKind, LineupRow, PortalEvent, RoleSection } from '../rules';

/**
 * §11.1 against its ADR-0049 additions, state by state, as the first paint
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

/** The address bar the list reads its tab and filters from (`useListState`). */
let query = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(query),
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
  shiftId: null,
  role: 'Waiting',
  startsAt: '2026-09-19T16:00:00Z',
  endsAt: '2026-09-19T22:30:00Z',
  name,
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

describe('the tabs fit a phone (ADR-0049)', () => {
  it('labels the first tab "Upcoming", still counting ongoing events in it', () => {
    const markup = render([gala, launch, lunch]);
    expect(markup).toContain('Upcoming<span class="n">2</span>');
    expect(markup).not.toContain('Upcoming &amp; ongoing');
  });

  it('counts only live events on the tabs, while still listing a cancelled one (CW-14)', () => {
    const called = event({
      id: 'ev-off',
      title: 'Rooftop Reception',
      startsAt: '2026-09-21T17:00:00Z',
      endsAt: '2026-09-21T21:00:00Z',
      status: 'cancelled',
    });
    const markup = render([gala, launch, called, lunch]);
    expect(markup).toContain('Upcoming<span class="n">2</span>');
    expect(markup).toContain('Past<span class="n">1</span>');
    // Listed, greyed, all the same — and in the panel's own count.
    expect(markup).toContain('<tr class="cancelled">');
    expect(markup).toContain('3 events');
  });
});

describe('the "Next up" strip (ADR-0049)', () => {
  it('points at the event running now, with its UK end time and its fill', () => {
    const markup = render([gala, launch, lunch]);
    const open = '<a href="/client/events/ev-gala" class="ev-next live">';
    expect(markup).toContain(open);
    const strip = markup.slice(markup.indexOf(open), markup.indexOf('ev-filters'));
    expect(strip).toContain('Happening now');
    expect(strip).toContain('<b>Gala Dinner</b>');
    expect(strip).toContain('until 23:30 UK time');
    expect(strip).toContain('13 of 17 confirmed');
  });

  it('otherwise points at the next upcoming event', () => {
    const markup = render([launch, lunch]);
    expect(markup).toContain('class="ev-next"');
    expect(markup).toContain('>Next<');
    expect(markup).toContain('Sat 26 Sep 18:00 UK time');
  });

  it('is absent when nothing is upcoming or ongoing', () => {
    expect(render([lunch])).not.toContain('ev-next');
  });
});

describe('the phone card carries the fill bar and the role split (§11.1, ADR-0049)', () => {
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

describe('the feedback nudge (§11.2, ADR-0049)', () => {
  it('counts the workers still to rate on a started event, leaving out a removed one', () => {
    const galaCard = card(render([gala]), 'Gala Dinner');
    // Short enough for one line in the Status column; the whole sentence is
    // the link's accessible name, which starts with the words on screen.
    expect(galaCard).toContain(
      '<a href="/client/events/ev-gala" class="ev-nudge" aria-label="Feedback: 2 to go. Leave feedback for 2 of 3 workers">Feedback: 2 to go</a>',
    );
  });

  it('never appears on an upcoming event', () => {
    expect(render([launch])).not.toContain('Leave feedback');
  });
});

describe('the document is the primary action (ADR-0049)', () => {
  it('fills a live download and pairs it with a bordered Details', () => {
    const galaCard = card(render([gala]), 'Gala Dinner');
    expect(galaCard).toContain(
      '<a class="btn sm primary" href="/client/events/ev-gala/document?kind=allocation">↓ Allocation Timesheet</a>',
    );
    expect(galaCard).toContain('<a href="/client/events/ev-gala" class="btn sm">Details →</a>');
  });

  it('draws no dead button for a copy not yet issued: a quiet line, and Details (CW-04)', () => {
    const launchCard = card(render([launch]), 'Product Launch');
    expect(launchCard).not.toMatch(/<button[^>]*disabled=""/);
    expect(launchCard).not.toContain('↓ Allocation Timesheet');
    expect(launchCard).not.toContain('primary');
    // In the foot, where the download would be, beside "Details →".
    expect(launchCard).toContain(
      '<div class="foot"><span class="ev-sheet muted doc-pending">Allocation Timesheet: sent the day before, once every role is confirmed</span><a href="/client/events/ev-launch" class="btn sm">Details →</a></div>',
    );
  });
});

describe("the signed timesheet's status (§11.3, ADR-0049)", () => {
  it('says plainly whether it has been issued', () => {
    expect(renderToStaticMarkup(<TimesheetStatus status="ready" />)).toContain(
      'Completed Timesheet ready',
    );
    expect(renderToStaticMarkup(<TimesheetStatus status="pending" />)).toContain(
      'Timesheet not issued yet',
    );
  });

  it('is not drawn on an event that has not finished', () => {
    const markup = render([gala, launch]);
    expect(markup).not.toContain('Completed Timesheet ready');
    expect(markup).not.toContain('>Timesheet not issued yet<');
  });
});

describe('the filters (ADR-0049)', () => {
  it('offers From and To dates and the search', () => {
    const markup = render([gala, launch]);
    // Typed dd/mm/yyyy (CW-03), never a bare native date box: the only
    // type="date" inputs left are the hidden calendar shortcuts.
    expect(
      markup.match(
        /<input[^>]*type="text"[^>]*inputMode="numeric"[^>]*placeholder="dd\/mm\/yyyy"/g,
      ),
    ).toHaveLength(2);
    expect(
      markup.match(/<input class="ukd-native" type="date" tabindex="-1" aria-hidden="true"/g),
    ).toHaveLength(2);
    expect(markup).toContain('>From (UK date)</label>');
    expect(markup).toContain('>To (UK date)</label>');
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

describe('an empty list says why (ADR-0049)', () => {
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

describe('arrival counts on the day (ADR-0053)', () => {
  const counts = (confirmed: number, arrived: number) => ({ confirmed, arrived, bySection: {} });
  // The gala as client_arrivals_v sends it: per section, Waiting 8 (7 in)
  // and Bar 5 (4 in).
  const gala13 = {
    confirmed: 13,
    arrived: 11,
    bySection: { 's-wait': { confirmed: 8, arrived: 7 }, 's-bar': { confirmed: 5, arrived: 4 } },
  };
  const withArrivals = (events: PortalEvent[], over: RoleSection[] = sections) =>
    renderToStaticMarkup(
      <EventsScreen
        events={events}
        sections={over}
        lineup={lineup}
        photos={{}}
        arrivals={{ 'ev-gala': gala13, 'ev-lunch': counts(4, 4) }}
        now={NOW}
      />,
    );

  it('holds each section to its headcount, so the buffer never shows (CW-01)', () => {
    // Bar booked 7, with 5 confirmed; Waiting booked 4 but carries 8 —
    // THC's buffer. "N of M arrived" counts at most 4 of the 8.
    const overfilled = sections.map((s) => (s.shiftId === 's-wait' ? { ...s, headcount: 4 } : s));
    const markup = withArrivals([gala], overfilled);
    expect(markup).toContain('8 of 9 arrived');
    expect(markup).not.toContain('11 of 13 arrived');
  });

  it('shows "N of M arrived" on the ongoing event, in the table and on the card', () => {
    const markup = withArrivals([gala]);
    expect(markup.match(/11 of 13 arrived/g)).toHaveLength(2);
    expect(card(markup, 'Gala Dinner')).toContain('11 of 13 arrived');
  });

  it('shows nothing for an event that is not live, even when the view has a row', () => {
    expect(withArrivals([lunch])).not.toContain('arrived');
  });
});

describe('no money on the list (§11.1)', () => {
  it('prints no currency or rate anywhere', () => {
    const markup = render([gala, launch, lunch]);
    for (const word of ['£', 'rate', 'margin', 'per hour']) expect(markup).not.toContain(word);
  });
});

afterEach(() => {
  query = '';
});

/** The table's rows, in order, by title. */
const tableOrder = (markup: string): string[] => {
  const table = markup.slice(markup.indexOf('<tbody>'), markup.indexOf('</tbody>'));
  return [...table.matchAll(/<td><b>(?:<s>)?([^<]+)/g)].map((m) => m[1]!);
};

const older = event({
  id: 'ev-old',
  title: 'Spring Ball',
  startsAt: '2026-04-11T17:00:00Z',
  endsAt: '2026-04-11T22:00:00Z',
  status: 'completed',
});

describe('the order of each tab (product owner, 12.10.2026)', () => {
  it('lists Upcoming soonest first', () => {
    expect(tableOrder(render([launch, gala]))).toEqual(['Gala Dinner', 'Product Launch']);
    expect(render([launch, gala])).toContain('only your events · soonest first');
  });

  it('keeps Past and All newest first', () => {
    query = 'tab=past';
    expect(tableOrder(render([older, lunch]))).toEqual(['Lunch Service', 'Spring Ball']);
    expect(render([older, lunch])).toContain('only your events · newest first');
    query = 'tab=all';
    expect(tableOrder(render([older, gala, launch, lunch]))).toEqual([
      'Product Launch',
      'Gala Dinner',
      'Lunch Service',
      'Spring Ball',
    ]);
  });
});

describe('the tab and filters live in the address bar', () => {
  it('opens the tab the URL names', () => {
    query = 'tab=past';
    const markup = render([gala, lunch]);
    expect(markup).toMatch(/class="on"[^>]*>Past/);
    expect(tableOrder(markup)).toEqual(['Lunch Service']);
  });

  it('applies the search, venue and dates from the URL and offers "Clear filters"', () => {
    query = 'q=launch';
    expect(tableOrder(render([gala, launch]))).toEqual(['Product Launch']);
    expect(render([gala, launch])).toContain('value="launch"');
    expect(render([gala, launch])).toContain('Clear filters');

    query = 'venue=The+Shard';
    expect(render([gala, launch])).toContain('<option value="The Shard" selected="">');
    expect(tableOrder(render([gala, launch]))).toEqual(['Product Launch']);

    query = 'from=2026-09-20&to=2026-09-30';
    expect(tableOrder(render([gala, launch]))).toEqual(['Product Launch']);
    expect(render([gala, launch])).toContain('value="2026-09-20"');
  });

  it('ignores what it cannot read', () => {
    query = 'tab=nonsense&from=yesterday';
    const markup = render([gala, launch]);
    expect(tableOrder(markup)).toEqual(['Gala Dinner', 'Product Launch']);
    expect(markup).not.toContain('Clear filters');
  });
});

describe('a cancelled event (§11.1)', () => {
  const rooftop = event({
    id: 'ev-roof',
    title: 'Rooftop Reception',
    startsAt: '2026-09-21T17:00:00Z',
    endsAt: '2026-09-21T21:00:00Z',
    status: 'cancelled',
    cancelledAt: '2026-09-16T10:12:00Z',
  });

  it('strikes the title, prints "PO —" and the day it was cancelled, on the table and the card', () => {
    const markup = render([rooftop]);
    expect(markup).toContain('<tr class="cancelled">');
    expect(markup).toContain('<s>Rooftop Reception</s>');
    expect(markup).toContain('<span class="sub">cancelled 16 Sep</span>');
    const c = card(markup, '<s>Rooftop Reception</s>');
    expect(c).toContain('PO —');
    expect(c).toContain('cancelled 16 Sep');
    expect(c).toContain('No document');
  });

  it('is greyed by colour, not faded (the card text stays legible)', () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'client-portal.css'),
      'utf8',
    );
    const at = css.indexOf('.ecard.cancelled,\n.ecard.cancelled .t {');
    expect(at).toBeGreaterThan(-1);
    const rule = css.slice(at, css.indexOf('}', at));
    expect(rule).not.toContain('opacity');
    expect(rule).toContain('var(--muted)');
  });
});

describe('the rows open the event (wireframe tr.clickable)', () => {
  it('marks a live row clickable and keeps its Details link as the real target', () => {
    const markup = render([gala]);
    expect(markup).toContain('<tr class="clickable">');
    expect(markup).toContain(
      '<a href="/client/events/ev-gala" class="sm ev-details">Details →</a>',
    );
    // Not a focus stop of its own.
    expect(markup).not.toMatch(/<tr[^>]*tabindex/);
  });
});

describe('the venue folds under the event name at tablet width', () => {
  it('prints the venue twice: its own column, and a sub-line the CSS shows ≤1180px', () => {
    const markup = render([gala]);
    expect(markup).toContain('<th class="col-venue">Venue</th>');
    expect(markup).toContain(
      '<span class="sub venue-inline">Leonardo Royal Hotel, 10 Godliman St, EC4V 5AJ</span>',
    );
  });
});

describe('the table folds to four columns on a tablet (§1.2, wireframe tablet note)', () => {
  it('marks the Status and Line-up columns so the CSS can fold them', () => {
    const table = render([gala]).slice(0, render([gala]).indexOf('class="cards"'));
    expect(table).toContain('<th class="col-status">Status</th>');
    expect(table).toContain('<th class="col-lineup">Line-up</th>');
    expect(table).toContain('<td class="col-status">');
    expect(table).toContain('<td class="col-lineup">');
  });

  it('prints the status under the date and the faces under the fill bar as well', () => {
    const table = render([gala]).slice(0, render([gala]).indexOf('class="cards"'));
    // Twice each: its own column, and the folded copy the CSS shows ≤1100px / ≤1279px.
    expect(
      table.match(/<span class="pill green"><i class="dot"><\/i>Ongoing<\/span>/g),
    ).toHaveLength(2);
    expect(table).toMatch(/<div class="stack tight status-inline"><span class="pill green">/);
    expect(table).toMatch(/<div class="faces-inline"><span class="avatars">/);
  });

  it('lets the window wrap only between its pieces in the Date cell', () => {
    const table = render([gala]).slice(0, render([gala]).indexOf('class="cards"'));
    expect(table).toContain('<span class="sub"><span class="wseg">07:00 – 23:30 UK time</span>');
  });

  it('folds by CSS: Venue and Line-up ≤1279px, Status ≤1100px', () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'client-portal.css'),
      'utf8',
    );
    const at = (q: string) => css.slice(css.indexOf(`@media (max-width: ${q})`)).split('\n}\n')[0];
    expect(at('1279px')).toMatch(/\.tbl \.col-venue,\s*\.tbl \.col-lineup \{\s*display: none;/);
    expect(at('1100px')).toMatch(/\.tbl \.col-status \{\s*display: none;/);
  });
});

describe('a document not issued yet says so in words', () => {
  it('says when it comes, in the Document cell and on the card, with no button (CW-04)', () => {
    const markup = render([launch]);
    const table = markup.slice(0, markup.indexOf('class="cards"'));
    expect(table).toContain(
      '<div class="stack tight ev-doc"><span class="ev-sheet muted doc-pending">Allocation Timesheet: sent the day before, once every role is confirmed</span><a href="/client/events/ev-launch" class="sm ev-details">Details →</a></div>',
    );
    expect(card(markup, 'Product Launch')).toContain('sent the day before');
  });

  it('on the day, or once running, says only that it is not issued yet', () => {
    // The gala is running and nothing was issued: "sent the day before"
    // would be a promise already broken.
    const markup = render([gala], {});
    expect(markup).toContain('Allocation Timesheet not issued yet');
    expect(markup).not.toContain('sent the day before');
  });

  it('a completed event without a final copy says so, with no button', () => {
    query = 'tab=past';
    const markup = render([lunch], { 'ev-lunch': ['allocation'] });
    const table = markup.slice(0, markup.indexOf('class="cards"'));
    expect(table).toContain('<td><b>Lunch Service</b>');
    expect(table).toContain(
      '<span class="ev-sheet muted doc-pending">Completed Timesheet not issued yet</span>',
    );
    expect(markup).not.toMatch(/<button[^>]*disabled=""[^>]*>↓/);
  });

  it('says nothing extra once the document is live', () => {
    expect(render([gala])).not.toContain('not issued yet');
    expect(render([gala])).not.toContain('sent the day before');
  });
});

describe('the page head says when it was read', () => {
  it('stamps the read time in UK time on the first paint', () => {
    expect(render([gala])).toContain('as of <b>Sat 19 Sep 2026, 09:00 UK time</b>');
  });
});

describe('a reversed date range (CW-03)', () => {
  it('says the dates are the wrong way round, not "No events match your filters"', () => {
    query = 'tab=all&from=2026-09-20&to=2026-09-10';
    const markup = render([gala, launch, lunch]);
    expect(markup).toContain('<h3>The dates are the wrong way round</h3>');
    expect(markup).toContain('“From” (20/09/2026) is after “To” (10/09/2026).');
    expect(markup).toContain('>Swap the dates</button>');
    expect(markup).not.toContain('No events match your filters');
    // And on the "To" box itself, where the customer is looking.
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('Before the “From” date.');
  });
});
