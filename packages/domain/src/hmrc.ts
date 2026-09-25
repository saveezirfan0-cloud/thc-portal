/**
 * HMRC New Starter Checklist — Scope §2.8.
 *
 * The worker answers three sequential Yes/No questions (HMRC's own routing,
 * form questions 8–10) and the system derives statement A, B or C from
 * them. "The worker never sees the resulting letter" — so nothing in the
 * Staff App renders the return value of `deriveStatement`, and the table
 * that stores it (`hmrc_checklists`) carries no worker policy (0004).
 *
 *   Q1 Do you have another job?                                  Yes → C
 *   Q2 (only if Q1 = No) Do you receive a State, workplace or
 *      private pension?                                          Yes → C
 *   Q3 (only if Q1 = No and Q2 = No) Since 6 April have you had
 *      another job which has ended, or JSA / ESA / Incapacity
 *      Benefit?                                                  Yes → B
 *                                                                No  → A
 *
 * Student loan and the Postgraduate Loan are independent of A/B/C and of
 * each other: "a worker can be repaying a Plan loan and a Postgraduate Loan
 * at the same time". The National Insurance number is optional — there is
 * no temporary number (client decision 14.07.2026) — and the declaration
 * tick is mandatory. There is no P45 upload (decided 13.08.2026).
 *
 * SQL twin: `hmrc_statement_for()` in migration 20260923120000.
 */

export type HmrcStatement = 'A' | 'B' | 'C';

export type StudentLoanPlan = 'none' | 'plan1' | 'plan2' | 'plan4';

export const STUDENT_LOAN_OPTIONS: readonly { value: StudentLoanPlan; label: string }[] = [
  { value: 'none', label: 'No' },
  { value: 'plan1', label: 'Plan 1' },
  { value: 'plan2', label: 'Plan 2' },
  { value: 'plan4', label: 'Plan 4' },
];

export interface HmrcAnswers {
  /** Q1 — Do you have another job? */
  q1OtherJob: boolean | null;
  /** Q2 — pension. Asked only when Q1 = No. */
  q2Pension: boolean | null;
  /** Q3 — another job since 6 April, or JSA / ESA / Incapacity Benefit. Only when Q1 = Q2 = No. */
  q3Since6April: boolean | null;
}

export const HMRC_QUESTIONS = {
  q1OtherJob: 'Do you have another job?',
  q2Pension: 'Do you receive payments from a State, workplace or private pension?',
  q3Since6April:
    "Since 6 April, have you received payments from another job which has ended, or any of these taxable benefits: Jobseeker's Allowance (JSA), Employment and Support Allowance (ESA), Incapacity Benefit?",
} as const;

export const HMRC_DECLARATION =
  "I confirm that the information I've given on this form is correct.";

/** Which of the three questions are on screen for these answers (§2.8 routing). */
export function visibleHmrcQuestions(a: HmrcAnswers): { q2: boolean; q3: boolean } {
  const q2 = a.q1OtherJob === false;
  const q3 = q2 && a.q2Pension === false;
  return { q2, q3 };
}

/**
 * The derived statement, or null while the routing is not yet answered.
 * Answers to questions that are not shown are ignored, never read: a worker
 * who ticked Q2 = Yes and then changed Q1 to Yes is statement C by Q1.
 */
export function deriveStatement(a: HmrcAnswers): HmrcStatement | null {
  if (a.q1OtherJob === null) return null;
  if (a.q1OtherJob) return 'C';
  if (a.q2Pension === null) return null;
  if (a.q2Pension) return 'C';
  if (a.q3Since6April === null) return null;
  return a.q3Since6April ? 'B' : 'A';
}

/**
 * The answers as they should be stored: a hidden question is null, never a
 * stale Yes/No left behind from before the worker changed an earlier one.
 */
export function storedHmrcAnswers(a: HmrcAnswers): HmrcAnswers {
  const { q2, q3 } = visibleHmrcQuestions(a);
  return {
    q1OtherJob: a.q1OtherJob,
    q2Pension: q2 ? a.q2Pension : null,
    q3Since6April: q3 ? a.q3Since6April : null,
  };
}

