import { describe, expect, it } from 'vitest';
import { type CandidateRow, DEFAULT_WEIGHTS, parseWeights } from '@thc/domain';
import {
  type BoardPersonName,
  type EndedBooking,
  type PoolEntry,
  CAUSE_COPY,
  buildPool,
  buildUnavailable,
  canToggleAutoAssign,
  factorChips,
  handedOverLine,
  inviteAnywayPrompt,
  inviteRefusal,
  offerChip,
  offerOfficeRefusal,
  queryPool,
  rateLine,
  scoreBreakdownLines,
  shortName,
  ukWindowLabel,
  unavailableLabel,
  weightPercent,
} from '../[id]/board-model';

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
  [
    ['yusuf', 'Yusuf A.', ['Waiting Staff', 'Bar Staff']],
    ['ella', 'Ella F.', ['Waiting Staff']],
    ['priya', 'Priya S.', ['Waiting Staff', 'Host']],
    ['omar', 'Omar S.', ['Waiting Staff', 'Kitchen Porter']],
    ['ben', 'Ben T.', ['Waiting Staff']],
    ['jonah', 'Jonah W.', ['Waiting Staff']],
    ['kai', 'Kai N.', ['Waiting Staff']],
    ['luca', 'Luca M.', ['Waiting Staff']],
    ['zara', 'Zara A.', ['Waiting Staff']],
    ['nobody', 'Gus N.', ['Chef']],
  ].map(([staffId, name, roles]) => [
    staffId as string,
    { staffId: staffId as string, name: name as string, roles: roles as string[] },
  ]),
);

// ---------------------------------------------------------------------

describe('the Potential pool is the engine’s ranking (§3.3, §3.4, §6)', () => {
  // The wireframe's §6 example: a qualified worker is listed — and invited —
  // above an unqualified one who scores higher (RULE-17).
  const yusuf = row('yusuf', {
    qualified: true,
    reliability: 94,
    rating: 4.3,
    distance_km: 5.5,
    future_shifts: 2,
    venue_times: 2,
  });
  const ella = row('ella', {
    reliability: 100,
    rating: 4.9,
    distance_km: 0.4,
    future_shifts: 0,
    venue_times: 0,
  });

  it('puts wave 1 (qualified at client + role) above a higher-scoring wave 2', () => {
    const pool = buildPool([ella, yusuf], people, [], DEFAULT_WEIGHTS);
    expect(pool.map((e) => [e.name, e.wave, e.rank])).toEqual([
      ['Yusuf A.', 1, 1],
      ['Ella F.', 2, 2],
    ]);
    expect(pool[1]!.breakdown.total).toBeGreaterThan(pool[0]!.breakdown.total);
    expect(pool[0]!.qualified).toBe(true);
  });

  it('keeps gated workers and anyone already booked on the section out of the pool', () => {
    const pool = buildPool(
      [
        row('jonah', { gate: 'blocked' }),
        row('nobody', { gate: 'wrong_role' }),
        row('zara', { booking_status: 'invited' }),
        row('kai', { booking_status: 'cancelled' }),
        row('luca', { booking_status: 'closed' }),
        row('ben', { booking_status: 'confirmed' }),
        row('priya'),
      ],
      people,
      [],
      DEFAULT_WEIGHTS,
    );
    expect(pool.map((e) => e.staffId)).toEqual(['priya']);
  });

  it('keeps a pending Radar applicant, with the Applied marker and the application to accept', () => {
    const pool = buildPool(
      [row('omar', { booking_status: 'applied' }), row('priya')],
      people,
      [
        {
          staffId: 'omar',
          bookingId: 'bk-omar',
          appliedAt: '2026-09-18T10:00:00Z',
          createdAt: 'x',
        },
      ],
      DEFAULT_WEIGHTS,
    );
    const omar = pool.find((e) => e.staffId === 'omar')!;
    expect(omar.appliedAt).toBe('2026-09-18T10:00:00Z');
    expect(omar.applicationId).toBe('bk-omar');
    expect(pool.find((e) => e.staffId === 'priya')!.applicationId).toBeNull();
  });

  it('ranks with the weights from settings, not the shipped default', () => {
    // Proximity only: the nearer worker wins whatever else is true.
    const weights = parseWeights({
      show_rate: 0,
      rating: 0,
      proximity: 1,
      fair_rotation: 0,
      venue_history: 0,
    });
    const pool = buildPool(
      [row('ben', { distance_km: 9, reliability: 100 }), row('priya', { distance_km: 1 })],
      people,
      [],
      weights,
    );
    expect(pool.map((e) => e.staffId)).toEqual(['priya', 'ben']);
  });

  it('names a worker the directory could not return as a deleted account, not a blank', () => {
    const pool = buildPool([row('ghost')], people, [], DEFAULT_WEIGHTS);
    expect(pool[0]!.name).toBe('Deleted account');
  });
});

