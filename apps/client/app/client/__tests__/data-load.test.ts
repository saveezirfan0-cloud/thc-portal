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

/** One query as the code built it: the view, then every builder call in order. */
interface Built {
  table: string;
  calls: [string, ...unknown[]][];
}

const state = vi.hoisted(() => ({
  /** A fixed answer per view, whatever the query asked. */
  results: {} as Record<string, Result>,
  /** Or an answer computed from the query itself (takes precedence). */
  answer: null as null | ((q: Built) => Result | undefined),
  tables: [] as string[],
  queries: [] as Built[],
}));

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({
    from: (table: string) => {
      state.tables.push(table);
      const built: Built = { table, calls: [] };
      state.queries.push(built);
      const result = () =>
        Promise.resolve(
          state.answer?.(built) ?? state.results[table] ?? ({ data: [], error: null } as Result),
        );
      const chain: Record<string, unknown> = {
        maybeSingle: () => {
          built.calls.push(['maybeSingle']);
          return result();
        },
        then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
          result().then(ok, bad),
      };
      for (const method of ['select', 'eq', 'in', 'gte', 'lt', 'order', 'limit', 'range']) {
        chain[method] = (...args: unknown[]) => {
          built.calls.push([method, ...args]);
          return chain;
        };
      }
      return chain;
    },
  }),
}));

const { LIST_LIMITS, LOAD_FAILED, loadEvent, loadEventList } = await import('../data');

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
  state.answer = null;
  state.tables = [];
  state.queries = [];
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
    state.results = {
      client_events_v: { data: [eventRow], error: null },
      client_lineup_v: { data: null, error: { message: LEAK, code: '42501' } },
    };
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
    expect(out).toEqual({ event: null, sections: [], lineup: [], thcPhone: null, problem: null });
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

/** The builder calls of a query, by method name. */
const callsOf = (q: Built, method: string) => q.calls.filter((c) => c[0] === method);
const eventReads = () =>
  state.queries.filter(
    (q) => q.table === 'client_events_v' && callsOf(q, 'select')[0]?.[1] !== 'id',
  );
/** [the not-ended read, the past-window read]. */
const listReads = () => {
  const reads = eventReads();
  return [
    reads.find((q) => callsOf(q, 'gte')[0]?.[1] === 'ends_at'),
    reads.find((q) => callsOf(q, 'lt')[0]?.[1] === 'ends_at'),
  ];
};

// Wednesday 14 Oct 2026, 11:00 UK (BST).
const NOW = new Date('2026-10-14T10:00:00Z');

