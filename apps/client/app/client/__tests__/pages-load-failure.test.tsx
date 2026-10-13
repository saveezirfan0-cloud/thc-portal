import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the two pages draw when a read fails (§11.1, §11.2).
 *
 *   · the list: the head and the customer sentence ONLY. Drawing the screen
 *     with `events = []` would tell a customer who has events "No events
 *     yet".
 *   · the event: a heading, the sentence and the way back to the list.
 *   · a documents read that fails is said above the screen, so the buttons'
 *     "not issued yet" is not mistaken for the answer.
 *   · `?doc=missing|unavailable` from the download route is an amber note.
 *   · a non-UUID id is not found.
 */
const state = vi.hoisted(() => ({
  list: null as unknown,
  event: null as unknown,
  docsUnavailable: false,
  screens: [] as string[],
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('../data', async () => ({
  loadEventList: async () => state.list,
  loadEvent: async () => state.event,
}));
vi.mock('../documents', () => ({
  DOCUMENTS_UNAVAILABLE: "Documents couldn't be loaded just now — refresh to try again.",
  kindsByEvent: () => ({}),
  loadAllDocuments: async () => ({ documents: [], unavailable: state.docsUnavailable }),
  loadDocuments: async () => ({ documents: [], unavailable: state.docsUnavailable }),
}));
vi.mock('../photos', () => ({ presentLineup: async () => ({ lineup: [], photos: {} }) }));
vi.mock('../arrivals', () => ({ loadArrivals: async () => ({}) }));
vi.mock('../../_components/AutoRefresh', () => ({ AutoRefresh: () => null }));
vi.mock('../EventsScreen', () => ({
  EventsScreen: () => {
    state.screens.push('EventsScreen');
    return <div>EVENTS-SCREEN</div>;
  },
}));
vi.mock('../events/[id]/EventScreen', () => ({
  EventScreen: () => {
    state.screens.push('EventScreen');
    return <div>EVENT-SCREEN</div>;
  },
}));

const ListPage = (await import('../(list)/page')).default;
const EventPage = (await import('../events/[id]/page')).default;

const EV = '90000000-0000-4000-8000-000000000001';
const FAILED = 'We could not load your events just now. Refresh the page to try again.';

const event = {
  id: EV,
  title: 'Gala Dinner',
  venueName: 'Leonardo Hotel St Pauls',
  venueAddress: '10 Godliman St',
  eventDate: '2026-10-20',
  poNumber: null,
  onsiteContact: null,
  startsAt: '2026-10-20T16:00:00Z',
  endsAt: '2026-10-20T22:30:00Z',
  status: 'upcoming',
  cancelledAt: null,
};

function renderEvent(id: string, doc?: string) {
  return EventPage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve(doc ? { doc } : {}),
  });
}

beforeEach(() => {
  state.screens = [];
  state.docsUnavailable = false;
  state.list = { events: [], sections: [], lineup: [], company: null, problem: null };
  state.event = { event, sections: [], lineup: [], problem: null };
});

describe('the list page', () => {
  it('on a failed read draws the head and the alert, never the screen', async () => {
    state.list = { events: [], sections: [], lineup: [], company: null, problem: FAILED };
    const html = renderToStaticMarkup(await ListPage());
    expect(html).toContain('Your events');
    expect(html).toContain('could not load your events');
    expect(html).not.toContain('EVENTS-SCREEN');
    expect(html).not.toContain('No events yet');
    expect(state.screens).toEqual([]);
  });

  it('says so above the screen when the documents could not be read', async () => {
    state.docsUnavailable = true;
    const html = renderToStaticMarkup(await ListPage());
    expect(html).toContain('Documents couldn&#x27;t be loaded just now');
    expect(html).toContain('EVENTS-SCREEN');
  });
});

describe('the event page', () => {
  it('is not found for a non-UUID id', async () => {
    await expect(renderEvent('not-a-uuid')).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('is not found when the view returns no row', async () => {
    state.event = { event: null, sections: [], lineup: [], problem: null };
    await expect(renderEvent(EV)).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('on a failed read draws a heading, the alert and the way back', async () => {
    state.event = {
      event: null,
      sections: [],
      lineup: [],
      problem: 'We couldn’t load this event.',
    };
    const html = renderToStaticMarkup(await renderEvent(EV));
    expect(html).toContain('<h1>');
    expect(html).toContain('We couldn’t load this event.');
    expect(html).toContain('href="/client"');
    expect(html).toContain('← Your events');
    expect(html).not.toContain('EVENT-SCREEN');
  });

  it('shows an amber note for ?doc=missing and ?doc=unavailable, and ignores anything else', async () => {
    const missing = renderToStaticMarkup(await renderEvent(EV, 'missing'));
    expect(missing).toContain('hasn&#x27;t been issued yet');
    expect(missing).toContain('alert amber');
    const unavailable = renderToStaticMarkup(await renderEvent(EV, 'unavailable'));
    expect(unavailable).toContain('couldn&#x27;t be downloaded just now');
    const other = renderToStaticMarkup(await renderEvent(EV, '<script>'));
    expect(other).not.toContain('alert');
    expect(other).toContain('EVENT-SCREEN');
  });

  it('says a cancelled event has no documents rather than "not issued yet"', async () => {
    state.event = {
      event: { ...event, status: 'cancelled' },
      sections: [],
      lineup: [],
      problem: null,
    };
    const html = renderToStaticMarkup(await renderEvent(EV, 'missing'));
    expect(html).toContain('was cancelled');
    expect(html).not.toContain('issued yet');
  });

  it('says so above the screen when the documents could not be read', async () => {
    state.docsUnavailable = true;
    const html = renderToStaticMarkup(await renderEvent(EV));
    expect(html).toContain('Documents couldn&#x27;t be loaded just now');
    expect(html).toContain('EVENT-SCREEN');
  });
});
