import { describe, expect, it } from 'vitest';
import {
  candidateInput,
  rankCandidateRows,
  selectInvitees,
  selectOfferRecipients,
} from '../autoAssign';
import type { CandidateRow } from '../autoAssign';

const row = (over: Partial<CandidateRow> = {}): CandidateRow => ({
  staff_id: 's1',
  gate: null,
  qualified: false,
  booking_status: null,
  reliability: 100,
  rating: 5,
  distance_km: 0,
  future_shifts: 0,
  venue_times: 10,
  ...over,
});

describe('selectInvitees — who one round invites (§3.4, §6)', () => {
  it('takes at most the section allocation, best first', () => {
    const rows = [
      row({ staff_id: 'far', distance_km: 10 }),
      row({ staff_id: 'near', distance_km: 0 }),
      row({ staff_id: 'middling', distance_km: 5 }),
    ];
    expect(selectInvitees(rows, { allocation: 2 })).toEqual(['near', 'middling']);
  });

  it('escalation puts the nearest first within a wave, score only breaking ties (§3.4)', () => {
    const rows = [
      // Better on every other factor, but further away.
      row({ staff_id: 'strong-far', distance_km: 4, rating: 5, reliability: 100 }),
      row({ staff_id: 'weak-near', distance_km: 1, rating: 3, reliability: 70 }),
      row({ staff_id: 'qualified-far', distance_km: 4.5, qualified: true }),
    ];
    expect(selectInvitees(rows, { allocation: 3 })).toEqual([
      'qualified-far',
      'strong-far',
      'weak-near',
    ]);
    expect(selectInvitees(rows, { allocation: 3, proximityFirst: true })).toEqual([
      'qualified-far',
      'weak-near',
      'strong-far',
    ]);
  });

  it('invites nobody when the allocation is zero or negative', () => {
    expect(selectInvitees([row()], { allocation: 0 })).toEqual([]);
    expect(selectInvitees([row()], { allocation: -1 })).toEqual([]);
  });

  it('drops gated candidates, who are never scored at all', () => {
    const rows = [
      row({ staff_id: 'blocked', gate: 'blocked' }),
      row({ staff_id: 'clean' }),
      row({ staff_id: 'hours', gate: 'hours_limit' }),
    ];
    expect(selectInvitees(rows, { allocation: 10 })).toEqual(['clean']);
  });

  it('puts wave 1 — qualified at this client and role — ahead of a better-scored wave 2', () => {
    const rows = [
      // Wave 2 and perfect on every signal.
      row({ staff_id: 'w2-perfect', qualified: false }),
      // Wave 1 and mediocre on every signal.
      row({
        staff_id: 'w1-mediocre',
        qualified: true,
        reliability: 91,
        rating: 4.1,
        distance_km: 9,
        future_shifts: 4,
        venue_times: 0,
      }),
    ];
    expect(selectInvitees(rows, { allocation: 2 })).toEqual(['w1-mediocre', 'w2-perfect']);
  });

  describe('a round must not spend its allocation on refusals', () => {
    it('skips anyone already holding a booking on this section', () => {
      const rows = [
        row({ staff_id: 'invited-last-hour', booking_status: 'invited' }),
        row({ staff_id: 'confirmed', booking_status: 'confirmed' }),
        row({ staff_id: 'fresh' }),
      ];
      expect(selectInvitees(rows, { allocation: 2 })).toEqual(['fresh']);
    });

    it('still fills the allocation from whoever is left', () => {
      const rows = [
        row({ staff_id: 'held', booking_status: 'invited', distance_km: 0 }),
        row({ staff_id: 'a', distance_km: 1 }),
        row({ staff_id: 'b', distance_km: 2 }),
      ];
      // Without the filter the held candidate would take one of the two
      // slots and this round would invite one new worker instead of two.
      expect(selectInvitees(rows, { allocation: 2 })).toEqual(['a', 'b']);
    });
  });

  describe('numerics arrive from PostgREST as strings, and may be missing', () => {
    it('reads numeric-as-string exactly as it reads a number', () => {
      const asStrings = [
        row({ staff_id: 'str', reliability: '100', rating: '5', distance_km: '0' }),
      ];
      const asNumbers = [row({ staff_id: 'num', reliability: 100, rating: 5, distance_km: 0 })];
      expect(selectInvitees(asStrings, { allocation: 1 })).toEqual(['str']);
      expect(selectInvitees(asNumbers, { allocation: 1 })).toEqual(['num']);
    });

    it('a worker with no known distance does not score as if the venue were next door', () => {
      // Number(null) is 0, so a naive coercion would give this candidate
      // full proximity marks and put them first.
      const rows = [
        row({ staff_id: 'no-address', distance_km: null }),
        row({ staff_id: 'genuinely-near', distance_km: 1 }),
      ];
      expect(selectInvitees(rows, { allocation: 1 })).toEqual(['genuinely-near']);
    });

    it('unknown future shifts counts as many, not as none', () => {
      // fairFactor rewards an empty diary, so null must not look empty.
      const rows = [
        row({ staff_id: 'unknown-diary', future_shifts: null }),
        row({ staff_id: 'known-empty', future_shifts: 0 }),
      ];
      expect(selectInvitees(rows, { allocation: 1 })).toEqual(['known-empty']);
    });

    it('survives a value that is not a number at all', () => {
      const rows = [row({ staff_id: 'junk', rating: 'not-a-number' })];
      expect(selectInvitees(rows, { allocation: 1 })).toEqual(['junk']);
    });
  });

  it('invites nobody from an empty or fully gated pool', () => {
    expect(selectInvitees([], { allocation: 5 })).toEqual([]);
    expect(selectInvitees([row({ gate: 'blocked' })], { allocation: 5 })).toEqual([]);
  });
});

