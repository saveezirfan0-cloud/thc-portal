import { describe, expect, it } from 'vitest';
import { type CandidateRow, DEFAULT_WEIGHTS, canMarkNoShow } from '@thc/domain';
import type { ListedEvent } from '../data';
import { periodCrumb, toEventRow } from '../view-model';
import { NOT_ADMIN, SIGNED_OUT, adminRefusal } from '../admin';
import {
  type BoardPersonName,
  type EndedBooking,
  GATE_COPY,
  attendanceOf,
  attendancePills,
  buildPool,
  buildUnavailable,
  officeMayReopen,
  roleBlockOpen,
  sectionInEscalation,
  withdrawRefusal,
} from '../[id]/board-model';

/**
 * The event board against wireframes/backoffice/event-board.html and the
 * 25.09 audit (D33, D45, D46, board items): reopened offers in the pool,
 * the escalation pool once a section has started, attendance on Confirmed
 * rows, the collapse defaults and the Withdraw copy. Pure view-model; the
 * database half is supabase/tests/660–663.
 */

function row(staffId: string, over: Partial<CandidateRow> = {}): CandidateRow {
  return {
    staff_id: staffId,
    gate: null,
    qualified: false,
    booking_status: null,
    reliability: 95,
    rating: 4.5,
    distance_km: 3,
    future_shifts: 1,
    venue_times: 2,
    ...over,
  };
}

const people = new Map<string, BoardPersonName>(
  ['ada', 'ben', 'cai', 'dee', 'eve', 'fin'].map((id) => [
    id,
    { staffId: id, name: `${id[0]!.toUpperCase()}${id.slice(1)} X.`, roles: ['Waiting Staff'] },
  ]),
);

const ended = (
  staffId: string,
  status: string,
  cancelCause: string | null,
  hasHistory = false,
): EndedBooking => ({ staffId, status, cancelCause, appliedAt: null, hasHistory });

// ---------------------------------------------------------------------

describe('D33 · an ended booking is invitable again, except a self-cancel', () => {
  const rows = [
    row('ada', { booking_status: 'cancelled', booking_cause: 'office_withdraw' }),
    row('ben', { booking_status: 'closed', booking_cause: 'slot_taken' }),
    row('cai', { booking_status: 'cancelled', booking_cause: 'self_cancel' }),
    row('dee', { booking_status: 'cancelled', booking_cause: 'office_withdraw' }),
    row('eve', { booking_status: 'closed', booking_cause: 'declined' }),
  ];
  const endings = [
    ended('ada', 'cancelled', 'office_withdraw'),
    ended('ben', 'closed', 'slot_taken'),
    ended('cai', 'cancelled', 'self_cancel'),
    ended('dee', 'cancelled', 'office_withdraw', true),
    ended('eve', 'closed', 'declined'),
  ];

  it('puts reopenable ones in the pool with the earlier ending on the row', () => {
    const pool = buildPool(rows, people, [], DEFAULT_WEIGHTS, { ended: endings });
    const byId = Object.fromEntries(pool.map((e) => [e.staffId, e]));
    expect(Object.keys(byId).sort()).toEqual(['ada', 'ben', 'eve']);
    expect(byId['ada']!.endedLabel).toBe('Withdrawn');
    expect(byId['eve']!.endedLabel).toBe('Declined');
    expect(byId['ben']!.endedLabel).toBe('Slot taken');
  });

  it('marks which of them an automatic round would reach — only an end by circumstance', () => {
    const pool = buildPool(rows, people, [], DEFAULT_WEIGHTS, { ended: endings });
    const auto = Object.fromEntries(pool.map((e) => [e.staffId, e.autoInvitable]));
    expect(auto).toEqual({ ada: false, ben: true, eve: false });
  });

  it('keeps a self-cancel and a booking with history in Unavailable, never in the pool', () => {
    const list = buildUnavailable(rows, endings, people, new Set());
    expect(list.map((e) => [e.staffId, e.label])).toEqual([
      ['cai', 'Rejected — self-cancelled'],
      ['dee', 'Withdrawn'],
    ]);
    expect(officeMayReopen(ended('cai', 'cancelled', 'self_cancel'))).toBe(false);
    expect(officeMayReopen(ended('dee', 'cancelled', 'office_withdraw', true))).toBe(false);
    expect(officeMayReopen(ended('ada', 'cancelled', 'office_withdraw'))).toBe(true);
    expect(officeMayReopen(ended('fin', 'cancelled', 'event_cancelled'))).toBe(false);
  });
});

