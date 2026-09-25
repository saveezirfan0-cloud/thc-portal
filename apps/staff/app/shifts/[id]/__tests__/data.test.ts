import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * §5.1, §10.4 · what the shift screen reads, and where from.
 *
 * docs/15 §2 blocker 1: this loader used to read `bookings` and EMBED
 * shift_requirements, events, roles, check_logs and breaks. The staff role
 * reads none of those tables (ADR-0004 — they carry the charge rate and
 * other workers' records), so for a real worker every embed was null and
 * the check-in screen had no times, venue or role. It now reads one
 * `security definer` function, `staff_shift_detail()`, and no table at all;
 * 560_staff_shift_detail.sql holds the function to the caller's own
 * bookings and to columns with no charge rate in them.
 *
 * Which check log the screen gets — the ACCEPTED press, with a manager's
 * finish preferred — is decided in that function's SQL now, the same
 * lateral `payable_shifts_v` and `check_out()` use. What is tested here is
 * that the loader asks for the right thing and maps what comes back.
 */

const rpc = vi.fn();
const from = vi.fn();

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({
    from: (...args: unknown[]) => from(...args),
    rpc: (...args: unknown[]) => rpc(...args),
  }),
}));

const { loadShift } = await import('../data');
const { shiftPhase } = await import('../phase');

const START = '2026-06-14T16:00:00Z'; // 17:00 UK
const END = '2026-06-14T22:30:00Z'; // 23:30 UK

const row = (over: Record<string, unknown> = {}) => ({
  booking_id: 'b1',
  status: 'worked',
  confirmed_at: '2026-06-12T09:00:00Z',
  cancel_cause: null,
  starts_at: START,
  ends_at: END,
  pay_rate: 15,
  dress_code: 'Black tie',
  role: 'Waiting Staff',
  event_title: 'Autumn Gala',
  event_date: '2026-06-14',
  venue_name: 'Mandarin Oriental',
  venue_address: '66 Knightsbridge',
  venue_lat: 51.502,
  venue_lng: -0.16,
  geofence_radius_m: 150,
  onsite_contact: 'Priya on 07700 900999',
  notes: null,
  pays_breaks: false,
  event_cancelled_at: null,
  no_checkout_open: false,
  turned_away_at: null,
  turned_away_pay_min: null,
  check_in_at: '2026-06-14T16:04:00Z',
  check_out_at: '2026-06-14T22:33:00Z',
  breaks: [
    { id: 'k2', startedAt: '2026-06-14T20:00:00Z', endedAt: '2026-06-14T20:15:00Z' },
    { id: 'k1', startedAt: '2026-06-14T18:00:00Z', endedAt: '2026-06-14T18:20:00Z' },
  ],
  ...over,
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  rpc.mockReset();
  from.mockReset();
});

describe('loadShift() reads the worker’s own shift through staff_shift_detail()', () => {
  it('asks the definer function for this booking, and reads no table', async () => {
    rpc.mockResolvedValue({ data: [row()], error: null });
    await loadShift('b1');

    expect(rpc).toHaveBeenCalledWith('staff_shift_detail', { p_booking: 'b1' });
    expect(from).not.toHaveBeenCalled();
  });

  it('carries the times, venue and role the embed used to lose', async () => {
    rpc.mockResolvedValue({ data: [row()], error: null });
    const shift = await loadShift('b1');

    expect(shift).toMatchObject({
      bookingId: 'b1',
      eventTitle: 'Autumn Gala',
      roleName: 'Waiting Staff',
      venueName: 'Mandarin Oriental',
      venueAddress: '66 Knightsbridge',
      startsAt: START,
      endsAt: END,
      payRate: 15,
      venueLat: 51.502,
      venueLng: -0.16,
      geofenceRadiusM: 150,
      onsiteContact: 'Priya on 07700 900999',
      breaksLogged: true,
    });
  });

  it('carries the accepted check-in and finish, so a worked shift reads as closed', async () => {
    rpc.mockResolvedValue({ data: [row()], error: null });
    const shift = await loadShift('b1');

    expect(shift?.checkInAt).toBe('2026-06-14T16:04:00Z');
    expect(shift?.checkOutAt).toBe('2026-06-14T22:33:00Z');
    expect(
      shiftPhase({ shift: shift!, openBreak: false, now: new Date('2026-06-14T22:40:00Z') }),
    ).toBe('closed');
  });

  it('lists breaks in the order they were taken', async () => {
    rpc.mockResolvedValue({ data: [row()], error: null });
    const shift = await loadShift('b1');
    expect(shift?.breaks.map((b) => b.id)).toEqual(['k1', 'k2']);
  });

  it('has no Breaks block where the client pays for breaks', async () => {
    rpc.mockResolvedValue({ data: [row({ pays_breaks: true })], error: null });
    expect((await loadShift('b1'))?.breaksLogged).toBe(false);
  });

  it('carries the static-screen inputs (§10.4)', async () => {
    rpc.mockResolvedValue({
      data: [
        row({
          status: 'cancelled',
          cancel_cause: 'office_withdraw',
          event_cancelled_at: null,
          check_in_at: null,
          check_out_at: null,
        }),
      ],
      error: null,
    });
    const shift = await loadShift('b1');
    expect(shift?.cancelCause).toBe('office_withdraw');
    expect(shiftPhase({ shift: shift!, openBreak: false, now: new Date(START) })).toBe('withdrawn');
  });

  it('carries the logged turn-away and the minutes SQL gave it (§3.2, RULE-15)', async () => {
    rpc.mockResolvedValue({
      data: [
        row({
          status: 'turned_away',
          check_in_at: null,
          check_out_at: null,
          turned_away_at: '2026-06-14T15:58:00Z',
          turned_away_pay_min: 240,
        }),
      ],
      error: null,
    });
    const shift = await loadShift('b1');
    expect(shift?.turnedAwayAt).toBe('2026-06-14T15:58:00Z');
    expect(shift?.turnedAwayPayMin).toBe(240);
    expect(shiftPhase({ shift: shift!, openBreak: false, now: new Date(END) })).toBe('turned_away');
  });

  it('keeps a late turn-away’s 0 as 0, and no turn-away as null', async () => {
    rpc.mockResolvedValue({
      data: [row({ status: 'turned_away', turned_away_at: START, turned_away_pay_min: 0 })],
      error: null,
    });
    expect((await loadShift('b1'))?.turnedAwayPayMin).toBe(0);

    rpc.mockResolvedValue({ data: [row()], error: null });
    const plain = await loadShift('b1');
    expect(plain?.turnedAwayAt).toBeNull();
    expect(plain?.turnedAwayPayMin).toBeNull();
  });

  it('returns null for somebody else’s booking, which the function answers with no row', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await loadShift('someone-else')).toBeNull();
  });
});
