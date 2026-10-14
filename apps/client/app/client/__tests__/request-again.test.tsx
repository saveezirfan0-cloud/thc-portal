import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LineupRow, PortalEvent, RoleSection } from '../rules';

/**
 * ADR-0135 §2 · "Request this person again". On a finished event every
 * person on the line-up (not a removed account) has a "Request again"
 * beside "Leave feedback", which opens a small dialog and sends ONE
 * message to THC through `client_request_worker()` — never a booking.
 * Afterwards, and whenever the customer already has an open request for
 * that person, the row reads "✓ Requested". Every refusal reaches the
 * customer as a fixed sentence.
 */
const state = vi.hoisted(() => ({
  calls: [] as unknown[],
  error: null as null | { code?: string; message: string },
  data: { id: 'r1', already: false } as unknown,
  signedOut: false,
}));

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: state.signedOut ? null : { id: 'u1' } }, error: null }),
    },
    rpc: async (fn: string, args: unknown) => {
      state.calls.push({ fn, args });
      return { data: state.error ? null : state.data, error: state.error };
    },
  }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const { requestAgain } = await import('../events/[id]/actions');
const { EventScreen } = await import('../events/[id]/EventScreen');
const { REQUEST_COPY, requestErrorMessage, requestNoteTooLong, requestOffered } =
  await import('../rules');

const EV = '80000000-0000-4000-8000-000000000001';
const BK = '80000000-0000-4000-8000-0000000000b1';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  state.calls = [];
  state.error = null;
  state.data = { id: 'r1', already: false };
  state.signedOut = false;
});

describe('requestAgain', () => {
  it('sends the trimmed note, or null for none, to client_request_worker', async () => {
    expect(await requestAgain(EV, BK, '  Great with the VIPs  ')).toEqual({
      ok: true,
      already: false,
    });
    await requestAgain(EV, BK, '   ');
    expect(state.calls).toEqual([
      { fn: 'client_request_worker', args: { p_booking_id: BK, p_note: 'Great with the VIPs' } },
      { fn: 'client_request_worker', args: { p_booking_id: BK, p_note: null } },
    ]);
  });

  it('says "already" when THC has an open request for that person', async () => {
    state.data = { id: 'r1', already: true };
    expect(await requestAgain(EV, BK, '')).toEqual({ ok: true, already: true });
  });

  it('refuses a note over 500 characters without calling the database; an emoji is one', async () => {
    expect(await requestAgain(EV, BK, 'x'.repeat(501))).toEqual({
      ok: false,
      error: REQUEST_COPY.tooLong,
    });
    expect(state.calls).toEqual([]);
    expect(await requestAgain(EV, BK, '👏'.repeat(500))).toEqual({ ok: true, already: false });
  });

  it('refuses ids that are not uuids, and says "signed out" without calling the RPC', async () => {
    expect((await requestAgain('nope', BK, '')).ok).toBe(false);
    state.signedOut = true;
    expect(await requestAgain(EV, BK, '')).toEqual({
      ok: false,
      error: REQUEST_COPY.signedOut,
      signedOut: true,
    });
    expect(state.calls).toEqual([]);
  });

  it.each([
    [{ code: '22023', message: 'request_note_too_long' }, REQUEST_COPY.tooLong],
    [{ code: '22023', message: 'request_after_event' }, REQUEST_COPY.notYet],
    [{ code: '22023', message: 'worker_removed' }, REQUEST_COPY.removed],
    [{ code: 'P0001', message: 'request_limit_reached' }, REQUEST_COPY.limit],
    [{ code: '42501', message: 'That booking is not on your line-up' }, REQUEST_COPY.notVisible],
    [{ code: 'XX000', message: 'relation "x" does not exist' }, REQUEST_COPY.failed],
  ])('turns %o into a customer sentence', async (error, sentence) => {
    state.error = error;
    expect(await requestAgain(EV, BK, '')).toEqual({ ok: false, error: sentence });
    expect(requestErrorMessage(error)).toBe(sentence);
  });
});

