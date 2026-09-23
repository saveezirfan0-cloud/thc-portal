import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * §5.1 · which check log the shift screen is allowed to read.
 *
 * `check_logs` is append-only and holds one row per BUTTON PRESS (§1.5):
 * a strict-buffer turn-away, an out-of-radius refusal and the accepted
 * check-in can all sit under one booking. Only the accepted press carries
 * `check_in_at`, and it is the row `check_out()` and `resolve_violation()`
 * update — so it is the only row whose times may reach the worker. Taking
 * the first element of the embedded array instead showed a worker who had
 * been turned away and then checked in no check-in at all, on the screen
 * they use to prove they are on shift and next to the RULE-01 pay window.
 *
 * The loader is exercised through a stubbed PostgREST builder that does NOT
 * apply the filters, because an embedded array has no ordering guarantee:
 * the point of the test is that the answer holds whatever order the rows
 * arrive in.
 */

const maybeSingle = vi.fn();
const rpc = vi.fn();
const calls: Record<string, unknown[][]> = {};

function record(name: string) {
  return (...args: unknown[]) => {
    (calls[name] ??= []).push(args);
    return builder;
  };
}

const builder = {
  select: record('select'),
  eq: record('eq'),
  not: record('not'),
  order: record('order'),
  limit: record('limit'),
  maybeSingle: () => maybeSingle(),
} as unknown as Record<string, unknown>;

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({ from: () => builder, rpc: (...args: unknown[]) => rpc(...args) }),
}));

const { loadShift } = await import('../data');
const { acceptedLog } = await import('@thc/domain');
const { shiftPhase } = await import('../phase');

const START = '2026-06-14T16:00:00Z'; // 17:00 UK
const END = '2026-06-14T22:30:00Z'; // 23:30 UK

/** The turn-away press first, the real check-in second — the order that broke it. */
const booking = (logs: unknown[]) => ({
  id: 'b1',
  status: 'worked',
  confirmed_at: '2026-06-12T09:00:00Z',
  logs,
  breaks: [],
  shift: {
    starts_at: START,
    ends_at: END,
    pay_rate: 15,
    dress_code: 'Black tie',
    role: { name: 'Waiting Staff' },
    event: {
      title: 'Autumn Gala',
      venue_name: 'Mandarin Oriental',
      venue_address: '66 Knightsbridge',
      notes: null,
      onsite_contact: null,
      geofence_radius_m: 150,
      pays_breaks: false,
    },
  },
});

const TURN_AWAY = { check_in_at: null, check_out_at: null, manager_finish_at: null };
const CHECKED_IN = {
  check_in_at: '2026-06-14T16:04:00Z',
  check_out_at: '2026-06-14T22:33:00Z',
  manager_finish_at: null,
};

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  for (const key of Object.keys(calls)) delete calls[key];
  maybeSingle.mockReset();
  rpc.mockReset();
  rpc.mockResolvedValue({ data: null, error: null });
});

describe('loadShift() reads the press that checked the worker in', () => {
  it('shows the check-in, not the turn-away logged before it', async () => {
    maybeSingle.mockResolvedValue({ data: booking([TURN_AWAY, CHECKED_IN]), error: null });

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
    maybeSingle.mockResolvedValue({ data: booking([CHECKED_IN, TURN_AWAY]), error: null });
    expect((await loadShift('b1'))?.checkInAt).toBe('2026-06-14T16:04:00Z');
  });

  it('prefers the manager-entered finish on that same row (RULE-02)', async () => {
    const resolved = { ...CHECKED_IN, manager_finish_at: '2026-06-14T22:15:00Z' };
    maybeSingle.mockResolvedValue({ data: booking([TURN_AWAY, resolved]), error: null });
    expect((await loadShift('b1'))?.checkOutAt).toBe('2026-06-14T22:15:00Z');
  });

  it('invents no check-in for a worker who was only ever turned away', async () => {
    maybeSingle.mockResolvedValue({ data: booking([TURN_AWAY]), error: null });

    const shift = await loadShift('b1');

    expect(shift?.checkInAt).toBeNull();
    expect(shift?.checkOutAt).toBeNull();
  });

  it('asks PostgREST for the same row the SQL lateral takes', async () => {
    maybeSingle.mockResolvedValue({ data: booking([CHECKED_IN]), error: null });
    await loadShift('b1');

    expect(calls.not).toEqual([['logs.check_in_at', 'is', null]]);
    expect(calls.order).toEqual([['check_in_at', { referencedTable: 'logs', ascending: true }]]);
    expect(calls.limit).toEqual([[1, { referencedTable: 'logs' }]]);
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
