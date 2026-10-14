import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { LineupRow, PortalEvent } from '../rules';

/**
 * "Rate everyone" (ADR-0134 P4): one dialog for everyone still to rate,
 * sent through the existing `submit_client_feedback()` once per worker.
 * The rules are pinned here; the browser walk (e2e) presses the buttons.
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../events/[id]/actions', () => ({ leaveFeedback: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const { RATE_ALL_FROM, sendLabel, sendQueue, sendSummary, stillToRate, tooLong } =
  await import('../events/[id]/rate-all');
const { EventScreen } = await import('../events/[id]/EventScreen');

const EVENT_ID = '60000000-0000-4000-8000-000000000001';
const person = (n: number, over: Partial<LineupRow> = {}): LineupRow => ({
  bookingId: `b-${n}`,
  eventId: EVENT_ID,
  shiftId: 's-1',
  role: 'Waiting Staff',
  startsAt: '2026-09-19T16:00:00Z',
  endsAt: '2026-09-19T22:30:00Z',
  name: `Worker ${n}`,
  sortKey: `worker ${n}`,
  feedbackGiven: false,
  ...over,
});

describe('who is listed', () => {
  it('everyone still to rate: not already rated, not sent here, not a removed account', () => {
    const people = [
      person(1),
      person(2, { feedbackGiven: true }),
      person(3),
      person(4, { name: 'Deleted account #1042' }),
      person(5),
    ];
    expect(stillToRate(people, new Set(['b-5'])).map((p) => p.bookingId)).toEqual(['b-1', 'b-3']);
  });
});

describe('what a press sends', () => {
  const people = [person(1), person(2), person(3), person(4)];

  it('the rated rows only, in order, and never one already sent', () => {
    const drafts = {
      'b-1': { rating: 4, text: '' },
      'b-2': { rating: 0, text: 'no stars, so skipped' },
      'b-3': { rating: 5, text: 'Great' },
      'b-4': { rating: 2, text: '' },
    };
    expect(sendQueue(people, drafts, {})).toEqual(['b-1', 'b-3', 'b-4']);
    // After a send where b-1 went and b-3 failed: "try again" sends b-3 and b-4.
    expect(
      sendQueue(people, drafts, {
        'b-1': { state: 'sent' },
        'b-3': { state: 'failed', message: 'x' },
      }),
    ).toEqual(['b-3', 'b-4']);
  });

  it('catches an over-long comment before anything is sent', () => {
    const drafts = {
      'b-1': { rating: 3, text: 'x'.repeat(2001) },
      'b-2': { rating: 3, text: 'ok' },
    };
    expect(tooLong(drafts, ['b-1', 'b-2'])).toEqual(['b-1']);
  });

  it('says what it will do, and what it is doing', () => {
    expect(sendLabel(0, null)).toBe('Choose stars to send');
    expect(sendLabel(1, null)).toBe('Send 1 rating');
    expect(sendLabel(3, null)).toBe('Send 3 ratings');
    expect(sendLabel(3, { done: 1, of: 3 })).toBe('Sending 2 of 3…');
  });

  it('reports per-worker success and failure in one line', () => {
    expect(sendSummary({})).toBeNull();
    expect(sendSummary({ a: { state: 'sent' }, b: { state: 'sent' } })).toBe('2 ratings sent');
    expect(sendSummary({ a: { state: 'sent' }, b: { state: 'failed', message: 'x' } })).toBe(
      "1 rating sent · 1 couldn't be sent — see the row below and try again",
    );
  });
});

describe('on the event page', () => {
  const event = (over: Partial<PortalEvent> = {}): PortalEvent => ({
    id: EVENT_ID,
    title: 'Gala Dinner',
    venueName: 'Leonardo Royal Hotel',
    venueAddress: '10 Godliman St',
    eventDate: '2026-09-19',
    poNumber: null,
    onsiteContact: null,
    startsAt: '2026-09-19T06:00:00Z',
    endsAt: '2026-09-19T22:30:00Z',
    status: 'completed',
    ...over,
  });
  const page = (lineup: LineupRow[], now: string, over: Partial<PortalEvent> = {}) =>
    renderToStaticMarkup(
      <EventScreen event={event(over)} sections={[]} lineup={lineup} photos={{}} now={now} />,
    );
  const AFTER = '2026-09-21T09:00:00Z';
  const BEFORE = '2026-09-18T09:00:00Z';

  it(`is offered once feedback is open and ${RATE_ALL_FROM} or more are still to rate`, () => {
    const html = page([person(1), person(2), person(3, { feedbackGiven: true })], AFTER);
    expect(html).toContain('Rate everyone (2)');
    // One at a time stays.
    expect(html.match(/aria-label="Leave feedback for Worker/g)).toHaveLength(2);
  });

  it('is not offered before the start, for one person, or for a cancelled event', () => {
    expect(page([person(1), person(2)], BEFORE, { status: 'upcoming' })).not.toContain(
      'Rate everyone',
    );
    expect(page([person(1), person(2, { feedbackGiven: true })], AFTER)).not.toContain(
      'Rate everyone',
    );
    expect(page([person(1), person(2)], AFTER, { status: 'cancelled' })).not.toContain(
      'Rate everyone',
    );
  });
});
