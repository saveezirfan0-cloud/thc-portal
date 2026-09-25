import { describe, expect, it } from 'vitest';
import {
  RTW_CHECK_BACKOFF_MINUTES,
  RTW_NOT_FOUND_REASON,
  RTW_NO_RIGHT_REASON,
  decideRtwCheck,
  foldName,
  namesMatch,
  rtwCheckError,
  rtwCheckInFlight,
  rtwCheckRetryDelayMinutes,
  rtwCheckWorkerState,
  safeErrorCode,
  termTimeLimitFrom,
  unrecognisedConditions,
  type RtwCheckResult,
  type RtwCheckSubject,
} from '../rtwCheck.ts';
import {
  RTW_CHECK_TRANSITIONS,
  assertRtwCheckTransition,
  canTransitionRtwCheck,
} from '../state.ts';

/**
 * ADR-0025. Every result below is SYNTHETIC — invented for the test, not
 * captured from gov.uk or any provider (neither was reachable when this was
 * written). What they pin is the decision, not gov.uk's wording.
 */
const TODAY = '2026-09-25';

function pass(over: Partial<RtwCheckResult> = {}): RtwCheckResult {
  return {
    outcome: 'right_to_work',
    fullName: 'MARTA VILLANUEVA',
    rightToWorkUntil: '2028-03-31',
    conditions: [],
    termTimeLimitHours: null,
    referenceNumber: 'SYNTH-REF-0001',
    checkedAt: '2026-09-25T07:12:00Z',
    source: 'provider',
    ...over,
  };
}

const eu: RtwCheckSubject = {
  firstName: 'Marta',
  lastName: 'Villanueva',
  rtwBranch: 'eu_settled',
  belowDegreeLevel: false,
};
const ctx = { attempt: 1, maxAttempts: 5, today: TODAY };

describe('namesMatch — both names, any order, any case, accents and hyphens ignored', () => {
  it.each([
    ['MARTA VILLANUEVA', 'Marta', 'Villanueva'],
    ['Villanueva, Marta', 'Marta', 'Villanueva'],
    ['VILLANUEVA MARTA ELENA', 'marta', 'VILLANUEVA'],
    ['José García', 'Jose', 'Garcia'],
    ['JOSE GARCIA', 'José', 'García'],
    ['Zoë Brontë', 'Zoe', 'Bronte'],
    ['Łukasz Żółć', 'Lukasz', 'Zolc'],
    ['Øyvind Strauß', 'Oyvind', 'Strauss'],
    ['Mary Jane Smith-Jones', 'Mary-Jane', 'Smith Jones'],
    ['MARYJANE SMITHJONES', 'Mary-Jane', 'Smith-Jones'],
    ['Mary-Jane Smith Jones', 'Maryjane', 'Smith-Jones'],
    ["Siobhán O'Neill", 'Siobhan', 'ONeill'],
    ['SIOBHAN O NEILL', 'Siobhán', "O'Neill"],
  ])('%s matches %s %s', (record, first, last) => {
    expect(namesMatch(record, first, last)).toBe(true);
  });

  it.each([
    ['MARTA VILLANUEVA', 'Maria', 'Villanueva', 'first name differs'],
    ['MARTA VILLANUEVA', 'Marta', 'Villanova', 'last name differs'],
    ['MARTA', 'Marta', 'Villanueva', 'record has only one of the names'],
    ['VILLANUEVA', 'Marta', 'Villanueva', 'record has only the surname'],
    ['MARTAVILLANUEVA SMITH', 'Marta', 'Smith', 'a part glued to another word is not that word'],
    ['', 'Marta', 'Villanueva', 'empty record'],
  ])('%s does not match %s %s (%s)', (record, first, last) => {
    expect(namesMatch(record, first, last)).toBe(false);
  });

  it('never matches when a side is missing', () => {
    expect(namesMatch(null, 'Marta', 'Villanueva')).toBe(false);
    expect(namesMatch('Marta Villanueva', null, 'Villanueva')).toBe(false);
    expect(namesMatch('Marta Villanueva', 'Marta', '')).toBe(false);
  });

  it('folds letters NFD does not decompose', () => {
    expect(foldName('ÆSØŁß')).toBe('aesolss');
  });
});

