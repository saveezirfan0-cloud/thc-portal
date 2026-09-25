import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShiftDetail } from '../types';

/**
 * `GET /shifts/:id/calendar.ics` — the worker's own live booking only, as
 * `staff_shift_detail()` returns it; everything the shift screen would not
 * show as a live shift is a 404.
 */
const shift = vi.fn<() => Promise<ShiftDetail | null>>();
vi.mock('../data', () => ({
  supabaseConfigured: () => true,
  loadShift: () => shift(),
}));

const { GET } = await import('../calendar.ics/route');

const ahead = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
const detail = (over: Partial<ShiftDetail> = {}): ShiftDetail => ({
  bookingId: 'b1',
  status: 'confirmed',
  confirmedAt: '2026-06-12T09:00:00Z',
  eventTitle: 'Autumn Gala',
  eventDate: '2026-06-14',
  venueName: 'Mandarin Oriental',
  venueAddress: '66 Knightsbridge',
  onsiteContact: null,
  notes: null,
  dressCode: 'Black tie',
  roleName: 'Waiting Staff',
  startsAt: ahead(24 * 60),
  endsAt: ahead(30 * 60),
  payRate: 15,
  venueLat: 51.502,
  venueLng: -0.16,
  geofenceRadiusM: 150,
  breaksLogged: true,
  checkInAt: null,
  checkOutAt: null,
  breaks: [],
  eventCancelledAt: null,
  cancelCause: null,
  noCheckoutOpen: false,
  turnedAwayAt: null,
  turnedAwayPayMin: null,
  ...over,
});

const get = () =>
  GET(new Request('https://staff.example/shifts/b1/calendar.ics'), {
    params: Promise.resolve({ id: 'b1' }),
  });

beforeEach(() => shift.mockReset());

describe('GET /shifts/:id/calendar.ics', () => {
  it('answers a confirmed booking with text/calendar, never cached', async () => {
    shift.mockResolvedValue(detail());
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const body = await res.text();
    expect(body).toContain('SUMMARY:Autumn Gala · Waiting Staff');
    expect(body).toContain('URL:https://staff.example/shifts/b1');
    expect(body).not.toContain('£');
  });

  it.each([
    ['not the worker’s (no row)', null],
    ['an invitation', detail({ status: 'invited' })],
    ['the worker’s own cancel', detail({ status: 'cancelled', cancelCause: 'self_cancel' })],
    ['a cancelled event', detail({ eventCancelledAt: '2026-06-13T09:00:00Z' })],
    ['a withdrawn booking', detail({ status: 'cancelled', cancelCause: 'office_withdraw' })],
    ['a turn-away', detail({ status: 'turned_away' })],
  ])('is a 404 for %s', async (_case, row) => {
    shift.mockResolvedValue(row);
    expect((await get()).status).toBe(404);
  });
});
