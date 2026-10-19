import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callsTo, fakePostgrest, type FakeCall } from '../../_lib/__tests__/fakePostgrest';

/**
 * The event board at full roster (go-live audit 17.10.2026, H2, H5, M3).
 *
 *   · The candidate pool is one row per worker and passes PostgREST's
 *     1000-row cap even after the database drops wrong-role rows: it is
 *     paged, so the board's pool names everyone the engine would.
 *   · The Wave 1 chip reads client_qualifications for the workers the
 *     board names and this event's roles — never the client's whole set,
 *     which is staff × roles and was cut at 1000.
 *   · The reads that need only the event id start with the event itself.
 *   · The pool is read per section, apart from the line-up (ADR-0161): the
 *     board's first read never waits for `auto_assign_candidates`.
 */

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('@thc/db/server', () => ({ createClient: () => state.db }));

const { loadBoard, loadSectionPools } = await import('../[id]/board-data');
type Board = NonNullable<Awaited<ReturnType<typeof loadBoard>>['event']>;

/** Section `n`'s streamed pool, as `SectionPools` reads it. */
async function poolsOf(event: Board, n = 0) {
  const section = event.sections[n]!;
  return loadSectionPools(section.poolInput, event.known, event.weights);
}

const pad = (n: number) => String(n).padStart(4, '0');
const EVENT = {
  id: 'ev-1',
  title: 'Gala Dinner',
  event_date: '2099-07-03',
  client_id: 'c-1',
  venue_name: 'Hall',
  venue_address: '1 Street',
  po_number: null,
  notes: null,
  onsite_contact: null,
  auto_assign: true,
  required_languages: null,
  series_id: null,
  pays_breaks: true,
  pays_buffer: true,
  cancelled_at: null,
  cancel_reason: null,
  payroll_exported_at: null,
  document_recipients: null,
};
const SECTION = {
  id: 'sec-1',
  role_id: 'r-1',
  starts_at: '2099-07-03T16:00:00Z',
  ends_at: '2099-07-03T22:00:00Z',
  headcount: 6,
  buffer: 1,
  dress_code: null,
  auto_assign: true,
  required_gender: null,
  same_staff_all_days: false,
  allocation_per_hour: 7,
};
const POOL = Array.from({ length: 1500 }, (_, n) => ({
  staff_id: `w-${pad(n)}`,
  gate: null,
  qualified: n >= 1400,
  booking_status: null,
  reliability: 0.9,
  rating: 4,
  distance_km: 5,
  future_shifts: 1,
  venue_times: 0,
  booking_cause: null,
}));
const STAFF = POOL.map((row, n) => ({
  id: row.staff_id,
  first_name: 'Worker',
  last_name: pad(n),
  removed_at: null,
  employee_id: n,
  photo_path: null,
}));
// The client's whole qualification set: far more than the board needs.
const QUALS = [
  ...Array.from({ length: 1800 }, (_, n) => ({ staff_id: `other-${n}`, role_id: 'r-1' })),
  ...POOL.filter((row) => row.qualified).map((row) => ({ staff_id: row.staff_id, role_id: 'r-1' })),
  { staff_id: 'w-0001', role_id: 'r-other' },
];

/** Applies the `in` filters a call carries, as PostgREST would. */
const filtered =
  <T extends Record<string, unknown>>(rows: readonly T[]) =>
  (call: FakeCall) =>
    rows.filter((row) =>
      call.filters.every(([op, column, values]) =>
        op === 'in' ? (values as unknown[]).includes(row[column as string]) : true,
      ),
    );

let fake: ReturnType<typeof fakePostgrest>;

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  fake = fakePostgrest(SOURCES());
  state.db = fake;
});

function SOURCES() {
  return {
    events: [EVENT],
    shift_requirements: [SECTION],
    roles: [{ id: 'r-1', name: 'Waiter' }],
    settings: [],
    shift_rates_v: [],
    clients: [{ name: 'Acme', name_badges: false, contact_emails: [] }],
    bookings: [],
    auto_assign_candidates: POOL,
    auto_assign_unavailable: [],
    shift_offers: [],
    staff: filtered(STAFF),
    staff_roles: filtered(STAFF.map((s) => ({ staff_id: s.id, role_id: 'r-1' }))),
    client_qualifications: filtered(QUALS),
    violations: [],
    check_logs: [],
  };
}

