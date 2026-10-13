import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * data.ts — the portal's reads (§11.1, §11.2; ADR-0004).
 *
 * What this pins: the database's own error text never reaches the customer
 * (it goes to the server log), a non-UUID event id is "not found" without a
 * query, and the three columns 20261013100300 added come through under their
 * camelCase names.
 */
type Result = { data: unknown; error: { message: string; code?: string } | null };

const state = vi.hoisted(() => ({
  results: {} as Record<string, Result>,
  tables: [] as string[],
}));

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({
    from: (table: string) => {
      state.tables.push(table);
      const result = () =>
        Promise.resolve(state.results[table] ?? ({ data: [], error: null } as Result));
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => result(),
        then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
          result().then(ok, bad),
      };
      return chain;
    },
  }),
}));

const { LOAD_FAILED, loadEvent, loadEventList } = await import('../data');

const EV = '80000000-0000-4000-8000-000000000001';
const LEAK = 'permission denied for view client_lineup_v (SQLSTATE 42501)';

const eventRow = {
  id: EV,
  title: 'Gala Dinner',
  venue_name: 'Leonardo Hotel St Pauls',
  venue_address: '10 Godliman St, London',
  event_date: '2026-10-20',
  po_number: null,
  onsite_contact: null,
  starts_at: '2026-10-20T16:00:00Z',
  ends_at: '2026-10-20T22:30:00Z',
  status: 'cancelled',
  cancelled_at: '2026-10-11T09:30:00Z',
};
const lineupRow = {
  booking_id: 'b1',
  event_id: EV,
  shift_id: 's1',
  role: 'Waiting Staff',
  starts_at: '2026-10-20T16:00:00Z',
  ends_at: '2026-10-20T22:30:00Z',
  name: 'Aisha Bello',
  photo_path: null,
  sort_key: 'bello',
  feedback_given: true,
  feedback_rating: 4,
  feedback_sent_at: '2026-10-20T23:10:00Z',
};

let logged: unknown[][] = [];

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.example';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  state.results = {};
  state.tables = [];
  logged = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logged.push(args);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadEventList', () => {
  it('maps the new columns', async () => {
    state.results = {
      client_events_v: { data: [eventRow], error: null },
      client_lineup_v: { data: [lineupRow], error: null },
      client_company_v: { data: { name: 'Leonardo Hotels' }, error: null },
    };
    const out = await loadEventList();
    expect(out.problem).toBeNull();
    expect(out.events[0]?.cancelledAt).toBe('2026-10-11T09:30:00Z');
    expect(out.lineup[0]?.feedbackRating).toBe(4);
    expect(out.lineup[0]?.feedbackSentAt).toBe('2026-10-20T23:10:00Z');
  });

  it('reads null for an event that is not cancelled and a worker with no feedback', async () => {
    state.results = {
      client_events_v: {
        data: [{ ...eventRow, status: 'upcoming', cancelled_at: null }],
        error: null,
      },
      client_lineup_v: {
        data: [
          { ...lineupRow, feedback_given: false, feedback_rating: null, feedback_sent_at: null },
        ],
        error: null,
      },
    };
    const out = await loadEventList();
    expect(out.events[0]?.cancelledAt).toBeNull();
    expect(out.lineup[0]?.feedbackRating).toBeNull();
    expect(out.lineup[0]?.feedbackSentAt).toBeNull();
  });

  it('gives the customer a fixed sentence and logs the database detail', async () => {
    state.results = { client_lineup_v: { data: null, error: { message: LEAK, code: '42501' } } };
    const out = await loadEventList();
    expect(out.problem).toBe(LOAD_FAILED.list);
    expect(out.problem).not.toContain('client_lineup_v');
    expect(out.events).toEqual([]);
    expect(JSON.stringify(logged)).toContain(LEAK);
  });

  it('says plainly when the portal is not connected', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const out = await loadEventList();
    expect(out.problem).toBe("The portal isn't connected yet. Please contact THC.");
    expect(state.tables).toEqual([]);
  });
});

describe('loadEvent', () => {
  it('treats a non-UUID id as not found, without a query', async () => {
    const out = await loadEvent('not-a-uuid');
    expect(out).toEqual({ event: null, sections: [], lineup: [], problem: null });
    expect(state.tables).toEqual([]);
  });

  it('gives the customer a fixed sentence and logs the database detail', async () => {
    state.results = {
      client_role_sections_v: { data: null, error: { message: LEAK, code: '42501' } },
    };
    const out = await loadEvent(EV);
    expect(out.problem).toBe(LOAD_FAILED.event);
    expect(out.problem).not.toContain('SQLSTATE');
    expect(JSON.stringify(logged)).toContain(LEAK);
  });

  it('maps the event and its line-up', async () => {
    state.results = {
      client_events_v: { data: eventRow, error: null },
      client_lineup_v: { data: [lineupRow], error: null },
    };
    const out = await loadEvent(EV);
    expect(out.event?.cancelledAt).toBe('2026-10-11T09:30:00Z');
    expect(out.lineup[0]).toMatchObject({ feedbackGiven: true, feedbackRating: 4 });
  });
});