/**
 * The tax code HMRC attaches to each starter-checklist statement — for
 * reference only. §2.8 says the system "records the tax code that
 * corresponds to the derived statement", but the New Starter report's
 * confirmed column list (§9.9, 28.07.2026) carries "HMRC Statement (A/B/C)"
 * and no tax code, so the report reads the LETTER: `new_starter_rows()`
 * returns `statement`, `NEW_STARTER_CSV_COLUMNS` (packages/pdf) prints it,
 * and the office tab shows it. Nothing outside the tests reads this table.
 * "The code itself is defined by HMRC — the system does not invent it":
 * these are the 2026/27 codes, when the personal allowance code is 1257L.
 * If THC ever wants the code on the CSV, add a column mapped from the
 * statement in packages/pdf/src/csv.ts and confirm that year's codes here.
 */
export const HMRC_TAX_CODE: Readonly<Record<HmrcStatement, string>> = {
  A: '1257L',
  B: '1257L W1/M1',
  C: 'BR',
};

/**
 * National Insurance number format — the same pattern
 * `staff_set_ni_number()` enforces (20260922180000). Spaces are ignored and
 * case does not matter.
 */
export const NI_PATTERN = /^[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z][0-9]{6}[A-D]$/;

export function normaliseNiNumber(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

export function isValidNiNumber(raw: string): boolean {
  return NI_PATTERN.test(normaliseNiNumber(raw));
}

/** "QQ123456B" → "●●●●●●●6B", as `staff_me()` masks it (§2.8, §10.1). */
export function maskNiNumber(raw: string): string {
  const ni = normaliseNiNumber(raw);
  return '●'.repeat(Math.max(ni.length - 2, 0)) + ni.slice(-2);
}

/**
 * Gender for HMRC's payroll record — §9.9 Tab 3's "Gender (M/F)" column,
 * confirmed by THC 28.07.2026 (ADR-0024). HMRC's Real Time Information
 * submission takes exactly these two values, so the form offers exactly
 * these two and says why rather than offering options payroll could not
 * send. SQL twin: the `staff_gender_m_or_f` check and the 8-argument
 * `submit_hmrc_checklist` (20260926100100).
 */
export type HmrcGender = 'M' | 'F';

export const HMRC_GENDER_OPTIONS: readonly { value: HmrcGender; label: string }[] = [
  { value: 'M', label: 'Male' },
  { value: 'F', label: 'Female' },
];

export const HMRC_GENDER_QUESTION = 'Gender, as HMRC records it';

export const HMRC_GENDER_NOTE =
  'HMRC’s payroll records only accept male or female, so these are the only two options we can send. Choose the one HMRC holds for you — usually the one on your birth certificate or Gender Recognition Certificate. It goes on your payroll record for HMRC and is used for nothing else.';

export interface HmrcForm extends HmrcAnswers {
  studentLoan: StudentLoanPlan | null;
  postgraduateLoan: boolean;
  /** Blank = the worker has no NI number yet, which is allowed. */
  niNumber: string;
  declared: boolean;
  /**
   * `null` = asked and not yet answered (the Staff App's step 7); left out
   * = a form that does not ask it, which `hmrcMissing` then ignores.
   */
  gender?: HmrcGender | null;
}

/**
 * What still stops the checklist being submitted, as the footer hint the
 * wireframe shows ("Answer question 3 and tick the declaration to
 * continue"). Empty = ready to submit.
 */
export function hmrcMissing(form: HmrcForm, niLocked = false): string[] {
  const missing: string[] = [];
  const { q2, q3 } = visibleHmrcQuestions(form);
  if (form.q1OtherJob === null) missing.push('answer question 1');
  else if (q2 && form.q2Pension === null) missing.push('answer question 2');
  else if (q3 && form.q3Since6April === null) missing.push('answer question 3');
  if (form.studentLoan === null) missing.push('answer the student loan question');
  if (form.gender === null) missing.push('answer the gender question');
  if (!niLocked && form.niNumber.trim() !== '' && !isValidNiNumber(form.niNumber)) {
    missing.push('fix the National Insurance number');
  }
  if (!form.declared) missing.push('tick the declaration');
  return missing;
}
