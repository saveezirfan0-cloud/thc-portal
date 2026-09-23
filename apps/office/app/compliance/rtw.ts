/**
 * The right-to-work date a reviewer confirms when verifying a visa
 * document, a status document or a share code report (§2.5, §2.6,
 * 20260923200000). Shared by /compliance and /onboarding/:id, because both
 * call the same database Verify and it refuses these three without a date.
 *
 * The rule per branch mirrors `compliance_docs_rtw_date_guard()`:
 *   - a visa or status document needs its expiry;
 *   - a share code report needs the right-to-work-until off the gov.uk
 *     report, except on the EU settled branch, where settled status may be
 *     confirmed explicitly as "no time limit" (§2.5 pt 2) — never by
 *     leaving the date blank.
 */

/** What the database reads as "confirmed: no time limit" (branch 2 share code only). */
export const NO_TIME_LIMIT = 'infinity';

export interface RtwDateRule {
  /** Which date the reviewer confirms. */
  field: 'expiry' | 'right_to_work_until';
  label: string;
  hint: string;
  /** Settled status: the reviewer may confirm there is no end date. */
  allowNoTimeLimit: boolean;
}

export function rtwDateRule(docType: string, branch: string | null): RtwDateRule | null {
  if (docType === 'visa_document' || docType === 'status_document') {
    return {
      field: 'expiry',
      label: docType === 'visa_document' ? 'Visa expiry' : 'Status document expiry',
      hint: 'Check it against the document. It becomes the worker’s right-to-work date if it is the earliest on file — no shift after it can be rostered.',
      allowNoTimeLimit: false,
    };
  }
  if (docType === 'share_code_report') {
    return {
      field: 'right_to_work_until',
      label: 'Right to work until (gov.uk report)',
      hint: 'Read it off the gov.uk report. It becomes the expiry used for reminders (§2.6, §4.4) and the last day the worker can be rostered.',
      allowNoTimeLimit: branch === 'eu_settled',
    };
  }
  return null;
}

/** Why Verify cannot go ahead yet, in words for the reviewer, or null. */
export function rtwDateProblem(
  rule: RtwDateRule | null,
  date: string,
  noTimeLimit: boolean,
): string | null {
  if (!rule) return null;
  if (noTimeLimit) {
    return rule.allowNoTimeLimit
      ? null
      : 'Only a share code showing EU settled status can be verified with no time limit.';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return `Confirm the ${rule.label.toLowerCase()}.`;
  return null;
}

/** The value sent to the database for the confirmed date. */
export function rtwDateValue(date: string, noTimeLimit: boolean): string {
  return noTimeLimit ? NO_TIME_LIMIT : date;
}
