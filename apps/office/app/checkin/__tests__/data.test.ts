import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * /checkin's reads (§9.5): the violation log is filtered and paged IN THE
 * QUERY (audit D50), and the monitor asks for the sections that overlap
 * today's UK day. A recording fake stands in for PostgREST.
 */
type Call = [string, ...unknown[]];
interface Recorded {
  table: string;
  calls: Call[];
}

const recorded: Recorded[] = [];
const rowsFor = vi.hoisted(() => ({
  violations: [] as unknown[],
  monitor: [] as unknown[],
  late: [] as unknown[],
  rpc: [] as unknown[][],
}));

function builder(table: string) {
  const rec: Recorded = { table, calls: [] };
  recorded.push(rec);
  const result = () =>
    table === 'violations'
      ? { data: rowsFor.violations, error: null, count: 7 }
      : table === 'checkin_monitor_v'
        ? { data: rowsFor.monitor, error: null, count: null }
        : { data: [], error: null, count: null };
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'lt', 'gt', 'order', 'range', 'limit']) {
    b[m] = (...args: unknown[]) => {
      rec.calls.push([m, ...args]);
      return b;
    };
  }
  b['then'] = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
  return b;
}

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({
    from: (t: string) => builder(t),
    rpc: (fn: string, args: unknown) => {
      rowsFor.rpc.push([fn, args]);
      return Promise.resolve({ data: rowsFor.late, error: null });
    },
  }),
}));
vi.mock('../../_lib/photos', () => ({ signStaffPhotos: async () => new Map() }));

const { loadMonitor } = await import('../data');

const violationRow = (i: number) => ({
  id: `v${i}`,
  booking_id: 'b',
  type: 'left_early',
  detected_at: '2026-09-17T19:48:00Z',
  resolved: false,
  staff: { first_name: 'Omar', last_name: 'S.' },
  booking: { shift: { event: { title: 'Press Night' } }, logs: [] },
});

beforeEach(() => {
  recorded.length = 0;
  rowsFor.violations = [];
  rowsFor.monitor = [];
  rowsFor.late = [];
  rowsFor.rpc = [];
  process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'http://supabase.test';
  process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'anon';
});

const logRead = () =>
  recorded.find((r) => r.table === 'violations' && r.calls.some((c) => c[0] === 'range'))!;
const countRead = () =>
  recorded.find(
    (r) =>
      r.table === 'violations' &&
      r.calls.some((c) => c[0] === 'select' && (c[2] as { head?: boolean })?.head),
  )!;

describe('the violation log read (§9.5, D50)', () => {
  it('asks the database for unresolved entries only, by default', async () => {
    await loadMonitor();
    expect(logRead().calls).toContainEqual(['eq', 'resolved', false]);
    expect(logRead().calls).toContainEqual(['range', 0, 100]);
    expect(logRead().calls).toContainEqual(['order', 'detected_at', { ascending: false }]);
  });

  it('with Show resolved ticked, it asks for both', async () => {
    await loadMonitor({ showResolved: true, page: 2 });
    expect(logRead().calls.some((c) => c[0] === 'eq' && c[1] === 'resolved')).toBe(false);
    expect(logRead().calls).toContainEqual(['range', 100, 200]);
  });

  it('counts every unresolved violation, not just the page', async () => {
    const data = await loadMonitor();
    expect(countRead().calls).toContainEqual(['eq', 'resolved', false]);
    expect(data.unresolvedCount).toBe(7);
  });

  it('shows a page and says whether there is an older one', async () => {
    rowsFor.violations = Array.from({ length: 101 }, (_, i) => violationRow(i));
    const data = await loadMonitor();
    expect(data.violations).toHaveLength(100);
    expect(data.hasMore).toBe(true);
    expect(data.violations[0]!.flaggedAs).toBe('Checked out early — Press Night');
  });
});

describe('the monitor read (§9.5, §1.8)', () => {
  it('asks for sections that overlap today’s UK day', async () => {
    await loadMonitor();
    const monitor = recorded.find((r) => r.table === 'checkin_monitor_v')!;
    const lt = monitor.calls.find((c) => c[0] === 'lt')!;
    const gt = monitor.calls.find((c) => c[0] === 'gt')!;
    expect(lt[1]).toBe('starts_at');
    expect(gt[1]).toBe('ends_at');
    expect(Date.parse(lt[2] as string) - Date.parse(gt[2] as string)).toBeGreaterThanOrEqual(
      23 * 3_600_000,
    );
  });
});

describe('the monitor read carries the location flag (20261012121200)', () => {
  const monitorRow = (extra: Record<string, unknown>) => ({
    booking_id: 'b1',
    staff_id: 's1',
    event_id: 'e1',
    starts_at: '2026-09-17T16:00:00Z',
    ends_at: '2026-09-17T22:00:00Z',
    check_in_at: '2026-09-17T15:58:00Z',
    status: 'on_shift',
    ...extra,
  });

  it('reads location_suspect from checkin_monitor_v', async () => {
    rowsFor.monitor = [monitorRow({ location_suspect: true })];
    const data = await loadMonitor();
    expect(data.rows[0]?.locationSuspect).toBe(true);
  });

  it('reads a database without the column as not flagged', async () => {
    rowsFor.monitor = [monitorRow({})];
    const data = await loadMonitor();
    expect(data.rows[0]?.locationSuspect).toBe(false);
  });
});

describe('the late sign-outs to verify (ADR-0184)', () => {
  it('asks for the last fortnight, unverified only, and reads each row', async () => {
    rowsFor.late = [
      {
        booking_id: 'b9',
        staff_name: 'Grace L.',
        photo_path: null,
        event_title: 'Gala Dinner',
        venue_name: 'The Dorchester',
        role_name: 'Waiting Staff',
        starts_at: '2026-10-20T11:00:00Z',
        ends_at: '2026-10-20T15:00:00Z',
        check_in_at: '2026-10-20T11:00:00Z',
        check_out_at: '2026-10-20T16:15:00Z',
        finish_by_office: false,
        minutes_past_end: 75,
        verified_at: null,
        verified_by_name: null,
        note: null,
      },
    ];
    const data = await loadMonitor();
    expect(rowsFor.rpc).toEqual([['late_check_outs', { p_days: 14, p_include_verified: false }]]);
    expect(data.lateCheckOuts).toEqual([
      expect.objectContaining({
        bookingId: 'b9',
        staffName: 'Grace L.',
        photoUrl: null,
        checkOutAt: '2026-10-20T16:15:00Z',
        minutesPastEnd: 75,
        finishByOffice: false,
        verifiedAt: null,
      }),
    ]);
  });

  it('reads the verification off the monitor row', async () => {
    rowsFor.monitor = [
      {
        booking_id: 'b1',
        status: 'checked_out',
        late_check_out: true,
        late_check_out_verified_at: '2026-10-21T09:00:00Z',
        late_check_out_verified_by_name: 'Sam S.',
        late_check_out_note: 'Client asked them to stay',
      },
    ];
    const data = await loadMonitor();
    expect(data.rows[0]).toMatchObject({
      lateCheckOut: true,
      lateCheckOutVerifiedAt: '2026-10-21T09:00:00Z',
      lateCheckOutVerifiedByName: 'Sam S.',
      lateCheckOutNote: 'Client asked them to stay',
    });
  });
});