describe('the rules', () => {
  const ev = (over: Partial<PortalEvent>) =>
    ({ status: 'completed', endsAt: '2026-09-19T22:30:00Z', ...over }) as PortalEvent;

  it('offers "Request again" once the event has finished, never when cancelled', () => {
    const after = new Date('2026-09-20T09:00:00Z');
    const during = new Date('2026-09-19T20:00:00Z');
    expect(requestOffered(ev({}), after)).toBe(true);
    expect(requestOffered(ev({ status: 'ongoing' }), during)).toBe(false);
    expect(requestOffered(ev({ status: 'ongoing' }), after)).toBe(true);
    expect(requestOffered(ev({ status: 'cancelled' }), after)).toBe(false);
  });

  it('counts the note as the database does', () => {
    expect(requestNoteTooLong(` ${'a'.repeat(500)} `)).toBe(false);
    expect(requestNoteTooLong('a'.repeat(501))).toBe(true);
  });

  it('never says the request books anyone', () => {
    expect(REQUEST_COPY.explain).toMatch(/does not book anyone/);
    expect(Object.values(REQUEST_COPY).join(' ')).not.toMatch(/£|rate|charge|booked for you/i);
  });
});

describe('the event page', () => {
  const event = (over: Partial<PortalEvent> = {}): PortalEvent => ({
    id: EV,
    title: 'Gala Dinner',
    venueName: 'Leonardo Royal Hotel',
    venueAddress: '10 Godliman St, EC4V 5AJ',
    eventDate: '2026-09-19',
    poNumber: null,
    onsiteContact: null,
    startsAt: '2026-09-19T16:00:00Z',
    endsAt: '2026-09-19T22:30:00Z',
    status: 'completed',
    ...over,
  });
  const sections: RoleSection[] = [
    {
      shiftId: 's1',
      eventId: EV,
      role: 'Waiting Staff',
      startsAt: '2026-09-19T16:00:00Z',
      endsAt: '2026-09-19T22:30:00Z',
      headcount: 3,
      confirmed: 3,
    },
  ];
  const row = (over: Partial<LineupRow>): LineupRow => ({
    bookingId: 'b',
    eventId: EV,
    shiftId: 's1',
    role: 'Waiting Staff',
    startsAt: '2026-09-19T16:00:00Z',
    endsAt: '2026-09-19T22:30:00Z',
    name: 'Someone',
    sortKey: 'someone',
    feedbackGiven: false,
    ...over,
  });
  const lineup = [
    row({ bookingId: 'b1', name: 'Aisha Bello', sortKey: 'bello' }),
    row({ bookingId: 'b2', name: 'Tom Hale', sortKey: 'hale', workerRequested: true }),
    row({ bookingId: 'b3', name: 'Deleted account #1042', sortKey: 'zzzz-deleted-1042' }),
  ];
  const render = (over: Partial<PortalEvent> = {}, now = '2026-09-20T09:00:00Z') =>
    renderToStaticMarkup(
      <EventScreen event={event(over)} sections={sections} lineup={lineup} photos={{}} now={now} />,
    );

  it('offers "Request again" per person on a finished event, named for each', () => {
    const html = render();
    expect(html).toContain('aria-label="Request Aisha Bello again"');
    expect(html).toContain('>Request again<');
  });

  it('reads "✓ Requested" for a person the customer already asked for', () => {
    const html = render();
    expect(html).toContain('✓ Requested');
    expect(html).toContain('Requested again: Tom Hale. THC has your request.');
    expect(html).not.toContain('aria-label="Request Tom Hale again"');
  });

  it('offers nothing for a removed account', () => {
    expect(render()).not.toContain('Request Deleted account');
  });

  it('offers nothing before the event has finished, or on a cancelled one', () => {
    expect(render({ status: 'ongoing' }, '2026-09-19T20:00:00Z')).not.toContain('Request again');
    expect(render({ status: 'cancelled' })).not.toContain('Request again');
  });
});

describe('the feedback page lists open requests', () => {
  it('reads client_worker_requests_v, never the table', () => {
    const data = readFileSync(resolve(__dirname, '../data.ts'), 'utf8');
    expect(data).toContain(".from('client_worker_requests_v')");
    expect(data).not.toContain(".from('client_worker_requests')");
  });
});
