import { describe, expect, it } from 'vitest';
import {
  NO_HOLIDAYS_REQUIRED,
  NO_HOLIDAYS_TICK,
  blankPeriod,
  letterExpiry,
  periodSource,
  periodsEdited,
  periodsFromLetter,
  replacesPreviousLine,
  termDatesPayload,
  termDatesPayloadProblem,
  termLetterVerifyProblem,
  termPeriodsProblem,
} from '../termDates';
import { termLetterStaffIds, withStaffTermDates } from '../termDatesData';
import type { QueueRow } from '../types';

/**
 * The holiday periods a reviewer confirms on a University Term Dates Letter
 * (ADR-0178): the same rules on the candidate screen, the Needs review
 * dialog and the /staff/:id Documents tab.
 */

// The office's example: the course finished 15/08/2026 and restarts
// 18/01/2027, so the holiday is 16/08/2026–17/01/2027.
const PRABIN = { from: '2026-08-16', to: '2027-01-17' };

describe('the periods the letter was read as', () => {
  it('opens on the AI’s ranges, both ends inclusive, each marked as the AI’s', () => {
    const rows = periodsFromLetter(['[2026-12-19,2027-01-11)', '[2027-06-19,2027-09-27)']);
    expect(rows.map(({ from, to }) => ({ from, to }))).toEqual([
      { from: '2026-12-19', to: '2027-01-10' },
      { from: '2027-06-19', to: '2027-09-26' },
    ]);
    expect(rows.map(periodSource)).toEqual(['ai', 'ai']);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });

  it('opens empty when the AI read nothing, and skips what it cannot parse', () => {
    expect(periodsFromLetter(null)).toEqual([]);
    expect(periodsFromLetter(['empty', '[2026-12-19,)'])).toEqual([]);
  });

  it('marks a corrected row as edited by hand, and a new one as added by hand', () => {
    const [row] = periodsFromLetter(['[2026-12-19,2027-01-11)']);
    expect(periodSource({ ...row!, to: '2027-01-17' })).toBe('edited');
    expect(periodSource(blankPeriod())).toBe('hand');
    expect(periodSource({ ...blankPeriod(), ...PRABIN })).toBe('hand');
  });

  it('knows when the reviewer changed anything (the dialog asks before discarding)', () => {
    const ranges = ['[2026-12-19,2027-01-11)'];
    const rows = periodsFromLetter(ranges);
    expect(periodsEdited(rows, ranges)).toBe(false);
    expect(periodsEdited([], ranges)).toBe(true);
    expect(periodsEdited([...rows, blankPeriod()], ranges)).toBe(true);
    expect(periodsEdited([{ ...rows[0]!, from: '2026-12-18' }], ranges)).toBe(true);
  });
});

describe('what is wrong with the periods', () => {
  it('uses the candidate screen’s words', () => {
    expect(termPeriodsProblem([{ from: '2027-03-27', to: '' }])).toBe('Period 1 needs both dates.');
    expect(termPeriodsProblem([PRABIN, { from: '2027-03-27', to: '2027-03-01' }])).toBe(
      'Period 2 ends before it starts.',
    );
    expect(termPeriodsProblem([])).toBeNull();
    expect(termPeriodsProblem([PRABIN])).toBeNull();
  });

  it('refuses a date that is not on the calendar', () => {
    expect(termPeriodsProblem([{ from: '2027-02-30', to: '2027-03-02' }])).toBe(
      'Period 1 has a date that is not on the calendar.',
    );
  });

  it('refuses a period longer than a year — a typed year — as the database does', () => {
    expect(termPeriodsProblem([{ from: '2026-08-16', to: '2072-01-17' }])).toBe(
      'Period 1 runs for more than a year — check the year of each date.',
    );
    // 366 days, both ends counted, is the most a period may run.
    expect(termPeriodsProblem([{ from: '2027-01-01', to: '2028-01-01' }])).toBeNull();
    expect(termPeriodsProblem([{ from: '2027-01-01', to: '2028-01-02' }])).not.toBeNull();
  });
});

describe('no holidays on the letter', () => {
  it('needs the tick, and says what it means', () => {
    expect(NO_HOLIDAYS_TICK).toBe(
      'This letter shows no holidays. The worker will be limited to 20 hours a week (10 below degree level) all year.',
    );
    expect(termDatesPayloadProblem([], false)).toBe(NO_HOLIDAYS_REQUIRED);
    expect(termDatesPayloadProblem([], undefined)).toBe(NO_HOLIDAYS_REQUIRED);
    expect(termDatesPayloadProblem([], true)).toBeNull();
    expect(termDatesPayloadProblem([PRABIN], false)).toBeNull();
  });
});