describe('work conditions (assumed gov.uk wording)', () => {
  it('reads the term-time hours limit in either order', () => {
    expect(termTimeLimitFrom(['They can work up to 20 hours a week during term time.'])).toBe(20);
    expect(termTimeLimitFrom(['During term-time: 10 hours per week'])).toBe(10);
    expect(termTimeLimitFrom(['No restrictions'])).toBeNull();
    expect(termTimeLimitFrom([])).toBeNull();
  });

  it('lets benign conditions and the term limit through, and nothing else', () => {
    expect(
      unrecognisedConditions([
        'They can work up to 20 hours a week during term time',
        'They can work full-time during official vacations',
        'They cannot be self-employed',
        'They cannot work as a professional sportsperson',
        '',
      ]),
    ).toEqual([]);
    expect(
      unrecognisedConditions(['They can only work for the sponsor named on their visa']),
    ).toEqual(['They can only work for the sponsor named on their visa']);
  });
});

describe('decideRtwCheck', () => {
  it('verifies a clean pass with the gov.uk date', () => {
    expect(decideRtwCheck(pass(), eu, ctx)).toEqual({
      action: 'verify',
      rightToWorkUntil: '2028-03-31',
      noTimeLimit: false,
    });
  });

  it('verifies settled status with no time limit on the EU branch only', () => {
    expect(decideRtwCheck(pass({ rightToWorkUntil: null }), eu, ctx)).toEqual({
      action: 'verify',
      rightToWorkUntil: null,
      noTimeLimit: true,
    });
    for (const branch of ['work_visa', 'international_student', 'dependant_other'] as const) {
      const d = decideRtwCheck(
        pass({
          rightToWorkUntil: null,
          conditions:
            branch === 'international_student'
              ? ['They can work up to 20 hours a week in term time']
              : [],
        }),
        { ...eu, rtwBranch: branch },
        ctx,
      );
      expect(d.action, branch).toBe('needs_review');
    }
  });

  it('sends a name mismatch to the office, never verifies it', () => {
    const d = decideRtwCheck(pass({ fullName: 'ANNA KOWALSKA' }), eu, ctx);
    expect(d.action).toBe('needs_review');
    // The office reason never carries the names themselves.
    expect(JSON.stringify(d)).not.toMatch(/ANNA|KOWALSKA|Marta/i);
  });

  it('rejects not_found with the worker-facing reason (N8)', () => {
    expect(decideRtwCheck(pass({ outcome: 'not_found', fullName: null }), eu, ctx)).toEqual({
      action: 'reject',
      workerReason: RTW_NOT_FOUND_REASON,
      officeReason: null,
    });
  });

  it('rejects no_right_to_work AND flags it for the office', () => {
    const d = decideRtwCheck(pass({ outcome: 'no_right_to_work' }), eu, ctx);
    expect(d.action).toBe('reject');
    if (d.action !== 'reject') return;
    expect(d.workerReason).toBe(RTW_NO_RIGHT_REASON);
    expect(d.officeReason).toMatch(/NO right to work/);
  });

  it('retries an error until the attempts run out, then goes to the office', () => {
    const err = rtwCheckError('govuk', 'Timeout 30000ms exceeded');
    expect(decideRtwCheck(err, eu, { ...ctx, attempt: 4 })).toEqual({
      action: 'retry',
      error: 'timeout_30000ms_exceeded',
    });
    const last = decideRtwCheck(err, eu, { ...ctx, attempt: 5 });
    expect(last.action).toBe('needs_review');
  });

  it('refuses a date that is not in the future, or not a date', () => {
    expect(decideRtwCheck(pass({ rightToWorkUntil: TODAY }), eu, ctx).action).toBe('needs_review');
    expect(decideRtwCheck(pass({ rightToWorkUntil: '2020-01-01' }), eu, ctx).action).toBe(
      'needs_review',
    );
    expect(decideRtwCheck(pass({ rightToWorkUntil: '31/03/2028' }), eu, ctx).action).toBe(
      'needs_review',
    );
  });

  it('refuses a share code on the UK / Irish branch or with no branch', () => {
    expect(decideRtwCheck(pass(), { ...eu, rtwBranch: 'uk_irish' }, ctx).action).toBe(
      'needs_review',
    );
    expect(decideRtwCheck(pass(), { ...eu, rtwBranch: null }, ctx).action).toBe('needs_review');
  });

  describe('conditions against the chosen branch', () => {
    const student: RtwCheckSubject = { ...eu, rtwBranch: 'international_student' };
    const term20 = ['They can work up to 20 hours a week during term time'];

    it('verifies a student whose record carries the 20 h term limit', () => {
      expect(decideRtwCheck(pass({ conditions: term20 }), student, ctx).action).toBe('verify');
      // The adapter may have parsed it already.
      expect(decideRtwCheck(pass({ termTimeLimitHours: 20 }), student, ctx).action).toBe('verify');
    });

    it('sends a student with no term limit on the record to the office', () => {
      expect(decideRtwCheck(pass(), student, ctx).action).toBe('needs_review');
    });

    it('sends a term limit off the student branch to the office (the cap would be 48)', () => {
      const d = decideRtwCheck(
        pass({ conditions: term20 }),
        { ...eu, rtwBranch: 'work_visa' },
        ctx,
      );
      expect(d.action).toBe('needs_review');
    });

    it('holds the limit to the course level (RULE-20: 10 h below degree)', () => {
      expect(
        decideRtwCheck(pass({ termTimeLimitHours: 10 }), student, ctx).action,
        '10 h on the record, degree level on the profile',
      ).toBe('needs_review');
      expect(
        decideRtwCheck(
          pass({ termTimeLimitHours: 10 }),
          { ...student, belowDegreeLevel: true },
          ctx,
        ).action,
      ).toBe('verify');
      expect(
        decideRtwCheck(
          pass({ termTimeLimitHours: 20 }),
          { ...student, belowDegreeLevel: true },
          ctx,
        ).action,
      ).toBe('needs_review');
    });

    it('sends any condition it cannot apply to the office', () => {
      const d = decideRtwCheck(
        pass({ conditions: ['They can only work for the sponsor named on their visa'] }),
        { ...eu, rtwBranch: 'work_visa' },
        ctx,
      );
      expect(d.action).toBe('needs_review');
    });
  });
});

