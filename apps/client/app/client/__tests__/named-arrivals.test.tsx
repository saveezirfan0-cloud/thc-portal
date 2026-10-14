import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { LineupRow, PortalEvent, RoleSection } from '../rules';

/**
 * ADR-0135 §1 · named arrivals on the day. During the live window each
 * seated person on the event page reads "Arrived 08:52" (the first check-in,
 * viewer-local, §1.8), "Not here yet", or — 30 minutes after their
 * section's start, the moment §9.5 locks the check-in — "Not arrived".
 * Never "Late", never "No-show", never a place. The state comes from the
 * database (client_lineup_v.arrival_status, null outside the window); the
 * page only words it, hides a later section's people until their own start
 * (RULE-18), and never asks for it on the list.
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

const { EventScreen } = await import('../events/[id]/EventScreen');
const { ARRIVAL_COPY, arrivalState, isArrivalStatus } = await import('../rules');

const EVENT_ID = '60000000-0000-4000-8000-000000000001';
// 09:20 BST on the day: the chefs started at 08:00, the waiters start at 17:00.
const NOW = '2026-09-19T08:20:00Z';

const event = (over: Partial<PortalEvent> = {}): PortalEvent => ({
  id: EVENT_ID,
  title: 'Gala Dinner',
  venueName: 'Leonardo Royal Hotel',
  venueAddress: '10 Godliman St, EC4V 5AJ',
  eventDate: '2026-09-19',
  poNumber: null,
  onsiteContact: null,
  startsAt: '2026-09-19T07:00:00Z',
  endsAt: '2026-09-19T22:30:00Z',
  status: 'ongoing',
  ...over,
});

const sections: RoleSection[] = [
  {
    shiftId: 's-chef',
    eventId: EVENT_ID,
    role: 'Chef',
    startsAt: '2026-09-19T07:00:00Z',
    endsAt: '2026-09-19T15:00:00Z',
    headcount: 3,
    confirmed: 3,
  },
  {
    shiftId: 's-wait',
    eventId: EVENT_ID,
    role: 'Waiting Staff',
    startsAt: '2026-09-19T16:00:00Z',
    endsAt: '2026-09-19T22:30:00Z',
    headcount: 1,
    confirmed: 1,
  },
];

const row = (over: Partial<LineupRow>): LineupRow => ({
  bookingId: 'b',
  eventId: EVENT_ID,
  shiftId: 's-chef',
  role: 'Chef',
  startsAt: '2026-09-19T07:00:00Z',
  endsAt: '2026-09-19T15:00:00Z',
  name: 'Someone',
  sortKey: 'someone',
  feedbackGiven: false,
  ...over,
});

const lineup: LineupRow[] = [
  row({
    bookingId: 'b-1',
    name: 'Aisha Bello',
    sortKey: 'bello',
    arrivalStatus: 'arrived',
    arrivedAt: '2026-09-19T06:52:00Z',
  }),
  row({ bookingId: 'b-2', name: 'Tom Hale', sortKey: 'hale', arrivalStatus: 'not_arrived' }),
  row({ bookingId: 'b-3', name: 'Priya Shah', sortKey: 'shah', arrivalStatus: 'expected' }),
  row({
    bookingId: 'b-4',
    shiftId: 's-wait',
    role: 'Waiting Staff',
    startsAt: '2026-09-19T16:00:00Z',
    endsAt: '2026-09-19T22:30:00Z',
    name: 'Luca Moretti',
    sortKey: 'moretti',
    arrivalStatus: 'expected',
  }),
];

const render = (over: Partial<PortalEvent> = {}, rows = lineup) =>
  renderToStaticMarkup(
    <EventScreen event={event(over)} sections={sections} lineup={rows} photos={{}} now={NOW} />,
  );

describe('arrivalState (ADR-0135 §1)', () => {
  const at = new Date(NOW);

  it('words an arrival with the first check-in, in the viewer’s zone', () => {
    const r = row({
      name: 'Aisha Bello',
      arrivalStatus: 'arrived',
      arrivedAt: '2026-09-19T06:52:00Z',
    });
    expect(arrivalState(r, r.startsAt, at, 'Europe/London')).toEqual({
      kind: 'arrived',
      text: 'Arrived 07:52',
      label: 'Aisha Bello: arrived at 07:52',
    });
    // A viewer in New York sees their own clock and nothing else (§1.8).
    expect(arrivalState(r, r.startsAt, at, 'America/New_York')?.text).toBe('Arrived 02:52');
  });

  it('says "Arrived" without a time when the view has none (a worked booking)', () => {
    const r = row({ arrivalStatus: 'arrived', arrivedAt: null });
    expect(arrivalState(r, r.startsAt, at, 'Europe/London')?.text).toBe('Arrived');
  });

  it('says "Not arrived" after the 30-minute mark, never "No-show" or "Late"', () => {
    const r = row({ name: 'Tom Hale', arrivalStatus: 'not_arrived' });
    const state = arrivalState(r, r.startsAt, at, 'Europe/London');
    expect(state?.text).toBe(ARRIVAL_COPY.missing);
    expect(state?.kind).toBe('missing');
    expect(JSON.stringify(state)).not.toMatch(/no-?show|late|violation|gps|location/i);
  });

  it('says "Not here yet" for someone expected whose section has started', () => {
    const r = row({ arrivalStatus: 'expected' });
    expect(arrivalState(r, r.startsAt, at, 'Europe/London')?.text).toBe('Not here yet');
  });

  it('says nothing for a later section before its own start (RULE-18)', () => {
    const r = row({ arrivalStatus: 'expected', startsAt: '2026-09-19T16:00:00Z' });
    expect(arrivalState(r, '2026-09-19T16:00:00Z', at, 'Europe/London')).toBeNull();
  });

  it('says nothing when the database gave no state (before, after, cancelled, unseated)', () => {
    expect(arrivalState(row({ arrivalStatus: null }), NOW, at, 'Europe/London')).toBeNull();
    expect(arrivalState(row({}), NOW, at, 'Europe/London')).toBeNull();
  });

  it('accepts only the three states the view writes', () => {
    expect(isArrivalStatus('arrived')).toBe(true);
    expect(isArrivalStatus('not_arrived')).toBe(true);
    expect(isArrivalStatus('no_show')).toBe(false);
    expect(isArrivalStatus(null)).toBe(false);
  });
});

describe('the event page on the day', () => {
  it('shows each seated person’s state in words, with a sentence for a screen reader', () => {
    const html = render();
    expect(html).toContain('Arrived 07:52');
    expect(html).toContain('Aisha Bello: arrived at 07:52');
    expect(html).toContain('Not arrived');
    expect(html).toContain('Tom Hale: not arrived');
    expect(html).toContain('Not here yet');
    expect(html).toContain('Priya Shah: not here yet');
    // The decorative dot is hidden from assistive tech.
    expect(html).toMatch(/class="arr-dot" aria-hidden="true"/);
  });

  it('keeps a later section quiet until it starts', () => {
    const html = render();
    expect(html).not.toContain('Luca Moretti: not here yet');
  });

  it('never words the office’s violations', () => {
    expect(render()).not.toMatch(/no-?show|\blate\b|violation/i);
  });

  it('shows nothing when the rows carry no state (the list’s shape, or outside the window)', () => {
    const plain = lineup.map(({ arrivalStatus: _s, arrivedAt: _a, ...rest }) => rest);
    const html = render({ status: 'completed' }, plain);
    expect(html).not.toContain('class="arr ');
  });

  it('shows nothing for a cancelled event', () => {
    expect(render({ status: 'cancelled' })).not.toContain('class="arr ');
  });
});

describe('where the columns are asked for', () => {
  const data = readFileSync(resolve(__dirname, '../data.ts'), 'utf8');

  it('the event page reads arrival_status and arrived_at; the list does not', () => {
    expect(data).toMatch(
      /EVENT_LINEUP_COLUMNS = `\$\{LINEUP_COLUMNS\}, arrival_status, arrived_at`/,
    );
    const list = data.slice(data.indexOf('export async function loadEventList'));
    const listBody = list.slice(0, list.indexOf('export interface EventPageData'));
    expect(listBody).not.toContain('EVENT_LINEUP_COLUMNS');
    expect(listBody).not.toContain('arrival_status');
  });

  it('prints no arrival state (the paper line-up goes stale)', () => {
    const css = readFileSync(resolve(__dirname, '../client-portal.css'), 'utf8');
    const print = css.slice(css.indexOf('@media print'));
    expect(print).toContain('.wrow .arr,');
  });
});
