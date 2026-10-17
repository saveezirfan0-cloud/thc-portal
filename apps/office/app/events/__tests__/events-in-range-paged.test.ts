import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callsTo, fakePostgrest } from '../../_lib/__tests__/fakePostgrest';

/**
 * /events Month and List at full volume (go-live audit 17.10.2026, B2).
 *
 * A 42-day grid at 15 events a day is ~630 events and ~1,900 role sections.
 * The loader used to send every event id, then every section id, in an
 * `in.(…)` URL (past any gateway limit), and read bookings cut at 1000 rows
 * — filled roles showed as open. Now one RPC returns the sections with the
 * confirmed count already done, paged like every other list.
 */

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('@thc/db/server', () => ({ createClient: () => state.db }));

const { loadEventsInRange } = await import('../data');

const pad = (n: number) => String(n).padStart(4, '0');
const DAYS = 42;
const EVENTS = Array.from({ length: 630 }, (_, n) => ({
  id: `e-${pad(n)}`,
  title: `Event ${pad(n)}`,
  event_date: `2026-11-${String(1 + (n % 28)).padStart(2, '0')}`,
  venue_name: 'Hall',
  venue_address: '1 Street',
  po_number: null,
  cancelled_at: null,
  cancel_reason: null,
  client_id: 'c-1',
}));
// Three sections an event; the confirmed count is the function's, verbatim.
const SECTIONS = EVENTS.flatMap((event, n) =>
  [0, 1, 2].map((k) => ({
    section_id: `s-${pad(n)}-${k}`,
    event_id: event.id,
    role_id: 'r-1',
    starts_at: `${event.event_date}T1${k}:00:00Z`,
    ends_at: `${event.event_date}T2${k}:00:00Z`,
    headcount: 6,
    buffer: 1,
    confirmed: (n + k) % 8,
  })),
);

let fake: ReturnType<typeof fakePostgrest>;

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  fake = fakePostgrest({
    events: EVENTS,
    office_event_sections: SECTIONS,
    clients: [{ id: 'c-1', name: 'Acme' }],
    roles: [{ id: 'r-1', name: 'Waiter' }],
  });
  state.db = fake;
});

describe('loadEventsInRange at a full Month', () => {
  it(`lists all 630 events of ${DAYS} days and all 1,890 sections, with their counts`, async () => {
    const { events, problem } = await loadEventsInRange('2026-10-26', '2026-12-06');
    expect(problem).toBeNull();
    expect(events).toHaveLength(630);
    const roles = events.flatMap((e) => e.roles);
    expect(roles).toHaveLength(1890);
    const last = events.at(-1)!;
    expect(last.roles.map((r) => r.confirmed)).toEqual([629 % 8, 630 % 8, 631 % 8]);
    // The buffer is passed through as stored: the chip reads 6 (+1), never 7.
    expect(last.roles[0]).toMatchObject({ headcount: 6, buffer: 1 });
  });

  it('sends no id list and reads no bookings: the database counts', async () => {
    await loadEventsInRange('2026-10-26', '2026-12-06');
    expect(callsTo(fake.calls, 'bookings')).toHaveLength(0);
    expect(callsTo(fake.calls, 'shift_requirements')).toHaveLength(0);
    for (const call of fake.calls) {
      expect(call.filters.filter(([op]) => op === 'in')).toEqual([]);
    }
    const rpc = callsTo(fake.calls, 'office_event_sections');
    expect(rpc[0]!.args).toEqual({ p_from: '2026-10-26', p_to: '2026-12-06' });
    expect(rpc.map((c) => c.range)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it('a failed count is a problem, never chips that all read 0 confirmed', async () => {
    state.db = fakePostgrest(
      { events: EVENTS, clients: [], roles: [] },
      { errors: { office_event_sections: { message: 'admins_only' } } },
    );
    const { events, problem } = await loadEventsInRange('2026-10-26', '2026-12-06');
    expect(events).toEqual([]);
    expect(problem).toMatch(/^Events could not be loaded/);
  });
});