describe('the escalation pool once a section has started (§3.4)', () => {
  const start = new Date('2026-10-02T16:00:00Z');
  const end = new Date('2026-10-02T22:00:00Z');

  it('switches on at the start and off at the end, the handover the job makes', () => {
    expect(
      sectionInEscalation({ startsAt: start, endsAt: end }, new Date(start.getTime() - 1)),
    ).toBe(false);
    expect(sectionInEscalation({ startsAt: start, endsAt: end }, start)).toBe(true);
    expect(sectionInEscalation({ startsAt: start, endsAt: end }, end)).toBe(false);
  });

  it('ranks nearest first within each wave — qualified-first still holds', () => {
    const rows = [
      row('ada', { distance_km: 4, reliability: 100, rating: 5 }),
      row('ben', { distance_km: 1, reliability: 70, rating: 3 }),
      row('cai', { distance_km: 4.5, qualified: true }),
    ];
    const byScore = buildPool(rows, people, [], DEFAULT_WEIGHTS).map((e) => e.staffId);
    const byDistance = buildPool(rows, people, [], DEFAULT_WEIGHTS, { proximityFirst: true }).map(
      (e) => e.staffId,
    );
    expect(byScore).toEqual(['cai', 'ada', 'ben']);
    expect(byDistance).toEqual(['cai', 'ben', 'ada']);
  });

  it('names the radius gate in Unavailable', () => {
    const [ada] = buildUnavailable([row('ada', { gate: 'outside_radius' })], [], people, new Set());
    expect(ada!.label).toBe(GATE_COPY['outside_radius']!.label);
    expect(ada!.detail).not.toMatch(/§/);
  });
});

describe('attendance on a Confirmed row (wireframe, §5, §9.5)', () => {
  const log = (over: Partial<Parameters<typeof attendanceOf>[0][number]> = {}) => ({
    outcome: 'checked_in',
    checkInAt: '2026-10-02T17:52:00Z',
    checkOutAt: null,
    managerFinishAt: null,
    ...over,
  });
  const violation = (
    type: string,
    over: Partial<Parameters<typeof attendanceOf>[1][number]> = {},
  ) => ({
    type,
    resolved: false,
    minutesLate: null,
    actualFinishAt: null,
    ...over,
  });
  const kinds = (a: ReturnType<typeof attendanceOf>) => attendancePills(a).map((p) => p.label);

  it('nothing before check-in — the No-show badge is its own', () => {
    expect(attendancePills(attendanceOf([], []))).toEqual([]);
  });

  it('On shift once checked in', () => {
    expect(kinds(attendanceOf([log()], []))).toEqual(['On shift']);
  });

  it('Checked out with the time, Late with the minutes', () => {
    const a = attendanceOf(
      [log({ checkOutAt: '2026-10-03T00:34:00Z' })],
      [violation('late', { minutesLate: 12 })],
    );
    const pills = attendancePills(a);
    expect(pills.map((p) => p.label)).toEqual(['Checked out', 'Late 12 min']);
    expect(pills[0]!.at).toBe('2026-10-03T00:34:00Z');
  });

  it('Left early, coral', () => {
    const pills = attendancePills(
      attendanceOf([log({ checkOutAt: '2026-10-02T21:40:00Z' })], [violation('left_early')]),
    );
    expect(pills.map((p) => [p.label, p.tone])).toEqual([
      ['Checked out', 'neutral'],
      ['Left early', 'coral'],
    ]);
  });

  it('No check-out links to the Violation log; once resolved, the finish shows', () => {
    const open = attendancePills(attendanceOf([log()], [violation('no_checkout')]));
    expect(open).toEqual([
      { kind: 'no_checkout', label: 'No check-out', tone: 'coral', href: '/checkin' },
    ]);
    const settled = attendanceOf(
      [log()],
      [violation('no_checkout', { resolved: true, actualFinishAt: '2026-10-02T23:10:00Z' })],
    );
    expect(settled.checkOutAt).toBe('2026-10-02T23:10:00Z');
    expect(kinds(settled)).toEqual(['Checked out']);
  });

  it('a turned-away attempt is not an arrival', () => {
    expect(attendanceOf([log({ outcome: 'turned_away' })], []).checkInAt).toBeNull();
  });
});

