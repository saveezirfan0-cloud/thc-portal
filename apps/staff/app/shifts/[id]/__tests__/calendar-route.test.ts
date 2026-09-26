import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShiftDetail } from '../types';
import type { StaffProfile } from '../../../profile/types';

/**
 * `GET /shifts/:id/calendar.ics` — the worker's own live booking only, as
 * `staff_shift_detail()` returns it; everything the shift screen would not
 * show as a live shift is a 404 — and so is everything for a worker the
 * app is locked to (§10.1, `appLock()`), so the URL is no way round the lock.
 */
const shift = vi.fn<() => Promise<ShiftDetail | null>>();
/** Set to make a read FAIL rather than find nothing (audit D16, D18). */
const fails = vi.hoisted(() => ({ shift: false, profile: false }));
vi.mock('../data', () => ({
  supabaseConfigured: () => true,
  loadShift: async () =>
    fails.shift ? { shift: null, problem: 'timeout' } : { shift: await shift(), problem: null },
}));
const profile = vi.fn<() => Promise<StaffProfile | null>>();
vi.mock('../../../profile/data', () => ({
  readProfile: async () => {
    if (fails.profile) return { kind: 'problem', message: 'timeout' };
    const p = await profile();
    return p ? { kind: 'ok', profile: p } : { kind: 'unconfigured' };
  },
}));

const me = (over: Partial<StaffProfile> = {}): StaffProfile => ({
  staffId: 's1',
  firstName: 'Amara',
  lastName: 'Kent',
  employeeId: 1042,
  email: 'amara@example.test',
  phone: '+447700900123',
  homeAddress: null,
  photoPath: null,
  photoLocked: true,
  status: 'compliant',
  blockKind: null,
  leftAt: null,
  rtwBranch: 'uk_irish',
  niMasked: null,
  hasNiNumber: true,
  rating: 4.8,
  reliability: 97,
  quizAttempts: 1,
  rejectionCause: null,
  roles: ['Waiting Staff'],
  blockers: [],
  checkedIn: false,
  bank: null,
  ...over,
});

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

beforeEach(() => {
  fails.shift = false;
  fails.profile = false;
  shift.mockReset();
  profile.mockReset();
  profile.mockResolvedValue(me());
});

describe('GET /shifts/:id/calendar.ics', () => {
  it('a read that failed is a 503, never a 404 that says the shift is not theirs', async () => {
    shift.mockResolvedValue(detail());
    fails.shift = true;
    expect((await get()).status).toBe(503);
    fails.shift = false;
    fails.profile = true;
    expect((await get()).status).toBe(503);
  });

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
    ['a shift handed over (ADR-0046)', detail({ status: 'cancelled', cancelCause: 'handed_over' })],
    ['a turn-away', detail({ status: 'turned_away' })],
  ])('is a 404 for %s', async (_case, row) => {
    shift.mockResolvedValue(row);
    expect((await get()).status).toBe(404);
  });

  it.each([
    ['no profile at all', null],
    ['a documents lock — an expired document', me({ blockers: ['document_expired:passport'] })],
    [
      'a documents lock — an automatic block',
      me({ status: 'blocked', blockKind: 'auto_document' }),
    ],
    ['a manual hold', me({ status: 'blocked', blockKind: 'manual' })],
    ['a leaver', me({ status: 'inactive', leftAt: '2026-06-01T09:00:00Z' })],
    ['a rejected account', me({ status: 'rejected', rejectionCause: 'manager' })],
    ['a removed account', me({ status: 'removed' })],
  ])(
    'is a 404 for a locked worker: %s — even for their own confirmed booking',
    async (_case, who) => {
      profile.mockResolvedValue(who);
      shift.mockResolvedValue(detail());
      expect((await get()).status).toBe(404);
      expect(shift).not.toHaveBeenCalled();
    },
  );
});
