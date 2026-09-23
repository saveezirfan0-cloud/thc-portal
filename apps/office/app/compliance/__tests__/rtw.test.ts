import { describe, expect, it } from 'vitest';
import { NO_TIME_LIMIT, rtwDateProblem, rtwDateRule, rtwDateValue } from '../rtw';

describe('rtwDateRule (§2.5, mirrors compliance_docs_rtw_date_guard)', () => {
  it('asks for the expiry on a visa or status document, with no way round it', () => {
    expect(rtwDateRule('visa_document', 'work_visa')).toMatchObject({
      field: 'expiry',
      allowNoTimeLimit: false,
    });
    expect(rtwDateRule('status_document', 'dependant_other')).toMatchObject({
      field: 'expiry',
      allowNoTimeLimit: false,
    });
  });

  it('asks for the right-to-work-until on a share code; only branch 2 may confirm no time limit', () => {
    expect(rtwDateRule('share_code_report', 'eu_settled')).toMatchObject({
      field: 'right_to_work_until',
      allowNoTimeLimit: true,
    });
    for (const branch of ['work_visa', 'international_student', 'dependant_other', null]) {
      expect(rtwDateRule('share_code_report', branch)?.allowNoTimeLimit).toBe(false);
    }
  });

  it('asks nothing of documents that are not right-to-work evidence', () => {
    for (const type of ['passport', 'national_id', 'ni_evidence', 'university_term_dates_letter']) {
      expect(rtwDateRule(type, 'work_visa')).toBeNull();
    }
  });
});

describe('rtwDateProblem', () => {
  const visa = rtwDateRule('visa_document', 'work_visa');
  const settled = rtwDateRule('share_code_report', 'eu_settled');
  const student = rtwDateRule('share_code_report', 'international_student');

  it('never lets a blank date through', () => {
    expect(rtwDateProblem(visa, '', false)).toMatch(/visa expiry/);
    expect(rtwDateProblem(settled, '', false)).toMatch(/right to work until/);
    expect(rtwDateProblem(visa, '2027-03-31', false)).toBeNull();
  });

  it('takes "no time limit" on the settled branch only', () => {
    expect(rtwDateProblem(settled, '', true)).toBeNull();
    expect(rtwDateProblem(student, '', true)).toMatch(/settled status/);
    expect(rtwDateProblem(visa, '', true)).toMatch(/settled status/);
  });

  it('sends the explicit sentinel, never a blank, for no time limit', () => {
    expect(rtwDateValue('', true)).toBe(NO_TIME_LIMIT);
    expect(rtwDateValue('2027-03-31', false)).toBe('2027-03-31');
  });

  it('is silent for other documents', () => {
    expect(rtwDateProblem(null, '', false)).toBeNull();
  });
});
