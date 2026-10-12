import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the portal's pages hand the browser, and what they never do.
 *
 *   · A database error is logged on the server and the customer reads the
 *     generic LOAD_FAILED sentence — never Postgres's own words. An id that
 *     is not a uuid is not-found before any query is made, because handed
 *     to PostgREST it comes back as "invalid input syntax for type uuid".
 *   · The line-up's `photo_path` stays on the server. Its first segment is
 *     the worker's staff.id; the browser gets a signed URL keyed by
 *     bookingId, and nothing in a client component's props carries the path.
 */
const STAFF_ID = '7d0c5a8e-1f2b-4c3d-9e8f-0a1b2c3d4e5f';
const EVENT_ID = '3f2b9c1a-6d4e-4f5a-8b7c-1d2e3f4a5b6c';
const BOOKING_ID = 'b1b2b3b4-c5c6-4d7d-8e8e-f9f0a1a2b3b4';
const PATH = `${STAFF_ID}/selfie-1727000000.jpg`;

const state = vi.hoisted(() => ({
  tables: [] as string[],
  selects: [] as string[],
  failWith: null as null | { code: string; message: string },
}));

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('@thc/db/admin', () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({
        // An opaque URL, so the assertions below test the props and not
        // what Supabase happens to put in a signed link.
        createSignedUrls: async (paths: string[]) => ({
          data: paths.map((path, i) => ({ path, signedUrl: `https://signed.test/p${i}?token=t` })),
          error: null,
        }),
      }),
    },
  }),
}));

function rowsFor(table: string): unknown {
  switch (table) {
    case 'client_events_v':
      return {
        id: EVENT_ID,
        title: 'Gala Dinner',
        venue_name: 'Leonardo Royal Hotel',
        venue_address: '8-14 Cooper’s Row, London EC3N 2BQ',
        event_date: '2026-09-19',
        po_number: 'PO-4471',
        onsite_contact: 'Marco Vitale · 07700 900123',
        starts_at: '2026-09-19T16:00:00Z',
        ends_at: '2026-09-19T23:00:00Z',
        status: 'upcoming',
      };
    case 'client_lineup_v':
      return [
        {
          booking_id: BOOKING_ID,
          event_id: EVENT_ID,
          shift_id: 'a0a0a0a0-b1b1-4c2c-8d3d-e4e4e4e4e4e4',
          role: 'Waiting Staff',
          starts_at: '2026-09-19T16:00:00Z',
          ends_at: '2026-09-19T23:00:00Z',
          name: 'Priya Shah',
          photo_path: PATH,
          sort_key: 'shah',
          feedback_given: false,
        },
        {
          booking_id: 'c1c2c3c4-d5d6-4e7e-8f8f-a9a0b1b2c3c4',
          event_id: EVENT_ID,
          shift_id: 'a0a0a0a0-b1b1-4c2c-8d3d-e4e4e4e4e4e4',
          role: 'Waiting Staff',
          starts_at: '2026-09-19T16:00:00Z',
          ends_at: '2026-09-19T23:00:00Z',
          name: 'Deleted account #1042',
          photo_path: null,
          sort_key: 'zzzz-deleted-1042',
          feedback_given: false,
        },
      ];
    default:
      return [];
  }
}

vi.mock('@thc/db/server', () => ({
  createClient: () => ({
    from: (table: string) => {
      state.tables.push(table);
      const many = state.failWith
        ? { data: null, error: state.failWith }
        : { data: [rowsFor(table)].flat(), error: null };
      const one = state.failWith
        ? { data: null, error: state.failWith }
        : { data: Array.isArray(rowsFor(table)) ? null : rowsFor(table), error: null };
      const chain = {
        select: (columns: string) => {
          state.selects.push(`${table}:${columns}`);
          return chain;
        },
        eq: () => chain,
        in: () => chain,
        maybeSingle: async () => one,
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(many).then(resolve, reject),
      };
      return chain;
    },
  }),
}));

const { loadEvent, loadEventList, LOAD_FAILED } = await import('../data');
const { presentLineup, publicLineup } = await import('../photos');
const { isUuid } = await import('../ids');
const { EventScreen } = await import('../events/[id]/EventScreen');
const { EventsScreen } = await import('../EventsScreen');
const EventPage = (await import('../events/[id]/page')).default;
const ListPage = (await import('../page')).default;
const { GET: documentGet } = await import('../events/[id]/document/route');

const saved = { ...process.env };
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
});
afterAll(() => {
  process.env = saved;
});
beforeEach(() => {
  state.tables = [];
  state.selects = [];
  state.failWith = null;
  vi.restoreAllMocks();
});

