import { describe, expect, it } from 'vitest';
import {
  appliedAgo,
  bookedOn,
  confirmationLine,
  confirmedRows,
  fillLine,
  fillTone,
  invitedRows,
  rankedPool,
  showsFillingLists,
  sortPool,
  unavailableRows,
} from '../board';
import type { BoardEvent, BoardSection, CandidateRow, RosterRow } from '../types';

const section = (over: Partial<BoardSection> = {}): BoardSection => ({
  id: 's1',
  role_id: 'r1',
  role_name: 'Waiting Staff',
  starts_at: '2026-09-19T16:00:00Z',
  ends_at: '2026-09-19T22:30:00Z',
  headcount: 12,
  buffer: 2,
  charge_rate: 22.97,
  pay_rate: 14,
  final_pay_rate: 15.69,
  dress_code: 'Black tie',
  auto_assign: true,
  allocation_per_hour: 14,
  confirmed: 12,
  invited: 0,
  applied: 0,
  open_slots: 0,
  no_shows: 0,
  ...over,
});

const event = (over: Partial<BoardEvent> = {}): BoardEvent =>
  ({
    id: 'e1',
    status: 'upcoming',
    ...over,
  }) as BoardEvent;

const candidate = (over: Partial<CandidateRow> = {}): CandidateRow => ({
  staff_id: 'w1',
  gate: null,
  qualified: false,
  booking_status: null,
  reliability: 90,
  rating: 4,
  distance_km: 5,
  future_shifts: 0,
  venue_times: 0,
  ...over,
});

const rosterRow = (over: Partial<RosterRow> = {}): RosterRow =>
  ({
    booking_id: 'b1',
    shift_id: 's1',
    staff_id: 'w1',
    status: 'confirmed',
    source: 'auto',
    no_show: false,
    reconfirm_required: false,
    confirmed_at: null,
    day_before_confirmed_at: null,
    on_day_confirmed_at: null,
    applied_at: null,
    ...over,
  }) as RosterRow;

describe('Unavailable (§3.3, §6)', () => {
  it('never lists a wrong-role worker — not even with a reason', () => {
    // In an agency of a thousand, nearly everyone is the wrong role for a
    // given section. §6 keeps them off the board entirely; listing them
    // would bury the section.
    const rows = unavailableRows([
      candidate({ staff_id: 'a', gate: 'wrong_role' }),
      candidate({ staff_id: 'b', gate: 'blocked' }),
    ]);
    expect(rows.map((r) => r.staff_id)).toEqual(['b']);
  });

  it('lists the other five gates', () => {
    const gates = [
      'blocked',
      'booked_elsewhere',
      'hours_limit',
      'self_cancelled',
      'do_not_return',
    ] as const;
    const rows = unavailableRows(gates.map((gate, i) => candidate({ staff_id: `g${i}`, gate })));
    expect(rows).toHaveLength(5);
  });

  it('does not list anyone ungated — they belong in the pool', () => {
    expect(unavailableRows([candidate({})])).toHaveLength(0);
  });
});

describe('the potential pool (RULE-17, §6)', () => {
  it('puts every wave-1 worker above every wave-2 worker, whatever they score', () => {
    // A wave-2 worker scoring higher is still invited second. The board has
    // to show that order or a manager reading down the list picks wrongly.
    const pool = rankedPool(
      [
        candidate({
          staff_id: 'wave2',
          qualified: false,
          reliability: 100,
          rating: 5,
          distance_km: 0,
        }),
        candidate({
          staff_id: 'wave1',
          qualified: true,
          reliability: 60,
          rating: 2,
          distance_km: 40,
        }),
      ],
      new Set(),
    );
    expect(pool.map((r) => r.subject.staff_id)).toEqual(['wave1', 'wave2']);
    expect(pool[0]?.wave).toBe(1);
    expect(pool[1]?.breakdown.total).toBeGreaterThan(pool[0]?.breakdown.total ?? 0);
  });

  it('drops gated candidates', () => {
    const pool = rankedPool([candidate({ staff_id: 'g', gate: 'blocked' })], new Set());
    expect(pool).toHaveLength(0);
  });

  it('does not duplicate someone who already holds a booking here', () => {
    // §3.3: a worker already in Invited who also self-applies "is not
    // duplicated into Potential pool — the marker shows on their existing
    // Invited entry instead".
    const pool = rankedPool([candidate({ staff_id: 'w1' })], new Set(['w1']));
    expect(pool).toHaveLength(0);
  });

  it('returns the per-factor breakdown, which is what the hover shows', () => {
    const pool = rankedPool([candidate({})], new Set());
    expect(pool[0]?.breakdown).toHaveProperty('total');
  });
});

describe('when Invited and Potential pool are shown (§3.3)', () => {
  it('hides both once the role is fully confirmed', () => {
    expect(showsFillingLists(event({ status: 'ongoing' }), section())).toBe(false);
  });

  it('shows them again when a shortfall reopens on an Ongoing event', () => {
    // The half that is easy to drop: a no-show mid-event leaves the role
    // short-handed, and the manager needs the pool back to fill it.
    expect(
      showsFillingLists(event({ status: 'ongoing' }), section({ confirmed: 11, open_slots: 1 })),
    ).toBe(true);
  });

  it('keeps them while invitations are outstanding', () => {
    expect(showsFillingLists(event({ status: 'upcoming' }), section({ invited: 2 }))).toBe(true);
  });

  it('hides them unconditionally once the event is over or cancelled', () => {
    // Nothing can be filled after the fact, shortfall or not.
    const short = section({ confirmed: 4, open_slots: 8 });
    expect(showsFillingLists(event({ status: 'completed' }), short)).toBe(false);
    expect(showsFillingLists(event({ status: 'cancelled' }), short)).toBe(false);
  });
});