describe('rankCandidateRows — the board ranks as the engine does (§3.3, §6)', () => {
  it('puts a qualified 71 above an unqualified 94 (RULE-17), and keeps each row as the subject', () => {
    // §6 example, as the wireframe shows it: Yusuf A. above Ella F.
    const yusuf = row({
      staff_id: 'yusuf',
      qualified: true,
      reliability: 94,
      rating: 4.3,
      distance_km: 5.5,
      future_shifts: 2,
      venue_times: 2,
    });
    const ella = row({
      staff_id: 'ella',
      qualified: false,
      reliability: 100,
      rating: 4.9,
      distance_km: 0.4,
      future_shifts: 0,
      venue_times: 0,
    });
    const ranked = rankCandidateRows([ella, yusuf]);
    expect(ranked.map((r) => r.subject.staff_id)).toEqual(['yusuf', 'ella']);
    expect(ranked.map((r) => r.wave)).toEqual([1, 2]);
    expect(ranked[1]!.breakdown.total).toBeGreaterThan(ranked[0]!.breakdown.total);
    expect(ranked[0]!.subject).toBe(yusuf);
  });

  it('drops gated rows and leaves booking statuses to the caller', () => {
    const ranked = rankCandidateRows([
      row({ staff_id: 'gated', gate: 'blocked' }),
      row({ staff_id: 'applied', booking_status: 'applied' }),
    ]);
    expect(ranked.map((r) => r.subject.staff_id)).toEqual(['applied']);
  });

  it('agrees with selectInvitees on the order of the open rows', () => {
    const rows = [
      row({ staff_id: 'a', distance_km: 9 }),
      row({ staff_id: 'b', distance_km: 1, qualified: true, reliability: 90 }),
      row({ staff_id: 'c', distance_km: 3 }),
    ];
    expect(rankCandidateRows(rows).map((r) => r.subject.staff_id)).toEqual(
      selectInvitees(rows, { allocation: 10 }),
    );
  });

  it('reads numerics that arrive as strings, and never flatters missing data', () => {
    expect(
      candidateInput(
        row({
          reliability: '97.5',
          rating: null,
          distance_km: null,
          future_shifts: null,
          venue_times: '3',
        }),
      ),
    ).toEqual({ reliability: 97.5, rating: 0, distanceKm: 1000, futureShifts: 5, venueTimes: 3 });
  });
});