describe('search, filter and sort leave the engine’s rank alone (§3.3)', () => {
  const pool: PoolEntry[] = buildPool(
    [
      row('priya', { qualified: true, reliability: 99 }),
      row('omar', { booking_status: 'applied', reliability: 91 }),
      row('ella', { booking_status: 'applied', reliability: 100 }),
      row('ben', { reliability: 92 }),
    ],
    people,
    [
      { staffId: 'omar', bookingId: 'b1', appliedAt: '2026-09-18T08:00:00Z', createdAt: '' },
      { staffId: 'ella', bookingId: 'b2', appliedAt: '2026-09-18T12:00:00Z', createdAt: '' },
    ],
    DEFAULT_WEIGHTS,
  );
  const names = (list: PoolEntry[]) => list.map((e) => `${e.rank}:${e.name}`);

  it('score order is rank order', () => {
    expect(names(queryPool(pool, { q: '', filter: 'all', sort: 'score' }))).toEqual([
      '1:Priya S.',
      '2:Ella F.',
      '3:Ben T.',
      '4:Omar S.',
    ]);
  });

  it('searches names and roles, case-insensitively, keeping each rank', () => {
    expect(names(queryPool(pool, { q: 'KITCHEN', filter: 'all', sort: 'score' }))).toEqual([
      '4:Omar S.',
    ]);
    expect(names(queryPool(pool, { q: ' ben ', filter: 'all', sort: 'score' }))).toEqual([
      '3:Ben T.',
    ]);
  });

  it('filters by application status', () => {
    expect(names(queryPool(pool, { q: '', filter: 'applied', sort: 'score' }))).toEqual([
      '2:Ella F.',
      '4:Omar S.',
    ]);
    expect(names(queryPool(pool, { q: '', filter: 'not_applied', sort: 'score' }))).toEqual([
      '1:Priya S.',
      '3:Ben T.',
    ]);
  });

  it('sorts applicants first (oldest application first), or by name', () => {
    expect(names(queryPool(pool, { q: '', filter: 'all', sort: 'applied' }))).toEqual([
      '4:Omar S.',
      '2:Ella F.',
      '1:Priya S.',
      '3:Ben T.',
    ]);
    expect(names(queryPool(pool, { q: '', filter: 'all', sort: 'name' }))).toEqual([
      '3:Ben T.',
      '2:Ella F.',
      '4:Omar S.',
      '1:Priya S.',
    ]);
  });
});

