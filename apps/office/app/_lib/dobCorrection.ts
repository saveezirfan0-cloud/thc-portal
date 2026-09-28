import { DOB_CORRECTION_MESSAGES } from '@thc/domain';
import { explainOfficeError } from './permissions';

/**
 * "Correct" on the date of birth — /staff/:id Overview and /onboarding/:id
 * (ADR-0069). Pure: the words for the database's refusals and for what
 * happened, so the dialog and its tests read the same sentences.
 *
 * The rule itself is `validateDobCorrection()` in packages/domain, which
 * `office_correct_dob()` repeats; this file only speaks.
 */

/** What `office_correct_dob()` returns (20261001208000). */
export interface DobCorrectionAnswer {
  ok?: boolean;
  dob?: string;
  previousDob?: string;
  /** queued | running | off | none — the pending share code's gov.uk check. */
  rtwCheck?: string;
  checkId?: string;
  /** A signed 48-hour opt-out now predates their eighteenth birthday. */
  optOutSignedUnder18?: boolean;
}

export type DobCorrectionResult =
  { ok: true; note: string; warning: string | null } | { ok: false; message: string };

const MESSAGES: Readonly<Record<string, string>> = {
  ...DOB_CORRECTION_MESSAGES,
  staff_removed: 'This worker was removed under GDPR; nothing personal can be added back.',
  staff_not_found: 'That profile no longer exists — refresh the page.',
  not_authorised: 'Only the office can do this.',
};

/** A refusal in words a manager can act on; anything unknown as the database said it. */
export function dobCorrectionMessage(raw: string): string {
  const office = explainOfficeError(raw);
  if (office) return office;
  const code = raw.split(':')[0]?.trim() ?? '';
  if (MESSAGES[code]) return MESSAGES[code] as string;
  const key = Object.keys(MESSAGES).find((c) => raw.includes(c));
  return key ? (MESSAGES[key] as string) : raw;
}

/** The line under the date once it is saved: what happened to gov.uk, and the opt-out. */
export function dobCorrectionOutcome(answer: DobCorrectionAnswer | null): {
  note: string;
  warning: string | null;
} {
  const note = (() => {
    switch (answer?.rtwCheck) {
      case 'queued':
        return 'Saved. The pending share code is being checked with gov.uk again, with the new date — the result comes back to Compliance → Needs review.';
      case 'running':
        return 'Saved. A gov.uk check was already running with the old date: when it lands, press “Run check again” on the Documents tab.';
      case 'off':
        return 'Saved. The automated gov.uk check is off, so check the pending share code by hand with the new date.';
      default:
        return 'Saved. The change is in the activity log with your reason.';
    }
  })();
  const warning = answer?.optOutSignedUnder18
    ? 'By this date they were under 18 when they signed the 48-hour opt-out, which an under-18 cannot do. The weekly limit already ignores it for the weeks before their eighteenth birthday; ask them to sign it again from the app.'
    : null;
  return { note, warning };
}
