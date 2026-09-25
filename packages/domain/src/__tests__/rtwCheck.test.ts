import { describe, expect, it } from 'vitest';
import {
  assessRtwResult,
  nameTokens,
  namesMatch,
  redactRtwInputs,
  rtwCheckWorkerLine,
  rtwRecommendedAction,
  rtwRejectReason,
  type RtwExtraction,
  type RtwWorker,
} from '../rtwCheck';

const TODAY = '2026-09-28';

const visaWorker: RtwWorker = {
  firstName: 'Maria',
  lastName: 'Garcia',
  branch: 'work_visa',
  belowDegreeLevel: false,
};

const found: RtwExtraction = {
  found: true,
  hasRightToWork: true,
  holderName: 'MARIA JOSÉ GARCIA LÓPEZ',
  rightToWorkUntil: '2028-03-31',
  noTimeLimit: false,
  permissionType: 'Skilled Worker visa',
  conditions: 'They can work in the UK.',
  termTimeWeeklyHours: null,
};

describe('names (ADR-0025)', () => {
  it('drops accents, apostrophes and punctuation', () => {
    expect(nameTokens("José O'Neill-Smith")).toEqual(['JOSE', 'ONEILL', 'SMITH']);
  });

  it('matches the short form the worker typed against the full legal name', () => {
    expect(namesMatch({ firstName: 'Maria', lastName: 'Garcia' }, 'MARIA JOSÉ GARCIA LÓPEZ')).toBe(
      true,
    );
  });

  it('matches the other way round too', () => {
    expect(namesMatch({ firstName: 'Maria José', lastName: 'Garcia López' }, 'Maria Garcia')).toBe(
      true,
    );
  });

  it('never matches on a shared first name alone', () => {
    expect(namesMatch({ firstName: 'Maria', lastName: 'Garcia' }, 'MARIA SMITH')).toBe(false);
    expect(namesMatch({ firstName: 'Maria', lastName: 'Garcia' }, 'MARIA')).toBe(false);
  });

  it('never matches a missing name', () => {
    expect(namesMatch({ firstName: 'Maria', lastName: 'Garcia' }, null)).toBe(false);
  });
});

describe('assessRtwResult — the office is shown a recommendation, never a decision', () => {
  it('a clean result on the right branch passes', () => {
    expect(assessRtwResult(visaWorker, found, TODAY)).toEqual({ outcome: 'pass', reasons: [] });
  });

  it('"not found" is its own outcome, pointing to reject', () => {
    const a = assessRtwResult(visaWorker, { ...found, found: false }, TODAY);
    expect(a.outcome).toBe('not_found');
    expect(rtwRecommendedAction(a.outcome)).toBe('reject');
  });

  it('"no right to work" is its own outcome', () => {
    expect(assessRtwResult(visaWorker, { ...found, hasRightToWork: false }, TODAY).outcome).toBe(
      'no_right_to_work',
    );
  });

  it('a right to work that has already ended is no right to work', () => {
    const a = assessRtwResult(visaWorker, { ...found, rightToWorkUntil: '2026-09-27' }, TODAY);
    expect(a.outcome).toBe('no_right_to_work');
  });

  it('a right to work ending today still stands today', () => {
    expect(assessRtwResult(visaWorker, { ...found, rightToWorkUntil: TODAY }, TODAY).outcome).toBe(
      'pass',
    );
  });

  it('a different name goes to review and is never passed', () => {
    const a = assessRtwResult(visaWorker, { ...found, holderName: 'JOHN SMITH' }, TODAY);
    expect(a.outcome).toBe('name_mismatch');
    expect(rtwRecommendedAction(a.outcome)).toBe('review');
  });

  it('an unreadable date is never passed', () => {
    expect(
      assessRtwResult(visaWorker, { ...found, rightToWorkUntil: '31 March 2028' }, TODAY).outcome,
    ).toBe('conditions_mismatch');
  });

  it('neither a date nor "no time limit" is never passed', () => {
    expect(assessRtwResult(visaWorker, { ...found, rightToWorkUntil: null }, TODAY).outcome).toBe(
      'conditions_mismatch',
    );
  });

  it('"no time limit" passes on the EU settled branch only (ADR-0018)', () => {
    const settled = { ...found, rightToWorkUntil: null, noTimeLimit: true };
    expect(assessRtwResult({ ...visaWorker, branch: 'eu_settled' }, settled, TODAY).outcome).toBe(
      'pass',
    );
    expect(assessRtwResult(visaWorker, settled, TODAY).outcome).toBe('conditions_mismatch');
  });

  describe('term-time conditions against RULE-20', () => {
    const student: RtwWorker = { ...visaWorker, branch: 'international_student' };
    const studentVisa = { ...found, permissionType: 'Student visa', termTimeWeeklyHours: 20 };

    it('a student with the 20-hour condition passes; the cap stays calculated', () => {
      expect(assessRtwResult(student, studentVisa, TODAY).outcome).toBe('pass');
    });

    it('10 hours on gov.uk against a degree-level profile is flagged: the calculated cap would allow 20', () => {
      const a = assessRtwResult(student, { ...studentVisa, termTimeWeeklyHours: 10 }, TODAY);
      expect(a.outcome).toBe('conditions_mismatch');
      expect(a.reasons.join(' ')).toMatch(/below degree level/);
    });

    it('10 hours with the profile already below degree level passes', () => {
      const a = assessRtwResult(
        { ...student, belowDegreeLevel: true },
        { ...studentVisa, termTimeWeeklyHours: 10 },
        TODAY,
      );
      expect(a.outcome).toBe('pass');
    });

    it('20 hours on gov.uk with the profile below degree level is not a conflict: the calculated 10 is stricter', () => {
      expect(
        assessRtwResult({ ...student, belowDegreeLevel: true }, studentVisa, TODAY).outcome,
      ).toBe('pass');
    });

    it('a student branch with no term-time limit on gov.uk is flagged', () => {
      expect(assessRtwResult(student, found, TODAY).outcome).toBe('conditions_mismatch');
    });

    it('a term-time limit on a worker who chose another branch is flagged', () => {
      expect(assessRtwResult(visaWorker, studentVisa, TODAY).outcome).toBe('conditions_mismatch');
    });
  });
});