describe('the score hover shows the §6 breakdown by factor', () => {
  // The wireframe's worked example for Priya S.: 88.7 ≈ 89.
  const [priya] = buildPool(
    [
      row('priya', {
        reliability: 99,
        rating: 4.9,
        distance_km: 0.8,
        future_shifts: 0,
        venue_times: 6,
      }),
    ],
    people,
    [],
    DEFAULT_WEIGHTS,
  );

  it('one line per factor, then the total', () => {
    expect(scoreBreakdownLines(priya!, DEFAULT_WEIGHTS)).toEqual([
      'show-rate 99% → 90 × 0.30 = 27.0',
      'rating 4.9 → 90 × 0.25 = 22.5',
      'proximity 0.8 km → 93 × 0.25 = 23.2',
      'fair rotation 0 future → 100 × 0.10 = 10.0',
      'venue history 6 of 10 → 60 × 0.10 = 6.0',
      'total 88.7 ≈ 89',
    ]);
  });

  it('the factor chips carry the same figures, each with its own hover', () => {
    expect(factorChips(priya!)).toEqual([
      { label: 'show 99%', title: 'show-rate 99% → 90' },
      { label: '4.9★', title: 'rating 4.9 → 90' },
      { label: '0.8 km', title: '0.8 km → 93' },
      { label: '0 future', title: '0 future shifts → 100' },
      { label: '6 visits', title: '6 visits → 60' },
    ]);
  });

  it('says "no address" rather than inventing a distance', () => {
    const [noHome] = buildPool([row('ben', { distance_km: null })], people, [], DEFAULT_WEIGHTS);
    expect(factorChips(noHome!)[2]).toEqual({
      label: 'no address',
      title: 'no usable home address → 0',
    });
  });

  it('the legend reads the weights as percentages', () => {
    expect(weightPercent(DEFAULT_WEIGHTS.show)).toBe('30%');
    expect(weightPercent(0.1)).toBe('10%');
  });
});

// ---------------------------------------------------------------------