describe('what the board offers when (§3.3)', () => {
  const start = new Date('2026-10-02T16:00:00Z');
  const end = new Date('2026-10-02T22:00:00Z');

  it('"No show" only once the section has started, until two weeks after its end', () => {
    expect(canMarkNoShow({ startsAt: start, endsAt: end }, new Date('2026-10-02T15:59:00Z'))).toBe(
      false,
    );
    expect(canMarkNoShow({ startsAt: start, endsAt: end }, start)).toBe(true);
    expect(canMarkNoShow({ startsAt: start, endsAt: end }, new Date('2026-10-17T00:00:00Z'))).toBe(
      false,
    );
  });

  it('a role block starts collapsed only when its window ended on an Ongoing event', () => {
    const after = new Date(end.getTime() + 60_000);
    expect(roleBlockOpen({ endsAt: end }, 'ongoing', after)).toBe(false);
    expect(roleBlockOpen({ endsAt: end }, 'ongoing', start)).toBe(true);
    expect(roleBlockOpen({ endsAt: end }, 'completed', after)).toBe(true);
    expect(roleBlockOpen({ endsAt: end }, 'upcoming', start)).toBe(true);
  });

  it('says why a Withdraw was refused, in the manager’s words', () => {
    expect(withdrawRefusal('checked_in')).toMatch(/checked in/);
    expect(withdrawRefusal('not_withdrawable')).toMatch(/no longer live/);
    expect(withdrawRefusal('odd')).toBe('The worker was not withdrawn (odd).');
  });
});

describe('D12 · a cancelled event’s finance line depends on WHEN it was cancelled (§3.3)', () => {
  const base: ListedEvent = {
    id: 'e1',
    title: 'Gala Dinner',
    date: '2026-10-02',
    clientId: 'c',
    clientName: 'Leonardo',
    venueName: 'Leonardo Royal',
    venueAddress: '10 Godliman St',
    poNumber: '',
    cancelledAt: null,
    cancelReason: '',
    roles: [
      { roleName: 'Chef', start: '07:00', end: '15:00', headcount: 2, buffer: 0, confirmed: 2 },
    ],
  };

  it('before the day: excluded from financials', () => {
    expect(toEventRow({ ...base, cancelledAt: '2026-09-30T10:00:00Z' }).cancelledNote).toBe(
      'excluded from financials',
    );
  });

  it('on the day (UK): billed and paid at scheduled hours', () => {
    expect(toEventRow({ ...base, cancelledAt: '2026-10-02T06:30:00Z' }).cancelledNote).toMatch(
      /billed and paid/,
    );
  });

  it('a standing event has no finance line', () => {
    expect(toEventRow(base).cancelledNote).toBeNull();
  });
});

describe('the server-side admin check in front of the RPCs (claim 2b)', () => {
  const client = (user: { id: string } | null, role: string | null) =>
    ({
      auth: { getUser: async () => ({ data: { user }, error: null }) },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: role ? { role } : null, error: null }),
          }),
        }),
      }),
    }) as unknown as Parameters<typeof adminRefusal>[0];

  it('lets an admin through', async () => {
    expect(await adminRefusal(client({ id: 'u1' }, 'admin'))).toBeNull();
  });

  it('refuses a worker, a client, and anyone signed out', async () => {
    expect(await adminRefusal(client({ id: 'u2' }, 'staff'))).toBe(NOT_ADMIN);
    expect(await adminRefusal(client({ id: 'u3' }, 'client'))).toBe(NOT_ADMIN);
    expect(await adminRefusal(client({ id: 'u4' }, null))).toBe(NOT_ADMIN);
    expect(await adminRefusal(client(null, null))).toBe(SIGNED_OUT);
  });
});

describe('the /events crumb names the day being read (wireframe "events · Thu 18 Sep 2026")', () => {
  it('is the anchored UK day, weekday first, with the year', () => {
    expect(periodCrumb('2026-09-18')).toBe('Fri 18 Sep 2026');
    // Both clock changes: read at UK noon, the day never slips.
    expect(periodCrumb('2026-10-25')).toBe('Sun 25 Oct 2026');
    expect(periodCrumb('2026-03-29')).toBe('Sun 29 Mar 2026');
  });
});
