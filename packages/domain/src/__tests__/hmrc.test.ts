import { describe, expect, it } from 'vitest';
import {
  HMRC_TAX_CODE,
  deriveStatement,
  hmrcMissing,
  isValidNiNumber,
  maskNiNumber,
  storedHmrcAnswers,
  visibleHmrcQuestions,
} from '../hmrc';
import type { HmrcForm } from '../hmrc';

const yes = true;
const no = false;

describe('HMRC statement derivation (§2.8, HMRC questions 8–10)', () => {
  it.each([
    // q1,   q2,   q3,   statement
    [yes, null, null, 'C'],
    [yes, yes, yes, 'C'], // hidden answers are ignored, not read
    [no, yes, null, 'C'],
    [no, yes, no, 'C'],
    [no, no, yes, 'B'],
    [no, no, no, 'A'],
  ] as const)('Q1=%s Q2=%s Q3=%s → %s', (q1OtherJob, q2Pension, q3Since6April, want) => {
    expect(deriveStatement({ q1OtherJob, q2Pension, q3Since6April })).toBe(want);
  });

  it('is undecided until the routing is answered', () => {
    expect(deriveStatement({ q1OtherJob: null, q2Pension: null, q3Since6April: null })).toBeNull();
    expect(deriveStatement({ q1OtherJob: no, q2Pension: null, q3Since6April: null })).toBeNull();
    expect(deriveStatement({ q1OtherJob: no, q2Pension: no, q3Since6April: null })).toBeNull();
  });

  it('shows Q2 only when Q1 = No, and Q3 only when Q1 = Q2 = No', () => {
    expect(visibleHmrcQuestions({ q1OtherJob: yes, q2Pension: null, q3Since6April: null })).toEqual(
      { q2: false, q3: false },
    );
    expect(visibleHmrcQuestions({ q1OtherJob: no, q2Pension: null, q3Since6April: null })).toEqual({
      q2: true,
      q3: false,
    });
    expect(visibleHmrcQuestions({ q1OtherJob: no, q2Pension: yes, q3Since6April: null })).toEqual({
      q2: true,
      q3: false,
    });
    expect(visibleHmrcQuestions({ q1OtherJob: no, q2Pension: no, q3Since6April: null })).toEqual({
      q2: true,
      q3: true,
    });
  });

  it('stores a hidden question as null, never a stale answer', () => {
    expect(storedHmrcAnswers({ q1OtherJob: yes, q2Pension: no, q3Since6April: yes })).toEqual({
      q1OtherJob: yes,
      q2Pension: null,
      q3Since6April: null,
    });
  });

  it('maps each statement to HMRC’s starter code', () => {
    expect(HMRC_TAX_CODE).toEqual({ A: '1257L', B: '1257L W1/M1', C: 'BR' });
  });
});

describe('the checklist form', () => {
  const complete: HmrcForm = {
    q1OtherJob: no,
    q2Pension: no,
    q3Since6April: no,
    studentLoan: 'none',
    postgraduateLoan: false,
    niNumber: '',
    declared: true,
  };

  it('is ready with no NI number — it is optional', () => {
    expect(hmrcMissing(complete)).toEqual([]);
  });

  it('needs the declaration tick', () => {
    expect(hmrcMissing({ ...complete, declared: false })).toEqual(['tick the declaration']);
  });

  it('asks for Q3 only when it is shown', () => {
    expect(hmrcMissing({ ...complete, q3Since6April: null })).toEqual(['answer question 3']);
    expect(hmrcMissing({ ...complete, q1OtherJob: yes, q3Since6April: null })).toEqual([]);
  });

  it('a plan and the Postgraduate Loan can run together', () => {
    expect(hmrcMissing({ ...complete, studentLoan: 'plan1', postgraduateLoan: true })).toEqual([]);
  });

  it('rejects a malformed NI number but not a blank one', () => {
    expect(hmrcMissing({ ...complete, niNumber: 'nonsense' })).toEqual([
      'fix the National Insurance number',
    ]);
    expect(hmrcMissing({ ...complete, niNumber: 'AB 12 34 56 C' })).toEqual([]);
  });

  it('ignores the NI field once it is locked', () => {
    expect(hmrcMissing({ ...complete, niNumber: 'nonsense' }, true)).toEqual([]);
  });
});

describe('NI number', () => {
  it('accepts a real-format number typed with spaces', () => {
    expect(isValidNiNumber('AB 12 34 56 C')).toBe(true);
  });
  it('refuses the wireframe’s QQ sample, as staff_set_ni_number() does — QQ is never issued', () => {
    expect(isValidNiNumber('QQ 12 34 56 B')).toBe(false);
  });
  it('refuses the prefixes HMRC never issues', () => {
    expect(isValidNiNumber('DA123456A')).toBe(false);
    expect(isValidNiNumber('QQ123456E')).toBe(false);
  });
  it('masks all but the last two characters', () => {
    expect(maskNiNumber('QQ 12 34 56 B')).toBe('●●●●●●●6B');
  });
});
