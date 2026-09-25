import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * §10.4 · §5.1 · what the shift screen may read, and from where.
 *
 * Invariant 3 (security.md): the worker sees the base rate only, and holds
 * no select policy on `shift_requirements`, `roles` or `events` — those
 * tables carry the charge rate and every other worker's record. The loader
 * used to embed them off `bookings`, which on a real project returned
 * nothing: a shift with no start, no rate, no venue and a 0 m geofence.
 * Now the role window, the rate and the event come from `staff_bookings()`
 * (security definer, resolves the caller itself) and the venue point from
 * `booking_venue_point`; only the worker's own check log, breaks and
 * violations are read from their tables.
 *
 * `check_logs` is append-only and holds one row per BUTTON PRESS (§1.5): a
 * strict-buffer turn-away, an out-of-radius refusal and the accepted
 * check-in can all sit under one booking. Only the accepted press carries
 * `check_in_at`, and it is the row `check_out()` and `resolve_violation()`
 * update — so it is the only row whose times may reach the worker.
 */

const rpc = vi.fn();
const tables: Record<string, unknown[]> = {};
const reads: string[] = [];

function table(name: string) {
  reads.push(name);
  const result = Promise.resolve({ data: tables[name] ?? [], error: null });
  const builder = {
    select: () => builder,
    eq: () => builder,
    then: result.then.bind(result),
  };
  return builder;
}

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({
    from: (name: string) => table(name),
    rpc: (...a: unknown[]) => rpc(...a),
  }),
}));

const { loadShift } = await import('../data');
const { acceptedLog } = await import('@thc/domain');
const { shiftPhase } = await import('../phase');

const START = '2026-06-14T16:00:00Z'; // 17:00 UK
const END = '2026-06-14T22:30:00Z'; // 23:30 UK

/** One row of `staff_bookings()`, as the RPC returns it. */
const bookingRow = (over: Record<string, unknown> = {}) => ({
  booking_id: 'b1',
  status: 'worked',
  source: 'auto',
  created_at: '2026-06-10T09:00:00Z',
  confirmed_at: '2026-06-12T09:00:00Z',
  day_before_confirmed_at: null,
  on_day_confirmed_at: null,
  reconfirm_required: false,
  reconfirm_reason: null,
  applied_at: null,
  cancelled_at: null,
  cancel_cause: null,
  shift_id: 's1',
  starts_at: START,
  ends_at: END,
  pay_rate: 15,
  dress_code: 'Black tie',
  headcount: 6,
  buffer: 1,
  confirmed_count: 6,
  role: 'Waiting Staff',
  event_id: 'e1',
  event_title: 'Autumn Gala',
  event_date: '2026-06-14',
  venue_name: 'Mandarin Oriental',
  venue_address: '66 Knightsbridge',
  event_cancelled_at: null,
  distance_km: 4.1,
  onsite_contact: null,
  notes: null,
  pays_breaks: false,
  no_checkout_open: false,
  hours_limit: false,
  week_start: null,
  booked_hours: null,
  cap_hours: null,
  ...over,
});

const TURN_AWAY = {
  check_in_at: null,
  check_out_at: null,
  manager_finish_at: null,
  outcome: 'turned_away',
  attempted_at: '2026-06-14T15:58:00Z',
};
const CHECKED_IN = {
  check_in_at: '2026-06-14T16:04:00Z',
  check_out_at: '2026-06-14T22:33:00Z',
  manager_finish_at: null,
  outcome: 'checked_in',
  attempted_at: '2026-06-14T16:04:00Z',
};

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  for (const key of Object.keys(tables)) delete tables[key];
  reads.length = 0;
  rpc.mockReset();
  rpc.mockImplementation(async (fn: string) => {
    if (fn === 'staff_bookings') return { data: [bookingRow()], error: null };
    if (fn === 'booking_venue_point')
      return { data: { lat: 51.5, lng: -0.16, radiusM: 150 }, error: null };
    return { data: null, error: null };
  });
});

