/**
 * The facts a reviewer confirms beside a document — pure, so /compliance,
 * the staff profile's Documents tab and the candidate profile say the same
 * thing and it is tested without a browser.
 *
 *   · Course level (audit D32, ADR-0040): verifying a student's right to
 *     work or term letter, the reviewer says whether the course is below
 *     degree level — the Student condition is then 10 h a week in term
 *     time, not 20. `compliance_set_below_degree_level()`.
 *   · A visa's own hours limit (D36): verifying a work or dependant visa's
 *     right to work, the reviewer records the weekly limit written on it,
 *     if any. The opt-out cannot lift it. `compliance_set_visa_hour_limit()`.
 *     The automated gov.uk check's parsed limit is the pre-filled value
 *     (ADR-0025).
 *   · The NI number (D43): NI evidence is checked against the number, so the
 *     number is shown in full beside it. Not entered yet → the document is
 *     flagged and comes back to Needs review once it is.
 */

/** The three documents that carry a right to work. */
export const RTW_DOC_TYPES = ['visa_document', 'status_document', 'share_code_report'] as const;

export type ConditionField = 'below_degree' | 'visa_limit';

/** Which reviewer field goes with verifying this document for this branch, if any. */
export function conditionFieldFor(docType: string, branch: string | null): ConditionField | null {
  const rtw = (RTW_DOC_TYPES as readonly string[]).includes(docType);
  if (branch === 'international_student' && (rtw || docType === 'university_term_dates_letter')) {
    return 'below_degree';
  }
  if ((branch === 'work_visa' || branch === 'dependant_other') && rtw) return 'visa_limit';
  return null;
}

const WEEKLY_LIMIT =
  /\b(?:up to|maximum of|max(?:imum)?|no more than|limited to)?\s*(\d{1,2})\s*hours?\s*(?:a|per|each)\s*week\b/i;

/**
 * A weekly hours limit read out of the conditions gov.uk listed ("You can
 * work up to 20 hours a week"), or null. A suggestion for the reviewer, never
 * applied by itself.
 */
export function weeklyHourLimitFrom(
  conditions: readonly string[] | null | undefined,
): number | null {
  for (const line of conditions ?? []) {
    const match = WEEKLY_LIMIT.exec(line);
    if (match) {
      const hours = Number(match[1]);
      if (hours >= 1 && hours <= 48) return hours;
    }
  }
  return null;
}

/**
 * The course-level box as it opens: what is on file, or — nothing on file
 * yet — what the automated check read (a 10-hour term-time limit is the
 * below-degree condition).
 */
export function initialBelowDegree(
  onFile: boolean | null | undefined,
  checkTermLimit: number | null | undefined,
): boolean {
  if (onFile) return true;
  return checkTermLimit === 10;
}

/** The visa-limit field as it opens: on file, else the check's figure, else empty (no limit). */
export function initialVisaLimit(
  onFile: number | null | undefined,
  checkLimit: number | null | undefined,
  conditions: readonly string[] | null | undefined,
): string {
  const value = onFile ?? checkLimit ?? weeklyHourLimitFrom(conditions);
  return value === null || value === undefined ? '' : String(value);
}

/** Why the typed visa limit cannot be saved, or null. Empty means "no limit on the visa". */
export function visaLimitProblem(value: string): string | null {
  const text = value.trim();
  if (text === '') return null;
  if (!/^\d{1,2}$/.test(text))
    return 'Enter the weekly hours as a whole number, or leave it empty.';
  const hours = Number(text);
  if (hours < 1 || hours > 48) return 'A visa hours limit is between 1 and 48 hours a week.';
  return null;
}

/** The typed visa limit as the database takes it: null for none. */
export function visaLimitValue(value: string): number | null {
  const text = value.trim();
  return text === '' ? null : Number(text);
}

/** `QQ123456C` → `QQ 12 34 56 C`, the way it is printed on HMRC letters. */
export function formatNi(ni: string): string {
  const compact = ni.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{6}[A-Z]$/.test(compact)) return compact;
  return `${compact.slice(0, 2)} ${compact.slice(2, 4)} ${compact.slice(4, 6)} ${compact.slice(6, 8)} ${compact.slice(8)}`;
}

/** The line beside NI evidence when it is verified (D43). */
export function niEvidenceLine(niNumber: string | null | undefined): string {
  return niNumber
    ? `NI number on the profile: ${formatNi(niNumber)} — check it matches the document`
    : 'No NI number entered yet. Verify the evidence and it comes back to Needs review to compare once the number is entered.';
}

/** What the office is told the course-level choice means. */
export function belowDegreeHint(checkTermLimit: number | null | undefined): string {
  const read =
    checkTermLimit === 10 || checkTermLimit === 20
      ? ` The gov.uk check read a ${checkTermLimit}-hour term-time limit.`
      : '';
  return `Below degree level, the Student visa allows 10 hours a week in term time instead of 20. Tick it only if the right to work or the university letter says so.${read}`;
}

/** What the office is told the visa-limit field means. */
export const VISA_LIMIT_HINT =
  'Only if the visa itself limits the hours worked each week (e.g. 20). Leave empty when it does not. The 48-hour opt-out cannot lift a visa limit.';

/**
 * The office's completion-letter upload (D47) is offered to a live
 * Student-visa profile with none already waiting in Needs review.
 */
export function canUploadCompletionLetter(
  subject: { status: string; rtw_branch: string | null },
  documents: readonly { doc_type: string; review_status: string }[],
): boolean {
  if (subject.rtw_branch !== 'international_student') return false;
  if (['rejected', 'removed', 'inactive'].includes(subject.status)) return false;
  return !documents.some(
    (d) => d.doc_type === 'university_completion_letter' && d.review_status === 'pending',
  );
}

/**
 * "Attach gov.uk report" (D31): a current share code with no report on file,
 * on the manual path only. While the automated check is on it owns the
 * document — it stores its own report — unless its latest check needs review
 * or is stuck: the same rule as rtw_check_manual_allowed(), which
 * compliance_attach_rtw_report() applies again in the database.
 */
export function canAttachReport(
  doc: { doc_type: string; review_status: string; gov_report_path?: string | null },
  check: { report_path: string | null; status: string; stuck: boolean } | null,
  checkEnabled: boolean,
): boolean {
  if (doc.doc_type !== 'share_code_report' || doc.review_status === 'superseded') return false;
  if (doc.gov_report_path || check?.report_path) return false;
  if (!checkEnabled) return true;
  return check !== null && (check.status === 'needs_review' || check.stuck);
}