describe('loadEventList · a bounded read (R1)', () => {
  it('reads not-ended events in full and past ones from 90 days back, each explicitly ordered and capped one over', async () => {
    await loadEventList({ now: NOW });
    const [current, past] = listReads();
    expect(callsOf(current!, 'gte')).toEqual([['gte', 'ends_at', NOW.toISOString()]]);
    expect(callsOf(current!, 'order')).toEqual([
      ['order', 'starts_at', { ascending: true }],
      ['order', 'id', { ascending: true }],
    ]);
    expect(callsOf(current!, 'limit')).toEqual([['limit', LIST_LIMITS.events + 1]]);

    expect(callsOf(past!, 'lt')).toEqual([['lt', 'ends_at', NOW.toISOString()]]);
    // 90 UK days before 14 Oct is 16 Jul; its midnight in BST is 23:00 UTC the day before.
    expect(callsOf(past!, 'gte')).toEqual([['gte', 'starts_at', '2026-07-15T23:00:00.000Z']]);
    expect(callsOf(past!, 'order')).toEqual([
      ['order', 'starts_at', { ascending: false }],
      ['order', 'id', { ascending: true }],
    ]);
    expect(callsOf(past!, 'limit')).toEqual([['limit', LIST_LIMITS.events + 1]]);
  });

  it('reads sections and line-up only for the events it loaded, ordered, a page plus one at a time', async () => {
    const ids = ['e-now', 'e-past'];
    state.answer = (q) =>
      q.table === 'client_events_v' && callsOf(q, 'select')[0]?.[1] !== 'id'
        ? {
            data: [{ ...eventRow, id: callsOf(q, 'gte')[0]?.[1] === 'ends_at' ? ids[0] : ids[1] }],
            error: null,
          }
        : undefined;
    await loadEventList({ now: NOW });

    const sections = state.queries.find((q) => q.table === 'client_role_sections_v')!;
    const lineup = state.queries.find((q) => q.table === 'client_lineup_v')!;
    for (const q of [sections, lineup]) {
      expect(callsOf(q, 'in')).toEqual([['in', 'event_id', ids]]);
      expect(callsOf(q, 'range')).toEqual([['range', 0, LIST_LIMITS.page]]);
    }
    expect(callsOf(sections, 'order').map((c) => c[1])).toEqual([
      'event_id',
      'starts_at',
      'shift_id',
    ]);
    expect(callsOf(lineup, 'order').map((c) => c[1])).toEqual([
      'event_id',
      'sort_key',
      'booking_id',
    ]);
  });

  it('asks for no sections or line-up when no event was loaded', async () => {
    await loadEventList({ now: NOW });
    expect(state.tables).not.toContain('client_role_sections_v');
    expect(state.tables).not.toContain('client_lineup_v');
  });

  it('pages on while a page comes back full, and keeps every row once', async () => {
    const page = LIST_LIMITS.page;
    const rows = Array.from({ length: page + 3 }, (_, i) => ({
      ...lineupRow,
      booking_id: `b${i}`,
    }));
    state.answer = (q) => {
      if (q.table === 'client_events_v' && callsOf(q, 'gte')[0]?.[1] === 'ends_at')
        return { data: [{ ...eventRow, status: 'upcoming' }], error: null };
      if (q.table !== 'client_lineup_v') return undefined;
      const [, from, to] = callsOf(q, 'range')[0] as [string, number, number];
      return { data: rows.slice(from, to + 1), error: null };
    };
    const out = await loadEventList({ now: NOW });
    expect(out.problem).toBeNull();
    expect(out.lineup).toHaveLength(page + 3);
    expect(
      state.queries.filter((q) => q.table === 'client_lineup_v').map((q) => callsOf(q, 'range')[0]),
    ).toEqual([
      ['range', 0, page],
      ['range', page, 2 * page],
    ]);
  });

  it('never draws a cut-short list: one event over the cap is the amber notice', async () => {
    state.answer = (q) =>
      q.table === 'client_events_v' && callsOf(q, 'gte')[0]?.[1] === 'starts_at'
        ? {
            data: Array.from({ length: LIST_LIMITS.events + 1 }, (_, i) => ({
              ...eventRow,
              id: `e${i}`,
            })),
            error: null,
          }
        : undefined;
    const out = await loadEventList({ now: NOW });
    expect(out.problem).toBe(LOAD_FAILED.tooMany);
    expect(out.events).toEqual([]);
    expect(JSON.stringify(logged)).toContain('more than 500 events');
  });

  it('never draws a cut-short line-up: rows past the cap are the amber notice', async () => {
    state.answer = (q) => {
      if (q.table === 'client_events_v' && callsOf(q, 'gte')[0]?.[1] === 'ends_at')
        return { data: [eventRow], error: null };
      // A view that always has another full page.
      if (q.table === 'client_lineup_v')
        return {
          data: Array.from({ length: LIST_LIMITS.page + 1 }, (_, i) => ({
            ...lineupRow,
            booking_id: `${JSON.stringify(callsOf(q, 'range')[0])}-${i}`,
          })),
          error: null,
        };
      return undefined;
    };
    const out = await loadEventList({ now: NOW });
    expect(out.problem).toBe(LOAD_FAILED.tooMany);
    expect(out.lineup).toEqual([]);
  });

  it('a "From" older than the window widens the read to exactly that day, and asks nothing about older', async () => {
    await loadEventList({ now: NOW, params: new URLSearchParams('from=2025-01-10') });
    const [, past] = listReads();
    expect(callsOf(past!, 'gte')).toEqual([['gte', 'starts_at', '2025-01-10T00:00:00.000Z']]);
    expect(state.queries.filter((q) => callsOf(q, 'select')[0]?.[1] === 'id')).toEqual([]);
  });

  it('a "To" on its own pages back: 90 days ending that UK day, inclusive', async () => {
    const out = await loadEventList({ now: NOW, params: new URLSearchParams('to=2025-03-31') });
    const [, past] = listReads();
    expect(callsOf(past!, 'gte')).toEqual([['gte', 'starts_at', '2024-12-31T00:00:00.000Z']]);
    // Before the next UK midnight (1 Apr, BST from 30 Mar).
    expect(callsOf(past!, 'lt')).toEqual([
      ['lt', 'ends_at', NOW.toISOString()],
      ['lt', 'starts_at', '2025-03-31T23:00:00.000Z'],
    ]);
    expect(out.history).toMatchObject({ since: '2024-12-31', until: '2025-03-31' });
  });

  it('`since` widens the window ("Show older events") and says whether anything is older still', async () => {
    state.answer = (q) =>
      callsOf(q, 'select')[0]?.[1] === 'id' ? { data: [{ id: 'old' }], error: null } : undefined;
    const out = await loadEventList({ now: NOW, params: new URLSearchParams('since=2026-04-17') });
    const [, past] = listReads();
    expect(callsOf(past!, 'gte')).toEqual([['gte', 'starts_at', '2026-04-16T23:00:00.000Z']]);
    const probe = state.queries.find((q) => callsOf(q, 'select')[0]?.[1] === 'id')!;
    expect(callsOf(probe, 'lt')).toEqual([
      ['lt', 'ends_at', NOW.toISOString()],
      ['lt', 'starts_at', '2026-04-16T23:00:00.000Z'],
    ]);
    expect(callsOf(probe, 'limit')).toEqual([['limit', 1]]);
    expect(out.history).toEqual({ since: '2026-04-17', until: null, older: true });
  });

  it('a `since` later than the default never narrows it', async () => {
    const out = await loadEventList({ now: NOW, params: new URLSearchParams('since=2026-10-01') });
    expect(out.history).toEqual({ since: '2026-07-16', until: null, older: false });
  });

  it('tells a login with no company from a company read that failed', async () => {
    state.results = { client_company_v: { data: null, error: null } };
    expect((await loadEventList({ now: NOW })).unlinked).toBe(true);
    state.results = { client_company_v: { data: { name: 'Leonardo Hotels' }, error: null } };
    expect((await loadEventList({ now: NOW })).unlinked).toBe(false);
    state.results = { client_company_v: { data: null, error: { message: 'boom' } } };
    expect((await loadEventList({ now: NOW })).unlinked).toBe(false);
  });
});