describe('retry backoff and error codes', () => {
  it('spreads five attempts over about a day', () => {
    expect(RTW_CHECK_BACKOFF_MINUTES).toEqual([30, 120, 360, 960]);
    const total = [1, 2, 3, 4].reduce((sum, n) => sum + rtwCheckRetryDelayMinutes(n), 0);
    expect(total / 60).toBeGreaterThan(20);
    expect(total / 60).toBeLessThan(28);
    expect(rtwCheckRetryDelayMinutes(9)).toBe(960);
  });

  it('never lets personal text through as an error code', () => {
    expect(safeErrorCode('Timeout for W123AB4CD / Marta Villanueva')).toBe(
      'timeout_for_w123ab4cd_marta_villanueva',
    );
    // …which is why adapters return codes, not messages: see the adapters'
    // tests for what they are allowed to put here.
    expect(safeErrorCode('')).toBe('unknown_error');
    expect(safeErrorCode('x'.repeat(200))).toHaveLength(60);
  });
});

describe('worker and office views', () => {
  it('maps statuses', () => {
    expect(rtwCheckWorkerState('queued')).toBe('checking');
    expect(rtwCheckWorkerState('running')).toBe('checking');
    expect(rtwCheckWorkerState('passed')).toBe('passed');
    expect(rtwCheckWorkerState('rejected')).toBe('re_enter');
    expect(rtwCheckWorkerState('needs_review')).toBe('with_office');
    expect(rtwCheckWorkerState('failed')).toBeNull();
    expect(rtwCheckInFlight('running')).toBe(true);
    expect(rtwCheckInFlight('needs_review')).toBe(false);
  });
});

describe('the rtw_checks state machine', () => {
  it('has terminal outcomes and a retry edge', () => {
    expect(canTransitionRtwCheck('running', 'queued')).toBe(true);
    expect(canTransitionRtwCheck('running', 'running')).toBe(true);
    expect(canTransitionRtwCheck('queued', 'passed')).toBe(false);
    for (const terminal of ['passed', 'rejected', 'needs_review', 'failed'] as const) {
      expect(RTW_CHECK_TRANSITIONS[terminal]).toEqual([]);
    }
    expect(() => assertRtwCheckTransition('passed', 'queued')).toThrow(/rtw_check/);
  });
});