describe('selectInvitees — the calendar gates the machine (ADR-0036)', () => {
  it('never invites a worker who marked themselves unavailable for the section', () => {
    const rows = [row({ staff_id: 'away' }), row({ staff_id: 'free', distance_km: 9 })];
    expect(selectInvitees(rows, { allocation: 2 })).toEqual(['away', 'free']);
    expect(selectInvitees(rows, { allocation: 2, unavailable: ['away'] })).toEqual(['free']);
    expect(selectInvitees(rows, { allocation: 2, unavailable: new Set(['away']) })).toEqual([
      'free',
    ]);
  });

  it('does not spend the allocation on them either — the next best is invited instead', () => {
    const rows = [
      row({ staff_id: 'best', qualified: true }),
      row({ staff_id: 'second', distance_km: 3 }),
      row({ staff_id: 'third', distance_km: 6 }),
    ];
    expect(selectInvitees(rows, { allocation: 2, unavailable: ['best'] })).toEqual([
      'second',
      'third',
    ]);
  });

  it('an unknown id changes nothing', () => {
    const rows = [row({ staff_id: 'a' })];
    expect(selectInvitees(rows, { allocation: 1, unavailable: ['nobody'] })).toEqual(['a']);
  });
});

describe("selectOfferRecipients — who this hour's OF1 push reaches (ADR-0039)", () => {
  it('skips everyone already told: the rounds are additive', () => {
    const rows = [row({ staff_id: 'a' }), row({ staff_id: 'b' }), row({ staff_id: 'c' })];
    expect(selectOfferRecipients(rows, { allocation: 2, notified: ['a'] })).toEqual(['b', 'c']);
  });

  it('wave 1 first, then wave 2, each by score (RULE-17)', () => {
    const rows = [
      row({ staff_id: 'w2-near', distance_km: 0 }),
      row({ staff_id: 'w1-far', distance_km: 9, qualified: true }),
      row({ staff_id: 'w1-near', distance_km: 1, qualified: true }),
    ];
    expect(selectOfferRecipients(rows, { allocation: 2, notified: [] })).toEqual([
      'w1-near',
      'w1-far',
    ]);
  });

  it('drops gated workers and the calendar-unavailable', () => {
    const rows = [
      row({ staff_id: 'blocked', gate: 'blocked' }),
      row({ staff_id: 'away' }),
      row({ staff_id: 'free' }),
    ];
    expect(
      selectOfferRecipients(rows, { allocation: 5, notified: [], unavailable: ['away'] }),
    ).toEqual(['free']);
  });

  it('never pushes the offerer or anyone who holds or left the section', () => {
    const rows = [
      row({ staff_id: 'offerer', booking_status: 'confirmed' }),
      row({ staff_id: 'left', booking_status: 'cancelled' }),
      row({ staff_id: 'worked', booking_status: 'worked' }),
      row({ staff_id: 'turned', booking_status: 'turned_away' }),
      row({ staff_id: 'invited', booking_status: 'invited' }),
      row({ staff_id: 'applied', booking_status: 'applied' }),
      row({ staff_id: 'closed', booking_status: 'closed' }),
    ];
    expect(selectOfferRecipients(rows, { allocation: 10, notified: [] }).sort()).toEqual([
      'applied',
      'closed',
      'invited',
    ]);
  });

  it('pushes nobody with no allocation', () => {
    expect(selectOfferRecipients([row()], { allocation: 0, notified: [] })).toEqual([]);
  });
});
