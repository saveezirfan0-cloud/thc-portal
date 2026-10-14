import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { LineupRow, PortalEvent } from '../rules';

/**
 * The event list's bounded read (R1): which past window an address asks
 * for, that every "+1" read stays under PostgREST's `max_rows` (or the cap
 * would bite first and the truncation could never be seen), which faces are
 * signed, and what the screen says about history before the window.
 */
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
let query = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(query),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({}) }));

const { PAST_WINDOW_DAYS, addDays, olderQuery, pastWindow, sameWindow, validDay, withSince } =
  await import('../window');
const { LIST_LIMITS } = await import('../data');
const { DOCUMENTS_PER_READ } = await import('../documents');
const { FACES_SHOWN, listFaces } = await import('../rules');
const { EventsScreen } = await import('../EventsScreen');

const TODAY = '2026-10-14';
const at = (q: string) => pastWindow(new URLSearchParams(q), TODAY);

describe('pastWindow', () => {
  it('defaults to 90 UK days back, up to now', () => {
    expect(PAST_WINDOW_DAYS).toBe(90);
    expect(at('')).toEqual({ since: '2026-07-16', until: null });
  });

  it('ignores the tab, the search and the venue: they filter rows already read', () => {
    expect(at('tab=past&q=gala&venue=The%20Shard')).toEqual(at(''));
  });

  it('"From" is the bound, older or newer than the default', () => {
    expect(at('from=2024-01-01')).toEqual({ since: '2024-01-01', until: null });
    expect(at('from=2026-10-01&to=2026-10-31')).toEqual({
      since: '2026-10-01',
      until: '2026-10-31',
    });
  });

  it('"To" alone pages back to end on that day; a future "To" keeps the default start', () => {
    expect(at('to=2025-03-31')).toEqual({ since: '2024-12-31', until: '2025-03-31' });
    expect(at('to=2026-12-31')).toEqual({ since: '2026-07-16', until: '2026-12-31' });
  });

  it('`since` only widens', () => {
    expect(at('since=2026-01-01')).toEqual({ since: '2026-01-01', until: null });
    expect(at('since=2026-09-01')).toEqual({ since: '2026-07-16', until: null });
  });

  it('a hand-edited date that is not a calendar day is no bound', () => {
    for (const bad of ['2026-02-30', '2026-13-01', 'yesterday', '20261001']) {
      expect(validDay(bad)).toBe('');
      expect(at(`from=${bad}&since=${bad}`)).toEqual(at(''));
    }
  });

  it('adds days across a month and a year', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('carries `since` through the list query, and "Show older" goes 90 days further', () => {
    expect(withSince('tab=past', '2026-04-17')).toBe('tab=past&since=2026-04-17');
    expect(withSince('tab=past', 'junk')).toBe('tab=past');
    expect(olderQuery('tab=past', { since: '2026-07-16', until: null })).toBe(
      'tab=past&since=2026-04-17',
    );
    expect(sameWindow(at('since=2026-04-17'), { since: '2026-04-17', until: null })).toBe(true);
    expect(sameWindow(at('from=2026-04-17'), at(''))).toBe(false);
  });
});

describe('every bounded read stays under PostgREST max_rows', () => {
  const config = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../../../../supabase/config.toml'),
    'utf8',
  );
  const maxRows = Number(/^max_rows\s*=\s*(\d+)/m.exec(config)?.[1]);

  it('reads max_rows from supabase/config.toml', () => {
    expect(maxRows).toBeGreaterThan(0);
  });

  it('asks for at most max_rows, so the one-over row can always arrive', () => {
    expect(LIST_LIMITS.events + 1).toBeLessThanOrEqual(maxRows);
    expect(LIST_LIMITS.page + 1).toBeLessThanOrEqual(maxRows);
    expect(DOCUMENTS_PER_READ + 1).toBeLessThanOrEqual(maxRows);
  });
});

const event = (id: string, status: PortalEvent['status'] = 'completed'): PortalEvent => ({
  id,
  title: `Event ${id}`,
  venueName: 'Leonardo Royal Hotel',
  venueAddress: '10 Godliman St',
  eventDate: '2026-09-19',
  poNumber: null,
  onsiteContact: null,
  startsAt: '2026-09-19T06:00:00Z',
  endsAt: '2026-09-19T22:30:00Z',
  status,
});
const worker = (eventId: string, sortKey: string): LineupRow => ({
  bookingId: `${eventId}-${sortKey}`,
  eventId,
  shiftId: null,
  role: 'Waiting',
  startsAt: '2026-09-19T06:00:00Z',
  endsAt: '2026-09-19T22:30:00Z',
  name: sortKey,
  sortKey,
  feedbackGiven: false,
});

describe('listFaces', () => {
  it('is the first faces of each drawn row, in the row’s order; none for a cancelled event', () => {
    const lineup = [
      ...'hgfedcba'.split('').map((k) => worker('a', k)),
      worker('b', 'z'),
      worker('gone', 'y'),
    ];
    const out = listFaces([event('a'), event('b'), event('gone', 'cancelled')], lineup);
    expect(FACES_SHOWN).toBe(6);
    expect(out.map((r) => r.bookingId)).toEqual(['a-a', 'a-b', 'a-c', 'a-d', 'a-e', 'a-f', 'b-z']);
  });
});

describe('the list says where older events are', () => {
  const NOW = '2026-10-14T10:00:00Z';
  const render = (events: PortalEvent[], older: boolean) =>
    renderToStaticMarkup(
      <EventsScreen
        events={events}
        sections={[]}
        lineup={[]}
        photos={{}}
        now={NOW}
        loaded={{ since: '2026-07-16', until: null, older }}
      />,
    );

  it('on Past: "since <day>" and a link 90 days further back, keeping the tab', () => {
    query = 'tab=past';
    const html = render([event('a')], true);
    expect(html).toContain('Past events since 16 Jul 2026');
    expect(html).toContain('href="/client?tab=past&amp;since=2026-04-17"');
    expect(html).toContain('Show older events');
  });

  it('no link when there is nothing older; nothing at all on Upcoming', () => {
    query = 'tab=past';
    expect(render([event('a')], false)).not.toContain('Show older events');
    query = '';
    expect(render([event('a')], true)).not.toContain('Past events since');
  });

  it('never says "No events yet" when older events exist', () => {
    query = '';
    const html = render([], true);
    expect(html).not.toContain('No events yet');
    expect(html).toContain('You have no upcoming events, and none since 16 Jul 2026.');
    expect(html).toContain('href="/client?since=2026-04-17"');
    query = 'tab=past';
    const ahead = {
      ...event('u', 'upcoming'),
      startsAt: '2026-10-20T16:00:00Z',
      endsAt: '2026-10-20T22:00:00Z',
    };
    const past = render([ahead], true);
    expect(past).toContain('You have no past events since 16 Jul 2026.');
    expect(past).not.toContain('You have no past events yet.');
  });

  it('keeps "No events yet" for a customer with no history at all', () => {
    query = '';
    expect(render([], false)).toContain('No events yet');
  });
});
