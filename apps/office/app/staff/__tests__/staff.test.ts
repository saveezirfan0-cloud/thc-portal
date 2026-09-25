import { describe, expect, it } from 'vitest';
import {
  capReason,
  employeeId,
  formatRating,
  formatDateRange,
  formatShowRate,
  formatUkDate,
  isWorker,
  limitReached,
  matchesFilter,
  matchesQuery,
  ratingTone,
  rtwUntilLabel,
  sortRows,
  statusLabel,
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
  weekly_cap_until: null,
  last_shift_at: null,
  released_shift_count: 0,
  p45_requested_at: null,
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

describe('formatUkDate (§1.8, dd.mm.yyyy as §9.6 and the wireframes write it)', () => {
  it('reads a date column, which has no instant of its own', () => {
    expect(formatUkDate('2026-07-12')).toBe('12.07.2026');
  });

  it('reads a timestamp too — the profile passes joined_at and granted_at', () => {
    // Appending a second time to an ISO instant built
    // "2026-07-12T09:00:00ZT12:00:00Z" and crashed the page on render.
    expect(formatUkDate('2026-07-12T09:00:00Z')).toBe('12.07.2026');
  });

  it('keeps the UK calendar day across midnight UTC', () => {
    // 23:30 UTC on 11 July is 00:30 on 12 July in London (BST).
    expect(formatUkDate('2026-07-11T23:30:00Z')).toBe('12.07.2026');
  });

  it('gives a dash rather than Invalid Date for something unparseable', () => {
    expect(formatUkDate('not a date')).toBe('—');
  });
});

describe('formatDateRange (§9.6 term dates)', () => {
  it('reads a half-open Postgres daterange as the days it covers', () => {
    // [2026-12-13,2027-01-10) excludes the upper bound, so the holiday
    // ends on the 9th — printing the 10th would give the worker a day of
    // 48h cap they do not have.
    expect(formatDateRange('[2026-12-13,2027-01-10)')).toBe('13.12.2026 – 09.01.2027');
  });

  it('reads an inclusive upper bound as itself', () => {
    expect(formatDateRange('[2026-12-13,2027-01-10]')).toBe('13.12.2026 – 10.01.2027');
  });

  it('reads an exclusive lower bound as the day after', () => {
    expect(formatDateRange('(2026-12-13,2027-01-10]')).toBe('14.12.2026 – 10.01.2027');
  });

  it('hands back anything it cannot parse rather than inventing dates', () => {
    expect(formatDateRange('empty')).toBe('empty');
    expect(formatDateRange('[,2027-01-10)')).toBe('[,2027-01-10)');
  });
});

describe('capReason with the date the band ends (§9.6, §8)', () => {
  it('names the date a term cap holds until', () => {
    expect(capReason('student_term_20', 20, '2026-12-13')).toBe(
      '20 h — term time until 13.12.2026',
    );
  });

  it('and says just the reason when nothing on the calendar ends it', () => {
    expect(capReason('student_term_20', 20, null)).toBe('20 h — term time');
  });

  it('never dates a standard cap — no calendar produces it', () => {
    expect(capReason('standard_48', 48, '2026-12-13')).toBe('48 h — standard weekly limit');
  });
});

describe('rtwUntilLabel (§2.5 pt 2)', () => {
  it('prints the date read off the gov.uk report', () => {
    expect(rtwUntilLabel({ right_to_work_until: '2027-03-31', rtw_no_time_limit: false })).toBe(
      '31.03.2027',
    );
  });

  it('says settled status has no time limit instead of a dash', () => {
    expect(rtwUntilLabel({ right_to_work_until: null, rtw_no_time_limit: true })).toBe(
      'Settled — no time limit',
    );
  });

  it('never reads a blank date as settled without the confirmation', () => {
    expect(rtwUntilLabel({ right_to_work_until: null, rtw_no_time_limit: false })).toBe('—');
    expect(rtwUntilLabel({ right_to_work_until: null })).toBe('—');
  });
});

describe('who the directory lists (§9.6)', () => {
  it('lists workers — compliant, blocked, inactive and removed — and adds them up', () => {
    // The wireframe crumb: 934 + 9 + 61 + 8 = 1,012 workers.
    expect(isWorker(row({ status: 'compliant' }))).toBe(true);
    expect(isWorker(row({ status: 'blocked' }))).toBe(true);
    expect(isWorker(row({ status: 'inactive' }))).toBe(true);
    expect(isWorker(row({ status: 'removed', removed: true }))).toBe(true);
  });

  it('leaves candidates and rejected applicants to /onboarding', () => {
    expect(isWorker(row({ status: 'documents' }))).toBe(false);
    expect(isWorker(row({ status: 'interview_requested' }))).toBe(false);
    expect(isWorker(row({ status: 'rejected' }))).toBe(false);
  });
});

describe('the status pill words (§9.6)', () => {
  it('never prints the raw enum', () => {
    expect(statusLabel(row({ status: 'compliant' }))).toEqual({
      label: 'Compliant',
      tone: 'green',
    });
    expect(statusLabel(row({ status: 'blocked' }))).toEqual({ label: 'Blocked', tone: 'coral' });
    expect(statusLabel(row({ status: 'inactive' }))).toEqual({
      label: 'Inactive',
      tone: 'neutral',
    });
    expect(statusLabel(row({ status: 'removed', removed: true })).label).toBe('Removed');
    expect(statusLabel(row({ status: 'interview_requested' })).label).toBe('Onboarding');
    expect(statusLabel(row({ status: 'rejected' })).label).toBe('Rejected');
  });
});

describe('the Inactive tab is newest first (§9.6, §10.6)', () => {
  const earlier = row({
    id: 'a',
    display_name: 'Aiden R.',
    status: 'inactive',
    left_at: '2026-09-02T07:12:00Z',
  });
  const later = row({
    id: 'b',
    display_name: 'Rosa T.',
    status: 'inactive',
    left_at: '2026-09-17T20:14:00Z',
  });

  it('puts the later leaver first whatever the sort control says', () => {
    expect(sortRows([earlier, later], 'inactive', 'name').map((r) => r.id)).toEqual(['b', 'a']);
    expect(sortRows([later, earlier], 'inactive', 'name').map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('sorts the other tabs by the control', () => {
    expect(sortRows([later, earlier], 'all', 'name').map((r) => r.id)).toEqual(['a', 'b']);
    const good = row({ id: 'g', rating: 4.9 });
    const poor = row({ id: 'p', rating: 2.1 });
    expect(sortRows([poor, good], 'all', 'rating').map((r) => r.id)).toEqual(['g', 'p']);
  });
});