describe('Unavailable names the real reason (§3.3, §3.4, §9.6)', () => {
  const none = new Set<string>();

  it('lists the live gates by their §3.3 names; wrong role never produces a row (§6)', () => {
    const list = buildUnavailable(
      [
        row('jonah', { gate: 'blocked' }),
        row('luca', { gate: 'booked_elsewhere' }),
        row('ben', { gate: 'hours_limit' }),
        row('kai', { gate: 'self_cancelled' }),
        row('omar', { gate: 'do_not_return' }),
        row('zara', { gate: 'rtw_expired' }),
        row('nobody', { gate: 'wrong_role' }),
        row('priya'),
      ],
      [],
      people,
      none,
    );
    expect(list.map((e) => [e.name, e.label])).toEqual([
      ['Jonah W.', 'Blocked — compliance'],
      ['Luca M.', 'Booked elsewhere'],
      ['Ben T.', 'Hours limit reached'],
      ['Zara A.', 'Right to work expired'],
      ['Kai N.', 'Rejected — self-cancelled'],
      ['Omar S.', 'Do not return'],
    ]);
  });

  it('labels an ended booking by its cancel_cause when the pool cannot be read — an office withdrawal is not a self-cancel', () => {
    const ended: EndedBooking[] = [
      { staffId: 'zara', status: 'cancelled', cancelCause: 'office_withdraw', appliedAt: null },
      { staffId: 'ben', status: 'cancelled', cancelCause: 'ready_cutoff', appliedAt: null },
      {
        staffId: 'luca',
        status: 'cancelled',
        cancelCause: 'overlap_auto_withdraw',
        appliedAt: null,
      },
      { staffId: 'ella', status: 'closed', cancelCause: 'slot_taken', appliedAt: null },
      { staffId: 'omar', status: 'closed', cancelCause: 'withdrawn_by_worker', appliedAt: 'x' },
      { staffId: 'priya', status: 'closed', cancelCause: 'declined', appliedAt: null },
    ];
    // With the pool unreadable (null) nobody may silently disappear: every
    // ended booking is listed by its cause. With the pool read, all six are
    // invitable again and sit in the pool instead (D33, below).
    const list = buildUnavailable(null, ended, people, none);
    const byName = Object.fromEntries(list.map((e) => [e.name, e.label]));
    expect(buildUnavailable([], ended, people, none)).toEqual([]);
    expect(byName).toEqual({
      'Zara A.': 'Withdrawn',
      'Ben T.': 'Released at the cutoff',
      // §3.4: withdrawn at an overlapping Accept → Unavailable → Booked elsewhere.
      'Luca M.': 'Booked elsewhere',
      'Ella F.': 'Slot taken',
      'Omar S.': 'Application withdrawn',
      'Priya S.': 'Declined',
    });
    expect(list.every((e) => e.label !== 'Rejected — self-cancelled')).toBe(true);
  });

  it('a self-cancel cause still reads Rejected', () => {
    const [kai] = buildUnavailable(
      [],
      [{ staffId: 'kai', status: 'cancelled', cancelCause: 'self_cancel', appliedAt: null }],
      people,
      none,
    );
    expect(kai!.label).toBe('Rejected — self-cancelled');
    expect(kai!.tone).toBe('coral');
  });

  it('a live gate outranks the booking’s cause, and each worker appears once', () => {
    const list = buildUnavailable(
      [row('zara', { gate: 'blocked', booking_status: 'cancelled' })],
      [{ staffId: 'zara', status: 'cancelled', cancelCause: 'office_withdraw', appliedAt: null }],
      people,
      none,
    );
    expect(list.map((e) => [e.name, e.label])).toEqual([['Zara A.', 'Blocked — compliance']]);
  });

  it('skips anyone already listed in Confirmed or Invited', () => {
    const list = buildUnavailable(
      [row('ben', { gate: 'hours_limit', booking_status: 'confirmed' })],
      [],
      people,
      new Set(['ben']),
    );
    expect(list).toEqual([]);
  });

  it('an unknown or missing cause says "Cancelled" rather than guessing', () => {
    const [zara] = buildUnavailable(
      null,
      [{ staffId: 'zara', status: 'cancelled', cancelCause: null, appliedAt: null }],
      people,
      none,
    );
    expect(zara!.label).toBe('Cancelled');
  });

  it('has copy for every cancel cause the database allows', () => {
    // CANCEL_CAUSES in packages/domain/src/state.ts; bookings_cancel_cause_check.
    for (const cause of [
      'office_withdraw',
      'ready_cutoff',
      'self_cancel',
      'handed_over',
      'overlap_auto_withdraw',
      'event_cancelled',
      'blocked',
      'blocked_invite',
      'left',
      'left_invite',
      'gdpr',
      'gdpr_invite',
      'slot_taken',
      'declined',
      'withdrawn_by_worker',
    ]) {
      expect(CAUSE_COPY[cause], cause).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------

describe('Marked unavailable — the calendar on the board (ADR-0042)', () => {
  const none = new Set<string>();
  // Thursday 15 Oct 2026, BST (UTC+1).
  const allDay = { startsAt: '2026-10-14T23:00:00.000Z', endsAt: '2026-10-15T23:00:00.000Z' };
  const morning = { startsAt: '2026-10-15T05:00:00.000Z', endsAt: '2026-10-15T08:00:00.000Z' };
  const overnight = { startsAt: '2026-10-15T21:00:00.000Z', endsAt: '2026-10-16T01:00:00.000Z' };
  const threeDays = { startsAt: '2026-10-14T23:00:00.000Z', endsAt: '2026-10-17T23:00:00.000Z' };

  it('reads each entry in UK time, half-open', () => {
    expect(ukWindowLabel(allDay)).toBe('Thu 15 Oct · all day');
    expect(ukWindowLabel(threeDays)).toBe('Thu 15 Oct – Sat 17 Oct · all day');
    expect(ukWindowLabel(morning)).toBe('Thu 15 Oct 06:00–09:00 UK');
    expect(ukWindowLabel(overnight)).toBe('Thu 15 Oct 22:00 – Fri 16 Oct 02:00 UK');
    // 25 Oct 2026 is the autumn change: UK midnight to UK midnight is 25 h.
    expect(
      ukWindowLabel({ startsAt: '2026-10-24T23:00:00.000Z', endsAt: '2026-10-26T00:00:00.000Z' }),
    ).toBe('Sun 25 Oct · all day');
  });

  it('labels the row "Marked unavailable · {UK window}", earliest entry first', () => {
    expect(unavailableLabel([morning, allDay])).toBe(
      'Marked unavailable · Thu 15 Oct · all day; Thu 15 Oct 06:00–09:00 UK',
    );
    expect(unavailableLabel([])).toBe('Marked unavailable');
  });

  it('asks before inviting anyway, in the ADR’s words', () => {
    expect(inviteAnywayPrompt('Priya S.')).toBe(
      'Priya S. marked themselves unavailable for this time. Invite anyway?',
    );
  });

  it('moves an away worker from the pool to Unavailable, with Invite anyway', () => {
    const rows = [row('priya', { qualified: true }), row('ella'), row('ben')];
    const away = new Map([['priya', [morning]]]);
    const pool = buildPool(rows, people, [], DEFAULT_WEIGHTS, {
      unavailable: new Set(away.keys()),
    });
    expect(pool.map((e) => e.name)).toEqual(['Ella F.', 'Ben T.']);
    // Wave 1 is empty once Priya is away, exactly as the engine sees it.
    expect(pool.every((e) => e.wave === 2)).toBe(true);

    const [priya, ...rest] = buildUnavailable(rows, [], people, none, away);
    expect(rest).toEqual([]);
    expect(priya).toMatchObject({
      name: 'Priya S.',
      reason: 'unavailable',
      label: 'Marked unavailable · Thu 15 Oct 06:00–09:00 UK',
      tone: 'amber',
      inviteAnyway: true,
    });
  });

  it('a hard gate is the truer reason, and never offers Invite anyway', () => {
    const away = new Map([
      ['jonah', [allDay]],
      ['ben', [allDay]],
    ]);
    const list = buildUnavailable(
      [row('jonah', { gate: 'blocked' }), row('ben', { booking_status: 'invited' })],
      [],
      people,
      new Set(['ben']),
      away,
    );
    expect(list.map((e) => [e.name, e.label, e.inviteAnyway])).toEqual([
      ['Jonah W.', 'Blocked — compliance', false],
    ]);
  });

  it('keeps an away Radar applicant in the pool — applying was their own choice', () => {
    const rows = [row('omar', { booking_status: 'applied' })];
    const pool = buildPool(
      rows,
      people,
      [{ staffId: 'omar', bookingId: 'b-omar', appliedAt: '2026-10-01T10:00:00Z', createdAt: 'x' }],
      DEFAULT_WEIGHTS,
      { unavailable: new Set(['omar']) },
    );
    expect(pool.map((e) => e.applicationId)).toEqual(['b-omar']);
  });

  it('an away worker with a reopenable ended booking lands under Unavailable, never nowhere', () => {
    // D33 puts a declined invitation back in the pool; ADR-0042 takes the
    // away out of it. The two together must still show the worker once.
    const rows = [row('priya', { booking_status: 'closed' }), row('ella')];
    const ended: EndedBooking[] = [
      { staffId: 'priya', status: 'closed', cancelCause: 'declined', appliedAt: null },
    ];
    const away = new Map([['priya', [morning]]]);
    const pool = buildPool(rows, people, [], DEFAULT_WEIGHTS, {
      ended,
      unavailable: new Set(away.keys()),
    });
    expect(pool.map((e) => e.name)).toEqual(['Ella F.']);
    const list = buildUnavailable(rows, ended, people, none, away);
    expect(list.map((e) => [e.name, e.reason, e.inviteAnyway])).toEqual([
      ['Priya S.', 'unavailable', true],
    ]);
  });
});

describe('Offered up and cover requests on the board (ADR-0045)', () => {
  it('a pool offer is a chip on the Confirmed row with its UK close time', () => {
    expect(
      offerChip({
        offerId: 'o1',
        mode: 'pool',
        expiresAt: '2026-09-20T15:00:00.000Z',
        note: null,
      }),
    ).toEqual({ label: 'Offered up · until Sun 20 Sep, 16:00 UK', tone: 'cyan' });
  });

  it('a cover request carries the worker’s note', () => {
    expect(
      offerChip({ offerId: 'o2', mode: 'office', expiresAt: 'x', note: ' Exam moved ' }),
    ).toEqual({ label: 'Asked for cover: Exam moved', tone: 'amber' });
    expect(offerChip({ offerId: 'o3', mode: 'office', expiresAt: 'x', note: null }).label).toBe(
      'Asked for cover',
    );
  });

  it('a hand-over is one history line per section, UK date', () => {
    expect(
      handedOverLine({ fromName: 'Grace L.', toName: 'Tom R.', at: '2026-09-15T23:30:00.000Z' }),
    ).toBe('Handed over: Grace L. → Tom R. · Wed 16 Sep');
  });

  it('turns the office refusals into the manager’s words', () => {
    expect(offerOfficeRefusal('not_a_cover_request')).toMatch(/already offered/);
    expect(offerOfficeRefusal('section_started')).toMatch(/escalation/);
    expect(offerOfficeRefusal('mystery')).toBe('Nothing was changed (mystery).');
  });
});

describe('Handed over (ADR-0045)', () => {
  it('names a hand-over, not a self-cancel, though both bar the worker from the event', () => {
    const [kai] = buildUnavailable(
      [row('kai', { gate: 'self_cancelled', booking_status: 'cancelled' })],
      [{ staffId: 'kai', status: 'cancelled', cancelCause: 'handed_over', appliedAt: null }],
      people,
      new Set(),
    );
    expect(kai).toMatchObject({ reason: 'handed_over', label: 'Handed over', inviteAnyway: false });
  });
});

// ---------------------------------------------------------------------

describe('the role header rate line (§3.3, §9.8)', () => {
  it('matches the wireframe: Pay £19.00 · final £21.29 · charge £30.69 · +£9.40/h', () => {
    expect(rateLine(19, 30.69)).toEqual({
      pay: '£19.00',
      final: '£21.29',
      charge: '£30.69',
      margin: '+£9.40/h',
      marginTone: 'green',
    });
    expect(rateLine(14, 22.97)).toMatchObject({ final: '£15.69', margin: '+£7.28/h' });
  });

  it('shows a loss as a coral minus, never a plus', () => {
    expect(rateLine(20, 21)).toMatchObject({
      final: '£22.41',
      margin: '−£1.41/h',
      marginTone: 'coral',
    });
  });
});

describe('manual invite and the switches', () => {
  it('turns every office_invite_worker refusal into the manager’s words', () => {
    expect(inviteRefusal('full')).toMatch(/fully confirmed/);
    expect(inviteRefusal('event_ended')).toMatch(/already ended/);
    expect(inviteRefusal('self_cancelled')).toMatch(/cancelled off this event/);
    // D33: an ended booking is reopened, so this is a LIVE one (or history).
    expect(inviteRefusal('already_has_booking')).toMatch(/already holds this role/);
    expect(inviteRefusal('already_has_booking')).not.toMatch(/released or closed/);
    expect(inviteRefusal('target_met')).toMatch(/fully confirmed/);
    expect(inviteRefusal('not_bookable')).toMatch(/not a worker/);
    expect(inviteRefusal('hours_limit')).toMatch(/weekly hours limit/);
    expect(inviteRefusal('something_new')).toBe('The invitation was not sent (something_new).');
  });

  it('auto-assign can be switched while there is still something to fill', () => {
    expect(canToggleAutoAssign('upcoming')).toBe(true);
    expect(canToggleAutoAssign('ongoing')).toBe(true);
    expect(canToggleAutoAssign('completed')).toBe(false);
    expect(canToggleAutoAssign('cancelled')).toBe(false);
  });
});

describe('names on the board', () => {
  it('"Grace L.", and a GDPR-removed worker as "Deleted account #id" (§1.7)', () => {
    expect(shortName({ first: 'Grace', last: 'Lee', removed: false, employeeId: 7 })).toBe(
      'Grace L.',
    );
    expect(shortName({ first: 'Deleted', last: 'account', removed: true, employeeId: 1042 })).toBe(
      'Deleted account #1042',
    );
  });
});
