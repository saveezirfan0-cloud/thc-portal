import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedbackHistoryData } from '../data';

/**
 * "Feedback you've given" (ADR-0134 N4): worker · event · date · your stars
 * · sent date · your comment, newest first, read-only; an empty state, a
 * failed read, and a removed worker whose comment is withheld (§1.7).
 */
const state = vi.hoisted(() => ({ data: null as unknown, requests: [] as unknown[] }));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../data', () => ({
  HISTORY_LIMIT: 500,
  loadFeedbackHistory: async () => state.data,
  // ADR-0135 §2: the open "Request again" messages above the entries.
  loadOpenRequests: async () => state.requests,
}));

const Page = (await import('../feedback/page')).default;

const EV = '60000000-0000-4000-8000-000000000006';
const entries: FeedbackHistoryData['entries'] = [
  {
    bookingId: 'b-1',
    eventId: EV,
    eventTitle: 'Lunch Service',
    venueName: 'Leonardo Royal Hotel',
    eventStartsAt: '2026-09-30T10:00:00Z',
    name: 'Aisha Bello',
    role: 'Waiting Staff',
    rating: 4,
    sentAt: '2026-10-01T18:45:00Z',
    text: 'Calm under pressure',
  },
  {
    bookingId: 'b-2',
    eventId: EV,
    eventTitle: 'Lunch Service',
    venueName: 'Leonardo Royal Hotel',
    eventStartsAt: '2026-09-30T10:00:00Z',
    name: 'Deleted account #1042',
    role: 'Waiting Staff',
    rating: 2,
    sentAt: '2026-10-01T18:40:00Z',
    text: null,
  },
];

const render = async () => renderToStaticMarkup(await Page());

beforeEach(() => {
  state.data = { entries, truncated: false, problem: null };
});

describe('the page', () => {
  it('lists worker, event, date, the stars, the sent date and the comment', async () => {
    const html = await render();
    expect(html).toContain('<h1>Feedback you’ve given</h1>');
    expect(html).toContain('Aisha Bello');
    expect(html).toContain(`href="/client/events/${EV}"`);
    expect(html).toContain('Lunch Service');
    expect(html).toContain('aria-label="4 of 5 stars"');
    expect(html).toContain('<q>Calm under pressure</q>');
    expect(html).toContain('2 entries');
    expect(html).toContain('href="/client"');
  });

  it('withholds a removed worker’s comment and says why, keeping the stars', async () => {
    const html = await render();
    expect(html).toContain('Deleted account #1042');
    expect(html).toContain('aria-label="2 of 5 stars"');
    expect(html).toContain('Comment not shown — account removed');
  });

  it('is read-only: nothing to edit, delete or send', async () => {
    const html = await render();
    expect(html).not.toMatch(/<button|<form|<textarea/);
  });

  it('says there is nothing yet, rather than an empty table', async () => {
    state.data = { entries: [], truncated: false, problem: null };
    const html = await render();
    expect(html).toContain('No feedback yet');
    expect(html).not.toContain('<table');
  });

  it('a failed read is the amber sentence only', async () => {
    state.data = {
      entries: [],
      truncated: false,
      problem: 'We could not load your feedback just now. Refresh the page to try again.',
    };
    const html = await render();
    expect(html).toContain('alert amber');
    expect(html).not.toContain('No feedback yet');
  });

  it('says when it shows only the latest entries', async () => {
    state.data = { entries, truncated: true, problem: null };
    expect(await render()).toContain('Showing your latest 500 entries');
  });
});

describe('People you’ve asked for again (ADR-0135 §2)', () => {
  beforeEach(() => {
    state.data = { entries: [], truncated: false, problem: null };
  });

  it('is not drawn while there is no open request', async () => {
    state.requests = [];
    const html = renderToStaticMarkup(await Page());
    expect(html).not.toContain('asked for again');
  });

  it('lists each open request: who, from which event, when, and the note', async () => {
    state.requests = [
      {
        id: 'r1',
        eventId: EV,
        eventTitle: 'Lunch Service',
        eventStartsAt: '2026-09-30T10:00:00Z',
        name: 'Aisha Bello',
        role: 'Waiting Staff',
        note: 'Please send her again',
        requestedAt: '2026-10-01T09:00:00Z',
      },
    ];
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain('People you’ve asked for again');
    expect(html).toContain('1 open');
    expect(html).toContain('Aisha Bello');
    expect(html).toContain(`href="/client/events/${EV}"`);
    expect(html).toContain('Please send her again');
    expect(html).toContain('They are not bookings');
    state.requests = [];
  });
});
