import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NO_FILTERS, applyFilters, foldName, lineupNames, staffMatching } from '../rules';
import type { LineupRow, PortalEvent } from '../rules';

/**
 * "Which events was Priya on?" (ADR-0134 N5): the list's search also finds
 * an event by a worker on its line-up — only the line-ups already loaded
 * (the window read, each held to its headcount), never a removed worker's
 * label — and the row says who matched.
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
let query = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(query),
}));
afterEach(() => {
  query = '';
});

const { EventsScreen, EmptyList } = await import('../EventsScreen');

const ev = (id: string, title: string, over: Partial<PortalEvent> = {}): PortalEvent => ({
  id,
  title,
  venueName: 'Leonardo Royal Hotel',
  venueAddress: '10 Godliman St',
  eventDate: '2026-10-20',
  poNumber: null,
  onsiteContact: null,
  startsAt: '2026-10-20T16:00:00Z',
  endsAt: '2026-10-20T22:30:00Z',
  status: 'upcoming',
  ...over,
});

const person = (eventId: string, name: string): LineupRow => ({
  bookingId: `${eventId}-${name}`,
  eventId,
  shiftId: 's',
  role: 'Waiting Staff',
  startsAt: '2026-10-20T16:00:00Z',
  endsAt: '2026-10-20T22:30:00Z',
  name,
  sortKey: name.toLowerCase(),
  feedbackGiven: false,
});

const gala = ev('ev-gala', 'Gala Dinner');
const lunch = ev('ev-lunch', 'Lunch Service', {
  startsAt: '2026-10-21T10:00:00Z',
  endsAt: '2026-10-21T15:00:00Z',
});
const lineup = [
  person('ev-gala', 'Priya Shah'),
  person('ev-gala', 'Zoë Adams'),
  person('ev-lunch', 'Tom Reid'),
  person('ev-lunch', 'Deleted account #1042'),
];

describe('the rules', () => {
  it('folds case, accents and spaces', () => {
    expect(foldName('  Zoë   ADAMS ')).toBe('zoe adams');
  });

  it('lists each event’s names once, leaving a removed worker out', () => {
    const names = lineupNames([...lineup, person('ev-gala', 'Priya Shah')]);
    expect(names.get('ev-gala')).toEqual(['Priya Shah', 'Zoë Adams']);
    expect(names.get('ev-lunch')).toEqual(['Tom Reid']);
  });

  it('finds the events a person was on, by any part of their name', () => {
    const names = lineupNames(lineup);
    const find = (q: string) =>
      applyFilters([gala, lunch], { ...NO_FILTERS, query: q }, names).map((e) => e.id);
    expect(find('priya')).toEqual(['ev-gala']);
    expect(find('zoe')).toEqual(['ev-gala']);
    expect(find('REID')).toEqual(['ev-lunch']);
    // The event's own fields still match as before.
    expect(find('lunch')).toEqual(['ev-lunch']);
    // "Deleted account #1042" is not a person to search for.
    expect(find('deleted')).toEqual([]);
    expect(find('1042')).toEqual([]);
  });

  it('without the names, the search is the event search it was', () => {
    expect(applyFilters([gala, lunch], { ...NO_FILTERS, query: 'priya' })).toEqual([]);
  });

  it('says who matched, and nobody for an empty box', () => {
    expect(staffMatching(['Priya Shah', 'Zoë Adams'], 'a')).toEqual(['Priya Shah', 'Zoë Adams']);
    expect(staffMatching(['Priya Shah'], 'shah')).toEqual(['Priya Shah']);
    expect(staffMatching(['Priya Shah'], '  ')).toEqual([]);
    expect(staffMatching(undefined, 'x')).toEqual([]);
  });
});

describe('the list', () => {
  const render = () =>
    renderToStaticMarkup(
      <EventsScreen
        events={[gala, lunch]}
        sections={[]}
        lineup={lineup}
        photos={{}}
        now="2026-10-14T09:00:00Z"
      />,
    );

  it('labels the box for both', () => {
    const html = render();
    expect(html).toContain('placeholder="Search events or staff"');
    expect(html).toContain('Search events or staff');
  });

  it('shows the events a person was on, and says who', () => {
    query = 'q=priya';
    const html = render();
    expect(html).toContain('Gala Dinner');
    expect(html).not.toContain('Lunch Service');
    expect(html).toContain('On the line-up: Priya Shah');
  });

  it('says nothing about the line-up when the event matched on its own fields', () => {
    query = 'q=gala';
    expect(render()).not.toContain('On the line-up');
  });

  it('offers older events when a search finds nobody in the loaded window', () => {
    const html = renderToStaticMarkup(
      <EmptyList
        reason="filters"
        tab="all"
        hidden={2}
        onShowAll={() => {}}
        onClearFilters={() => {}}
        older={{ since: '2026-07-16', href: '/client?q=priya&since=2026-04-17' }}
        searching
      />,
    );
    expect(html).toContain('Search older events too');
    expect(html).toContain('href="/client?q=priya&amp;since=2026-04-17"');
    const plain = renderToStaticMarkup(
      <EmptyList
        reason="filters"
        tab="all"
        hidden={2}
        onShowAll={() => {}}
        onClearFilters={() => {}}
        older={{ since: '2026-07-16', href: '/client?since=2026-04-17' }}
      />,
    );
    expect(plain).not.toContain('Search older events too');
  });
});