describe('loadShift() reads through the guarded RPCs, never the money tables', () => {
  it('takes the role window, rate and event from staff_bookings()', async () => {
    tables.check_logs = [CHECKED_IN];
    const shift = await loadShift('b1');

    expect(rpc).toHaveBeenCalledWith('staff_bookings');
    expect(shift?.startsAt).toBe('2026-06-14T16:00:00.000Z');
    expect(shift?.endsAt).toBe('2026-06-14T22:30:00.000Z');
    expect(shift?.payRate).toBe(15);
    expect(shift?.roleName).toBe('Waiting Staff');
    expect(shift?.eventTitle).toBe('Autumn Gala');
    expect(shift?.venueName).toBe('Mandarin Oriental');
    expect(shift?.geofenceRadiusM).toBe(150);
    expect(shift?.venueLat).toBe(51.5);
    expect(shift?.breaksLogged).toBe(true);
    expect(shift?.eventDate).toBe('2026-06-14');
  });

  it('never selects shift_requirements, roles or events directly', async () => {
    tables.check_logs = [CHECKED_IN];
    await loadShift('b1');
    expect(reads.sort()).toEqual(['breaks', 'check_logs', 'violations']);
  });

  it('returns nothing for a booking staff_bookings() does not hand back (RLS decides)', async () => {
    expect(await loadShift('someone-elses')).toBeNull();
    expect(reads).toEqual([]);
  });

  it('carries the static-screen facts: cancelled event, withdrawn booking, open No check-out', async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === 'staff_bookings'
        ? {
            data: [
              bookingRow({
                status: 'cancelled',
                cancel_cause: 'office_withdraw',
                event_cancelled_at: '2026-06-13T10:00:00Z',
                no_checkout_open: true,
              }),
            ],
            error: null,
          }
        : { data: null, error: null },
    );
    const shift = await loadShift('b1');
    expect(shift?.cancelCause).toBe('office_withdraw');
    expect(shift?.eventCancelledAt).toBe('2026-06-13T10:00:00.000Z');
    expect(shift?.noCheckoutOpen).toBe(true);
    expect(shift?.noCheckOut).toBe('unresolved');
  });

  it('reads the violations RULE-14 needs: Left early, and whether No check-out is resolved', async () => {
    tables.check_logs = [CHECKED_IN];
    tables.violations = [
      { type: 'left_early', resolved: true },
      { type: 'no_checkout', resolved: true },
    ];
    const shift = await loadShift('b1');
    expect(shift?.leftEarly).toBe(true);
    expect(shift?.noCheckOut).toBe('resolved');
    expect(shift?.noCheckoutOpen).toBe(false);
  });
});

describe('loadShift() reads the press that checked the worker in', () => {
  it('shows the check-in, not the turn-away logged before it', async () => {
    tables.check_logs = [TURN_AWAY, CHECKED_IN];

    const shift = await loadShift('b1');

    expect(shift?.checkInAt).toBe('2026-06-14T16:04:00Z');
    expect(shift?.checkOutAt).toBe('2026-06-14T22:33:00Z');
    // What the worker actually sees: a closed shift, not an open check-in
    // button offering to check them in a second time.
    expect(
      shiftPhase({ shift: shift!, openBreak: false, now: new Date('2026-06-14T22:40:00Z') }),
    ).toBe('closed');
  });

  it('is the same answer whichever order the rows arrive in', async () => {
    tables.check_logs = [CHECKED_IN, TURN_AWAY];
    expect((await loadShift('b1'))?.checkInAt).toBe('2026-06-14T16:04:00Z');
  });

  it('prefers the manager-entered finish on that same row (RULE-02)', async () => {
    tables.check_logs = [TURN_AWAY, { ...CHECKED_IN, manager_finish_at: '2026-06-14T22:15:00Z' }];
    expect((await loadShift('b1'))?.checkOutAt).toBe('2026-06-14T22:15:00Z');
  });

  it('invents no check-in for a worker who was only ever turned away, and keeps the attempt (RULE-15)', async () => {
    tables.check_logs = [TURN_AWAY];
    rpc.mockImplementation(async (fn: string) =>
      fn === 'staff_bookings'
        ? { data: [bookingRow({ status: 'turned_away' })], error: null }
        : { data: null, error: null },
    );

    const shift = await loadShift('b1');

    expect(shift?.checkInAt).toBeNull();
    expect(shift?.checkOutAt).toBeNull();
    expect(shift?.turnedAwayAt).toBe('2026-06-14T15:58:00Z');
    expect(
      shiftPhase({ shift: shift!, openBreak: false, now: new Date('2026-06-14T16:10:00Z') }),
    ).toBe('turned_away');
  });

  it('sorts the breaks by start, oldest first', async () => {
    tables.check_logs = [CHECKED_IN];
    tables.breaks = [
      { id: '2', started_at: '2026-06-14T20:00:00Z', ended_at: '2026-06-14T20:15:00Z' },
      { id: '1', started_at: '2026-06-14T18:00:00Z', ended_at: null },
    ];
    expect((await loadShift('b1'))?.breaks.map((b) => b.id)).toEqual(['1', '2']);
  });
});

describe('acceptedLog()', () => {
  it('takes the earliest accepted press, as `order by check_in_at limit 1` does', () => {
    const later = { check_in_at: '2026-06-14T17:00:00Z' };
    const earlier = { check_in_at: '2026-06-14T16:04:00Z' };
    expect(acceptedLog([TURN_AWAY, later, earlier])).toBe(earlier);
  });

  it('returns null when nothing was ever accepted', () => {
    expect(acceptedLog([TURN_AWAY, TURN_AWAY])).toBeNull();
    expect(acceptedLog([])).toBeNull();
    expect(acceptedLog(null)).toBeNull();
  });
});
