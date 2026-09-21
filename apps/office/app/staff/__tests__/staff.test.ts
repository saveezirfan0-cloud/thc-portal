import { describe, expect, it } from 'vitest';
import {
  capReason,
  employeeId,
  formatRating,
  formatShowRate,
  limitReached,
  matchesFilter,
  matchesQuery,
  ratingTone,
} from '../staff';
import type { StaffRow } from '../types';

const WORKER: StaffRow = {
  id: 'w1',
  employee_id: 873,
  status: 'compliant',
  removed: false,
  display_name: 'Amara K.',
  photo_path: null,
  rating: 4.6,
  reliability: 98,
  block_kind: null,
  block_reason: null,
  rtw_branch: 'international_student',
  right_to_work_until: '2028-03-31',
  graduated_at: null,
  wtr_optout: false,
  left_at: null,
  leave_reason: null,
  role_names: ['Waiting Staff', 'Host'],
  unresolved_violations: 0,
  do_not_return_clients: [],
  weekly_cap_hours: 20,
  weekly_cap_band: 'student_term_20',
  weekly_booked_hours: 18,
};

const row = (overrides: Partial<StaffRow>): StaffRow => ({ ...WORKER, ...overrides });

describe('rating colour (§9.6)', () => {
  it.each([
    [0, 'coral'],
    [2.9, 'coral'],
    [3.0, 'amber'],
    [3.9, 'amber'],
    [4.0, 'green'],
    [5, 'green'],
  ])('%s is %s', (rating, tone) => {
    expect(ratingTone(rating)).toBe(tone);
  });

  it('is neither for a worker who has not been rated yet', () => {
    // A new worker with no completed shift is not a bad worker.
    expect(ratingTone(null)).toBe('none');
    expect(formatRating(null)).toBe('—');
  });

  it('puts the boundaries where §9.6 puts them, not a tenth out', () => {
    expect(ratingTone(2.99)).toBe('coral');
    expect(ratingTone(3.99)).toBe('amber');
  });
});

describe('"Limit reached" (§9.6, RULE-20)', () => {
  it('appears once the calculated cap for the week is reached', () => {
    expect(limitReached(row({ weekly_cap_hours: 20, weekly_booked_hours: 20 }))).toBe(true);
    expect(limitReached(row({ weekly_cap_hours: 20, weekly_booked_hours: 21 }))).toBe(true);
  });

  it('does not appear below it', () => {
    expect(limitReached(row({ weekly_cap_hours: 20, weekly_booked_hours: 18 }))).toBe(false);
  });

  it('can never appear where there is no ceiling', () => {
    // Null cap is the 48h opt-out with no visa limit — there is nothing to
    // reach, and a badge here would read as a block that does not exist.
    expect(limitReached(row({ weekly_cap_hours: null, weekly_booked_hours: 90 }))).toBe(false);
  });

  it('treats a worker with nothing booked as not at the limit', () => {
    expect(limitReached(row({ weekly_cap_hours: 20, weekly_booked_hours: null }))).toBe(false);
  });
});

describe('the reason behind the badge', () => {
  it('names the rule that produced the cap, because the number alone does not', () => {
    expect(capReason('student_term_20', 20)).toMatch(/term time/);
    expect(capReason('student_holiday_48', 48)).toMatch(/holiday/);
    expect(capReason('graduated_48', 48)).toMatch(/completion letter/);
    expect(capReason('standard_48', 48)).toMatch(/standard/);
    expect(capReason('opted_out_none', null)).toMatch(/No weekly ceiling/);
  });

  it('does not read a cap that cannot be calculated as a cap of none', () => {
    // A blocked student with no verified term letter has no cap because
    // nothing can be worked out — the opposite of unlimited. Reading these
    // two the same way would tell a manager an unbookable worker has no
    // ceiling (§4.5, RULE-20).
    expect(capReason(null, null)).toMatch(/cannot be booked/);
    expect(capReason(null, null)).not.toMatch(/No weekly ceiling/);
  });
});

describe('the five filter tabs (§9.6)', () => {
  it('keeps everyone on All, removed workers included (§1.7)', () => {
    expect(matchesFilter(row({ removed: true, status: 'removed' }), 'all')).toBe(true);
  });

  it('separates compliant, blocked, inactive and removed', () => {
    expect(matchesFilter(row({ status: 'compliant' }), 'compliant')).toBe(true);
    expect(matchesFilter(row({ status: 'blocked' }), 'compliant')).toBe(false);
    expect(matchesFilter(row({ status: 'blocked' }), 'blocked')).toBe(true);
    expect(matchesFilter(row({ status: 'inactive' }), 'inactive')).toBe(true);
    expect(matchesFilter(row({ status: 'removed', removed: true }), 'removed')).toBe(true);
  });

  it('does not treat a worker at their weekly limit as a status', () => {
    // RULE-20: "Limit reached" is a per-week condition and never replaces
    // Compliant / Blocked / Removed.
    const atLimit = row({ weekly_booked_hours: 20 });
    expect(limitReached(atLimit)).toBe(true);
    expect(matchesFilter(atLimit, 'compliant')).toBe(true);
    expect(matchesFilter(atLimit, 'blocked')).toBe(false);
  });
});

describe('search (§9.6)', () => {
  it('matches the name', () => {
    expect(matchesQuery(WORKER, 'amara')).toBe(true);
    expect(matchesQuery(WORKER, 'AMARA')).toBe(true);
  });

  it('matches the Employee ID the way it is printed', () => {
    expect(matchesQuery(WORKER, 'THC-00873')).toBe(true);
    expect(matchesQuery(WORKER, '00873')).toBe(true);
  });

  it('matches a role', () => {
    expect(matchesQuery(WORKER, 'host')).toBe(true);
  });

  it('finds a removed worker by the id they are now known as', () => {
    const removed = row({ display_name: 'Deleted account #1042', employee_id: 1042 });
    expect(matchesQuery(removed, '1042')).toBe(true);
  });

  it('misses what is not there', () => {
    expect(matchesQuery(WORKER, 'zzz')).toBe(false);
  });

  it('keeps everyone on an empty query', () => {
    expect(matchesQuery(WORKER, '   ')).toBe(true);
  });
});

describe('the formats the wireframe prints', () => {
  it('pads the Employee ID to five digits', () => {
    expect(employeeId(873)).toBe('THC-00873');
    expect(employeeId(10412)).toBe('THC-10412');
    expect(employeeId(null)).toBe('—');
  });

  it('prints the show-rate as a whole percentage', () => {
    expect(formatShowRate(98)).toBe('98%');
    expect(formatShowRate(99.6)).toBe('100%');
    expect(formatShowRate(null)).toBe('—');
  });
});