// Thousands of fake rows per read: slow on a loaded CI runner, not a hang.
describe('loadBoard at full roster', { timeout: 30_000 }, () => {
  it('the pool names all 1,500 eligible workers, not the first 1,000', async () => {
    const { event, problem } = await loadBoard('ev-1', new Date('2099-07-01T12:00:00Z'));
    expect(problem).toBeNull();
    const pool = (await poolsOf(event!)).pool!;
    expect(pool).toHaveLength(1500);
    const pages = callsTo(fake.calls, 'auto_assign_candidates');
    expect(pages.map((c) => c.range)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(pages[0]!.orders.map(([column]) => column)).toEqual(['staff_id']);
    // The wrong-role filter still runs in the database.
    expect(pages[0]!.filters[0]![0]).toBe('or');
  });

  it('Wave 1 comes from the named workers and this event’s roles, not the whole set', async () => {
    // The line-up's Wave 1 chip: 300 invited workers, 100 of them qualified
    // here (1400–1499) — past row 1,000 of the client's whole set.
    fake = fakePostgrest({
      ...SOURCES(),
      bookings: Array.from({ length: 300 }, (_, n) => ({
        id: `b-${pad(n)}`,
        shift_id: 'sec-1',
        staff_id: `w-${pad(1200 + n)}`,
        status: 'invited',
        source: 'auto',
        created_at: '2099-06-01T09:00:00Z',
        confirmed_at: null,
        day_before_confirmed_at: null,
        applied_at: null,
        reconfirm_required: false,
        cancel_cause: null,
      })),
    });
    state.db = fake;
    const { event: invited } = await loadBoard('ev-1', new Date('2099-07-01T12:00:00Z'));
    expect(invited!.sections[0]!.invited.filter((b) => b.qualified)).toHaveLength(100);
    const quals = callsTo(fake.calls, 'client_qualifications');
    expect(quals.length).toBeGreaterThan(0);
    for (const call of quals) {
      const ops = call.filters.map(([op, column]) => `${op}:${String(column)}`);
      expect(ops).toEqual(
        expect.arrayContaining(['in:staff_id', 'eq:client_id', 'eq:do_not_return', 'in:role_id']),
      );
      const ids = call.filters.find(([op, column]) => op === 'in' && column === 'staff_id')![2];
      expect((ids as string[]).length).toBeLessThanOrEqual(150);
    }
    // The pool's Wave 1 is the candidate function's own `qualified`.
    state.db = fake = fakePostgrest(SOURCES());
    const { event } = await loadBoard('ev-1', new Date('2099-07-01T12:00:00Z'));
    const pool = (await poolsOf(event!)).pool!;
    expect(pool[0]!.wave).toBe(1);
    expect(pool.filter((entry) => entry.wave === 1)).toHaveLength(100);
  });

  it('pages the availability calendar and the shift offers, in a total order', async () => {
    const away = Array.from({ length: 1200 }, (_, n) => ({
      staff_id: `w-${pad(n)}`,
      starts_at: '2099-07-03T00:00:00Z',
      ends_at: '2099-07-04T00:00:00Z',
    }));
    const offers = Array.from({ length: 1100 }, (_, n) => ({
      id: `o-${pad(n)}`,
      booking_id: `b-${pad(n)}`,
      shift_id: 'sec-1',
      mode: 'pool',
      status: 'taken',
      note: null,
      expires_at: '2099-07-03T10:00:00Z',
      closed_at: '2099-07-02T10:00:00Z',
      taken_by_booking_id: null,
    }));
    fake = fakePostgrest({
      ...SOURCES(),
      auto_assign_unavailable: away,
      shift_offers: offers,
    });
    state.db = fake;
    const { event, problem } = await loadBoard('ev-1', new Date('2099-07-01T12:00:00Z'));
    expect(problem).toBeNull();
    const { pool } = await poolsOf(event!);
    const calendar = callsTo(fake.calls, 'auto_assign_unavailable');
    expect(calendar.map((c) => c.range)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(calendar[0]!.orders.map(([column]) => column)).toEqual([
      'staff_id',
      'starts_at',
      'ends_at',
    ]);
    // All 1,200 marked unavailable: none of them is offered in the pool.
    expect(pool).toHaveLength(300);
    expect(pool!.every((entry) => entry.staffId >= 'w-1200')).toBe(true);
    const offerPages = callsTo(fake.calls, 'shift_offers');
    expect(offerPages).toHaveLength(2);
    expect(event!.sections[0]!.handovers).toHaveLength(1100);
  });

  it('starts the section, role, settings and rate reads with the event read', async () => {
    await loadBoard('ev-1', new Date('2099-07-01T12:00:00Z'));
    const order = fake.calls.map((c) => c.name);
    const firstRound = order.slice(0, 5).sort();
    expect(firstRound).toEqual([
      'events',
      'roles',
      'settings',
      'shift_rates_v',
      'shift_requirements',
    ]);
  });

  it('the first read never computes a pool: the line-up does not wait for it', async () => {
    const { event, problem } = await loadBoard('ev-1', new Date('2099-07-01T12:00:00Z'));
    expect(problem).toBeNull();
    expect(event!.sections[0]!.confirmed).toEqual([]);
    expect(callsTo(fake.calls, 'auto_assign_candidates')).toEqual([]);
    expect(callsTo(fake.calls, 'auto_assign_unavailable')).toEqual([]);
    expect(event!.sections[0]!.poolInput).toMatchObject({ shiftId: 'sec-1', escalation: false });
  });

  it('the pool names only the candidates the first read did not', async () => {
    fake = fakePostgrest({
      ...SOURCES(),
      bookings: [
        {
          id: 'b-1',
          shift_id: 'sec-1',
          staff_id: 'w-0001',
          status: 'confirmed',
          source: 'manual',
          created_at: '2099-06-01T09:00:00Z',
          confirmed_at: '2099-06-01T09:00:00Z',
          day_before_confirmed_at: null,
          applied_at: null,
          reconfirm_required: false,
          cancel_cause: null,
        },
      ],
    });
    state.db = fake;
    const { event } = await loadBoard('ev-1', new Date('2099-07-01T12:00:00Z'));
    expect(event!.known.people.get('w-0001')?.name).toBe('Worker 0.');
    const before = callsTo(fake.calls, 'staff').length;
    await poolsOf(event!);
    const asked = callsTo(fake.calls, 'staff')
      .slice(before)
      .flatMap((call) => call.filters.find(([op]) => op === 'in')![2] as string[]);
    expect(asked).toHaveLength(1499);
    expect(asked).not.toContain('w-0001');
  });

  it('a pool that cannot be computed is the section’s problem, not the board’s', async () => {
    fake = fakePostgrest(SOURCES(), {
      errors: { auto_assign_candidates: { code: '57014', message: 'timeout' } },
    });
    state.db = fake;
    const { event, problem } = await loadBoard('ev-1', new Date('2099-07-01T12:00:00Z'));
    expect(problem).toBeNull();
    const pools = await poolsOf(event!);
    expect(pools.pool).toBeNull();
    expect(pools.poolProblem).toBeTruthy();
  });
});
