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
  weeks: [] as unknown[],
  staff: [] as unknown[],
  bookings: [] as unknown[],
  staffError: false,
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
        : table === 'staff'
          ? rowsFor.staffError
            ? { data: null, error: { message: 'denied' }, count: null }
            : { data: rowsFor.staff, error: null, count: null }
          : table === 'bookings'
            ? { data: rowsFor.bookings, error: null, count: null }
            : { data: [], error: null, count: null };
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'is', 'lt', 'gt', 'order', 'range', 'limit']) {
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
      return Promise.resolve({
        data: fn === 'late_check_out_weeks' ? rowsFor.weeks : rowsFor.late,
        error: null,
      });
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
  rowsFor.weeks = [];
  rowsFor.staff = [];
  rowsFor.bookings = [];
  rowsFor.staffError = false;
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
    expect(rowsFor.rpc).toEqual([
      ['late_check_outs', { p_days: 14, p_include_verified: false }],
      ['late_check_out_weeks', { p_bookings: ['b9'] }],
    ]);
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

  it('reads the week against the cap for the late rows only, in one call', async () => {
    rowsFor.monitor = [
      { booking_id: 'late', status: 'checked_out', late_check_out: true },
      { booking_id: 'ontime', status: 'checked_out', late_check_out: false },
    ];
    rowsFor.weeks = [{ booking_id: 'late', week_hours: '21.25', week_cap_hours: 20 }];
    const data = await loadMonitor();
    expect(rowsFor.rpc).toContainEqual(['late_check_out_weeks', { p_bookings: ['late'] }]);
    expect(data.rows.find((r) => r.bookingId === 'late')).toMatchObject({
      weekHours: 21.25,
      weekCapHours: 20,
    });
    expect(data.rows.find((r) => r.bookingId === 'ontime')?.weekHours).toBeNull();
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

describe('the board links each worker and carries their phone', () => {
  const monitorRow = (staffId: string) => ({
    booking_id: `b-${staffId}`,
    staff_id: staffId,
    status: 'on_shift',
  });

  it('puts the phone on the monitor rows, null where there is none or the worker is removed', async () => {
    rowsFor.monitor = [monitorRow('s1'), monitorRow('s2'), monitorRow('s3')];
    // A removed worker is filtered out of the read (removed_at is null), so s3 is absent.
    rowsFor.staff = [
      { id: 's1', phone: '+447519603667' },
      { id: 's2', phone: null },
    ];
    const data = await loadMonitor();
    const staffRead = recorded.find((r) => r.table === 'staff')!;
    expect(staffRead.calls).toContainEqual(['is', 'removed_at', null]);
    expect(data.rows.map((r) => r.phone)).toEqual(['+447519603667', null, null]);
  });

  it('leaves the phone unread, not "none", when the read fails', async () => {
    rowsFor.monitor = [monitorRow('s1')];
    rowsFor.staffError = true;
    const data = await loadMonitor();
    expect(data.rows[0]!.phone).toBeUndefined();
    expect(data.rows[0]!.staffId).toBe('s1');
  });

  it('reads the worker id and phone on the violation log', async () => {
    rowsFor.violations = [{ ...violationRow(1), staff_id: 's7' }];
    rowsFor.staff = [{ id: 's7', phone: '+447512206030' }];
    const data = await loadMonitor();
    expect(data.violations[0]).toMatchObject({ staffId: 's7', phone: '+447512206030' });
  });

  it('finds the worker of a late sign-out through its booking', async () => {
    rowsFor.late = [
      { booking_id: 'b9', staff_name: 'Grace L.', check_out_at: '2026-10-20T16:15:00Z' },
    ];
    rowsFor.bookings = [{ id: 'b9', staff_id: 's9' }];
    rowsFor.staff = [{ id: 's9', phone: '+447700900123' }];
    const data = await loadMonitor();
    expect(data.lateCheckOuts[0]).toMatchObject({ staffId: 's9', phone: '+447700900123' });
  });
});