describe('the section header (§3.2, §3.3)', () => {
  it('writes the buffer separately, never added in', () => {
    expect(fillLine(section({ confirmed: 6, invited: 1, open_slots: 6 }))).toBe(
      '6 confirmed · 1 invited · 6 open of 12 (+2)',
    );
  });

  it('omits the buffer when there is none', () => {
    expect(fillLine(section({ headcount: 4, buffer: 0, confirmed: 4, open_slots: 0 }))).toBe(
      '4 confirmed · 0 invited · 0 open of 4',
    );
  });

  it('is green when full, amber when short, coral when badly short', () => {
    expect(fillTone(section())).toBe('green');
    expect(fillTone(section({ confirmed: 10, open_slots: 2 }))).toBe('amber');
    expect(fillTone(section({ confirmed: 2, open_slots: 10 }))).toBe('coral');
  });
});

describe('the roster (§3.3, §3.5)', () => {
  it('keeps a no-show inside Confirmed', () => {
    const rows = confirmedRows([rosterRow({ no_show: true })], 's1');
    expect(rows).toHaveLength(1);
  });

  it('keeps a worked booking there too, so a finished event is not empty', () => {
    expect(confirmedRows([rosterRow({ status: 'worked' })], 's1')).toHaveLength(1);
  });

  it('puts a Radar self-application with the invitations, not in Confirmed', () => {
    const applied = rosterRow({ status: 'applied', source: 'self' });
    expect(confirmedRows([applied], 's1')).toHaveLength(0);
    expect(invitedRows([applied], 's1')).toHaveLength(1);
  });

  it('excludes a cancelled booking from the pool exclusion set', () => {
    // A withdrawn worker is not holding a slot, so the pool may offer the
    // section to someone else — but the same person is blocked by the
    // unique (shift, staff) row in the database, not by this set.
    expect(bookedOn([rosterRow({ status: 'cancelled' })], 's1').size).toBe(0);
  });

  it('reads No show ahead of how far through confirming the worker got', () => {
    expect(
      confirmationLine(
        rosterRow({ no_show: true, day_before_confirmed_at: '2026-09-18T11:00:00Z' }),
      ),
    ).toBe('No show');
  });

  it('names the three confirmation stages in order (§3.5)', () => {
    expect(confirmationLine(rosterRow({ confirmed_at: 'x' }))).toBe('Accepted — not yet ready');
    expect(confirmationLine(rosterRow({ confirmed_at: 'x', day_before_confirmed_at: 'y' }))).toBe(
      'Ready — confirmed the day before',
    );
    expect(
      confirmationLine(
        rosterRow({ confirmed_at: 'x', day_before_confirmed_at: 'y', on_day_confirmed_at: 'z' }),
      ),
    ).toBe('Confirmed on the day');
  });

  it('surfaces a required re-confirmation with its reason (§3.5)', () => {
    expect(
      confirmationLine(rosterRow({ reconfirm_required: true, reconfirm_reason: 'time changed' })),
    ).toBe('Awaiting re-confirmation — time changed');
  });
});

describe('the Applied marker (§3.3)', () => {
  const now = new Date('2026-09-19T12:00:00Z');

  it('counts in minutes, then hours, then days', () => {
    expect(appliedAgo('2026-09-19T11:30:00Z', now)).toBe('Applied 30m ago');
    expect(appliedAgo('2026-09-19T10:00:00Z', now)).toBe('Applied 2h ago');
    expect(appliedAgo('2026-09-17T12:00:00Z', now)).toBe('Applied 2d ago');
  });

  it('says nothing for someone who did not apply', () => {
    expect(appliedAgo(null, now)).toBeNull();
  });
});

describe('sorting the pool by application (§3.3)', () => {
  it('lifts self-applicants without re-ranking either group', () => {
    // "the pool's existing ranking and search stay intact alongside this"
    const rows = rankedPool(
      [
        candidate({ staff_id: 'a', qualified: true, reliability: 100 }),
        candidate({ staff_id: 'b', qualified: true, reliability: 95 }),
        candidate({ staff_id: 'c', qualified: false, reliability: 99 }),
      ],
      new Set(),
    );
    expect(rows.map((r) => r.subject.staff_id)).toEqual(['a', 'b', 'c']);

    const sorted = sortPool(rows, 'applied', new Map([['c', '2026-09-19T10:00:00Z']]));
    expect(sorted.map((r) => r.subject.staff_id)).toEqual(['c', 'a', 'b']);
  });

  it('leaves the ranking alone on the default sort', () => {
    const rows = rankedPool([candidate({ staff_id: 'a' })], new Set());
    expect(sortPool(rows, 'rank', new Map([['a', 'x']]))).toBe(rows);
  });
});

describe('the running order of the day (§3.3)', () => {
  it('orders role sections by start time, earliest first', async () => {
    const { byStartTime } = await import('../board');
    const chef = section({ id: 's2', role_name: 'Chef', starts_at: '2026-09-25T06:00:00Z' });
    const waiting = section({
      id: 's1',
      role_name: 'Waiting Staff',
      starts_at: '2026-09-25T15:00:00Z',
    });
    expect([waiting, chef].sort(byStartTime).map((s) => s.id)).toEqual(['s2', 's1']);
  });

  it('breaks a tie by role name, so two sections at one time have a fixed order', async () => {
    const { byStartTime } = await import('../board');
    const bar = section({ id: 'b', role_name: 'Bar Staff' });
    const waiting = section({ id: 'w', role_name: 'Waiting Staff' });
    expect([waiting, bar].sort(byStartTime).map((s) => s.id)).toEqual(['b', 'w']);
  });
});