describe('words', () => {
  it('pre-fills a worker-facing reason for the two reject outcomes only', () => {
    expect(rtwRejectReason('not_found')).toMatch(/share code/);
    expect(rtwRejectReason('no_right_to_work')).toMatch(/contact the office/);
    expect(rtwRejectReason('pass')).toBeNull();
    expect(rtwRejectReason('name_mismatch')).toBeNull();
  });

  it('tells the worker the check is running, then what happens next', () => {
    expect(rtwCheckWorkerLine({ status: 'queued', outcome: null })).toBe('Checking with gov.uk…');
    expect(rtwCheckWorkerLine({ status: 'running', outcome: null })).toBe('Checking with gov.uk…');
    expect(rtwCheckWorkerLine({ status: 'done', outcome: 'pass' })).toMatch(/confirming/);
    expect(rtwCheckWorkerLine({ status: 'done', outcome: 'not_found' })).toMatch(/reviewing/);
    expect(rtwCheckWorkerLine({ status: 'failed', outcome: null })).toMatch(/by hand/);
    expect(rtwCheckWorkerLine({ status: 'cancelled', outcome: null })).toBeNull();
    expect(rtwCheckWorkerLine(null)).toBeNull();
  });
});

describe('redactRtwInputs — the inputs never reach a log', () => {
  const inputs = { shareCode: 'W123AB4CD', dob: '1995-01-07' };

  it('removes the share code in any spacing or case', () => {
    expect(redactRtwInputs('filled W123AB4CD', inputs)).toBe('filled [share code]');
    expect(redactRtwInputs('filled w12 3ab 4cd', inputs)).toBe('filled [share code]');
  });

  it('removes the date of birth in the forms a page or error might echo', () => {
    for (const form of ['1995-01-07', '07/01/1995', '7/1/1995', '07-01-1995', '7 January 1995']) {
      expect(redactRtwInputs(`dob ${form} rejected`, inputs)).toBe('dob [date of birth] rejected');
    }
  });

  it('leaves everything else alone', () => {
    expect(redactRtwInputs('Timeout 30000ms exceeded', inputs)).toBe('Timeout 30000ms exceeded');
  });
});