/** Every element of a given component type in a server component's tree. */
function find(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((n) => find(n, type));
  if (!isValidElement(node)) return [];
  const el = node as ReactElement<Record<string, unknown>>;
  const here = el.type === type ? [el] : [];
  return [...here, ...find(el.props.children as ReactNode, type)];
}

describe('ids', () => {
  it('accepts a Postgres uuid in either case and nothing else', () => {
    expect(isUuid(EVENT_ID)).toBe(true);
    expect(isUuid(EVENT_ID.toUpperCase())).toBe(true);
    for (const bad of [
      'not-a-uuid',
      '',
      `${EVENT_ID}x`,
      ` ${EVENT_ID}`,
      "1' or '1'='1",
      42,
      null,
    ]) {
      expect(isUuid(bad)).toBe(false);
    }
  });
});

describe('a database error never reaches the customer', () => {
  const raw = { code: '22P02', message: 'invalid input syntax for type uuid: "x"' };

  it('the list shows the generic sentence and logs the real one', async () => {
    state.failWith = raw;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const data = await loadEventList();
    expect(data.problem).toBe(LOAD_FAILED.list);
    expect(data.problem).not.toMatch(/syntax|uuid|22P02/);
    expect(JSON.stringify(log.mock.calls)).toContain('invalid input syntax');
  });

  it('the event page shows the generic sentence and logs the real one', async () => {
    state.failWith = raw;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const data = await loadEvent(EVENT_ID);
    expect(data.problem).toBe(LOAD_FAILED.event);
    expect(JSON.stringify(log.mock.calls)).toContain('22P02');
  });

  it('/client/events/not-a-uuid is not-found, without a query', async () => {
    await expect(EventPage({ params: Promise.resolve({ id: 'not-a-uuid' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(state.tables).toEqual([]);
    expect(await loadEvent('not-a-uuid')).toEqual({
      event: null,
      sections: [],
      lineup: [],
      problem: null,
    });
    expect(state.tables).toEqual([]);
  });

  it('the document route answers a non-uuid id with 404, without a query', async () => {
    const res = await documentGet(
      new Request('http://x/client/events/not-a-uuid/document?kind=allocation'),
      { params: Promise.resolve({ id: 'not-a-uuid' }) },
    );
    expect(res.status).toBe(404);
    expect(state.tables).toEqual([]);
  });
});

describe('the worker’s Storage path stays on the server', () => {
  it('signs by booking and strips the path', async () => {
    const { lineup } = await loadEvent(EVENT_ID);
    const shown = await presentLineup(lineup);
    expect(shown.photos).toEqual({ [BOOKING_ID]: 'https://signed.test/p0?token=t' });
    expect(JSON.stringify(shown)).not.toContain(STAFF_ID);
    for (const row of shown.lineup) expect(row).not.toHaveProperty('photoPath');
    // A removed worker has no photo, so no entry at all.
    expect(Object.keys(shown.photos)).toHaveLength(1);
  });

  it('publicLineup names its fields, so a new server column does not ride along', () => {
    const record = {
      bookingId: BOOKING_ID,
      eventId: EVENT_ID,
      shiftId: null,
      role: 'Bar',
      startsAt: 'a',
      endsAt: 'b',
      name: 'n',
      sortKey: 'n',
      feedbackGiven: false,
      photoPath: PATH,
      // A column the server might read one day; the browser must not get it.
      staffId: STAFF_ID,
    };
    const out = publicLineup([record]);
    expect(Object.keys(out[0]!).sort()).toEqual(
      [
        'bookingId',
        'endsAt',
        'eventId',
        'feedbackGiven',
        'name',
        'role',
        'shiftId',
        'sortKey',
        'startsAt',
      ].sort(),
    );
  });

  it('the event page hands EventScreen no staff id, and the photo by booking', async () => {
    const tree = await EventPage({ params: Promise.resolve({ id: EVENT_ID }) });
    const [screen] = find(tree, EventScreen);
    expect(screen).toBeDefined();
    const props = JSON.stringify(screen!.props);
    expect(props).not.toContain(STAFF_ID);
    expect(props).not.toContain('photoPath');
    expect(screen!.props.photos).toEqual({ [BOOKING_ID]: 'https://signed.test/p0?token=t' });
  });

  it('the list page hands EventsScreen no staff id and no on-site contact', async () => {
    const tree = await ListPage();
    const [screen] = find(tree, EventsScreen);
    expect(screen).toBeDefined();
    const props = JSON.stringify(screen!.props);
    expect(props).not.toContain(STAFF_ID);
    expect(props).not.toContain('photoPath');
    expect(state.selects.find((s) => s.startsWith('client_events_v:'))).not.toMatch(
      /onsite_contact/,
    );
  });
});