describe('loadEvent · round 3 additions (ADR-0134 N1–N3)', () => {
  it("asks the event page for the recipients and the dress codes, and reads THC's phone", async () => {
    state.results = {
      client_events_v: {
        data: {
          ...eventRow,
          status: 'upcoming',
          timesheet_recipients: ['a@x.test', ' ', 'b@y.test'],
        },
        error: null,
      },
      client_role_sections_v: {
        data: [
          {
            shift_id: 's1',
            event_id: EV,
            role: 'Waiting Staff',
            starts_at: '2026-10-20T16:00:00Z',
            ends_at: '2026-10-20T22:30:00Z',
            headcount: 4,
            confirmed: 4,
            dress_code: 'Black tie',
          },
        ],
        error: null,
      },
      client_portal_contact_v: { data: { phone: ' 020 7946 0000 ' }, error: null },
    };
    const out = await loadEvent(EV);
    const selects = Object.fromEntries(
      state.queries.map((q) => [q.table, String(q.calls.find((c) => c[0] === 'select')?.[1])]),
    );
    expect(selects.client_events_v).toContain('timesheet_recipients');
    expect(selects.client_role_sections_v).toContain('dress_code');
    expect(selects.client_portal_contact_v).toBe('phone');
    expect(out.event?.timesheetRecipients).toEqual(['a@x.test', 'b@y.test']);
    expect(out.sections[0]?.dressCode).toBe('Black tie');
    expect(out.thcPhone).toBe('020 7946 0000');
  });

  it('never asks the list for either: what the list does not draw, it is not sent', async () => {
    state.results = { client_events_v: { data: [eventRow], error: null } };
    await loadEventList();
    for (const q of state.queries) {
      const columns = String(q.calls.find((c) => c[0] === 'select')?.[1] ?? '');
      expect(columns).not.toContain('timesheet_recipients');
      expect(columns).not.toContain('dress_code');
    }
    expect(state.tables).not.toContain('client_portal_contact_v');
  });

  it('a failed phone read hides the number and keeps the page, logging the detail', async () => {
    state.results = {
      client_events_v: { data: eventRow, error: null },
      client_portal_contact_v: { data: null, error: { message: LEAK, code: '42501' } },
    };
    const out = await loadEvent(EV);
    expect(out.problem).toBeNull();
    expect(out.event?.title).toBe('Gala Dinner');
    expect(out.thcPhone).toBeNull();
    expect(JSON.stringify(logged)).toContain('THC phone');
  });

  it('an empty number, or no row (an unlinked login), is no number', async () => {
    state.results = {
      client_events_v: { data: eventRow, error: null },
      client_portal_contact_v: { data: { phone: null }, error: null },
    };
    expect((await loadEvent(EV)).thcPhone).toBeNull();
    state.results.client_portal_contact_v = { data: null, error: null };
    expect((await loadEvent(EV)).thcPhone).toBeNull();
  });
});