describe('the wire form', () => {
  it('is the half-open daterange verify takes, from/to only', () => {
    expect(termDatesPayload([PRABIN])).toEqual(['[2026-08-16,2027-01-18)']);
    expect(termDatesPayload([{ ...blankPeriod(), from: '2026-12-31', to: '2026-12-31' }])).toEqual([
      '[2026-12-31,2027-01-01)',
    ]);
    expect(termDatesPayload([])).toEqual([]);
  });
});

describe('when the letter will expire (ADR-0103)', () => {
  const uploaded = '2026-10-20T10:00:00Z';
  const today = '2026-10-21';

  it('on the last date of the periods on screen', () => {
    expect(letterExpiry([PRABIN], uploaded, today)).toEqual({
      expiresOn: '2027-01-17',
      text: 'Letter expires 17.01.2027 (last date on the letter)',
      problem: null,
    });
    expect(
      letterExpiry([{ from: '2027-06-19', to: '2027-09-26' }, PRABIN], uploaded, today).expiresOn,
    ).toBe('2027-09-26');
  });

  it('ignores a half-typed row, and with none falls back to the calendar year', () => {
    expect(letterExpiry([{ from: '2027-01-02', to: '' }], uploaded, today).text).toBe(
      'Letter expires 31.12.2026 (no dates on the letter — calendar-year fallback)',
    );
    // Uploaded in November: the following 31 December (ADR-0011).
    expect(letterExpiry([], '2026-11-15T10:00:00Z', today).expiresOn).toBe('2027-12-31');
  });

  it('says when the dates have already run out — Verify would be refused', () => {
    const past = letterExpiry([{ from: '2026-06-13', to: '2026-09-21' }], uploaded, today);
    expect(past.problem).toMatch(/^The last date on this letter is 21\.09\.2026/);
    // Today is the last day: the database refuses it too (already_expired).
    expect(
      letterExpiry([{ from: '2026-06-13', to: today }], uploaded, today).problem,
    ).not.toBeNull();
    expect(
      letterExpiry([{ from: '2026-06-13', to: '2026-10-22' }], uploaded, today).problem,
    ).toBeNull();
  });
});

describe('replacing the previous letter’s dates', () => {
  const previous = ['[2026-06-13,2026-09-22)'];

  it('says so, listing them', () => {
    expect(replacesPreviousLine(previous, [PRABIN])).toBe(
      'Verifying replaces the holiday dates from their previous letter (13.06.2026–21.09.2026) with the ones above.',
    );
    expect(replacesPreviousLine(previous, [])).toBe(
      'Verifying removes the holiday dates from their previous letter (13.06.2026–21.09.2026). Every week will count as term time.',
    );
  });

  it('says nothing with none on file, or the same dates', () => {
    expect(replacesPreviousLine(null, [PRABIN])).toBeNull();
    expect(replacesPreviousLine([], [])).toBeNull();
    expect(replacesPreviousLine(previous, [{ from: '2026-06-13', to: '2026-09-21' }])).toBeNull();
  });
});

describe('whether Verify is available', () => {
  const base = { uploadedAt: '2026-10-20T10:00:00Z', today: '2026-10-21' };

  it('not while a row is incomplete, nor with none and no tick, nor with dates run out', () => {
    expect(
      termLetterVerifyProblem({
        ...base,
        periods: [PRABIN, blankPeriod()],
        noHolidaysConfirmed: false,
      }),
    ).toBe('Period 2 needs both dates.');
    expect(termLetterVerifyProblem({ ...base, periods: [], noHolidaysConfirmed: false })).toBe(
      NO_HOLIDAYS_REQUIRED,
    );
    expect(
      termLetterVerifyProblem({
        ...base,
        periods: [{ from: '2026-06-13', to: '2026-09-21' }],
        noHolidaysConfirmed: false,
      }),
    ).toMatch(/already run out/);
  });

  it('with complete periods, or none and the tick', () => {
    expect(
      termLetterVerifyProblem({ ...base, periods: [PRABIN], noHolidaysConfirmed: false }),
    ).toBeNull();
    expect(termLetterVerifyProblem({ ...base, periods: [], noHolidaysConfirmed: true })).toBeNull();
  });
});

describe('the dates on file, merged into the queue', () => {
  const row = (over: Partial<QueueRow>) =>
    ({
      kind: 'document',
      item_id: 'd1',
      staff_id: 's1',
      item_type: 'university_term_dates_letter',
      ...over,
    }) as QueueRow;

  it('only on term letters', () => {
    const rows = [row({}), row({ item_id: 'd2', staff_id: 's2', item_type: 'passport' })];
    expect(termLetterStaffIds(rows)).toEqual(['s1']);
    const merged = withStaffTermDates(rows, new Map([['s1', ['[2026-06-13,2026-09-22)']]]));
    expect(merged[0]!.staff_term_dates).toEqual(['[2026-06-13,2026-09-22)']);
    expect(merged[1]!.staff_term_dates).toBeUndefined();
    expect(withStaffTermDates([row({})], () => null)[0]!.staff_term_dates).toEqual([]);
  });
});
