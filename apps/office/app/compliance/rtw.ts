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
  /**
   * The Home Office check result (ADR-0177): the reviewer types the date
   * the Home Office approved it, and the right to work runs six months from
   * it (`homeOfficeCheckUntil`), editable.
   */
  approvedOn?: boolean;
}

/** The Home Office check result's two labels and hint (THC, 22.10.2026). */
export const HOME_OFFICE_APPROVED_LABEL = 'Date approved (on the Home Office result)';
export const HOME_OFFICE_UNTIL_HINT =
  'Six months from the date approved. Change it only if the result says otherwise.';

export function rtwDateRule(docType: string, branch: string | null): RtwDateRule | null {
  if (docType === 'visa_document' || docType === 'status_document') {
    return {
      field: 'expiry',
      label: docType === 'visa_document' ? 'Visa expiry' : 'Status document expiry',
      hint: 'Check it against the document. It becomes the worker’s right-to-work date if it is the earliest on file — no shift after it can be rostered.',
      allowNoTimeLimit: false,
    };
  }
  if (docType === 'home_office_check_result') {
    return {
      field: 'right_to_work_until',
      label: 'Right to work until',
      hint: HOME_OFFICE_UNTIL_HINT,
      allowNoTimeLimit: false,
      approvedOn: true,
    };
  }
  if (docType === 'share_code_report') {
    return {
      field: 'right_to_work_until',
      label: 'Right to work until (gov.uk report)',
      hint: 'Read it off the gov.uk report. It becomes the expiry used for reminders and the last day the worker can be rostered.',
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

/**
 * Why a Home Office check result cannot be verified yet, or null — the
 * database's own refusals (compliance_verify_home_office_check), said first.
 */
export function homeOfficeVerifyProblem(
  approvedOn: string,
  until: string,
  today: string,
): string | null {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(approvedOn)) return 'Enter the date approved on the Home Office result.';
  if (approvedOn > today) return 'The date approved cannot be in the future.';
  if (!iso.test(until)) return 'Confirm the right to work until.';
  if (until <= approvedOn) return 'The right to work must end after the date approved.';
  if (until <= today) return 'This result has already run out — it cannot be verified.';
  return null;
}

/** The value sent to the database for the confirmed date. */
export function rtwDateValue(date: string, noTimeLimit: boolean): string {
  return noTimeLimit ? NO_TIME_LIMIT : date;
}
