import { DOB_CORRECTION_MESSAGES } from '@thc/domain';
import { explainOfficeError } from './permissions';

/**
 * "Correct" on the date of birth — /staff/:id Overview and /onboarding/:id
 * (ADR-0070). Pure: the words for the database's refusals and for what
 * happened, so the dialog and its tests read the same sentences.
 *
 * The rule itself is `validateDobCorrection()` in packages/domain, which
 * `office_correct_dob()` repeats; this file only speaks.
 */

/** What `office_correct_dob()` returns (20261001210000). */
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

// ---------------------------------------------------------------------
// A date entered with a share code (ADR-0070, route 2)
// ---------------------------------------------------------------------

/** One row of `share_code_dob_claims_v`. */
export interface DobClaim {
  documentId: string;
  staffId: string;
  /** `yyyy-mm-dd` the worker entered with the code. */
  claimedDob: string;
  /** `yyyy-mm-dd` on the profile now, or null. */
  profileDob: string | null;
  /** Verifying would put a signed 48-hour opt-out before their eighteenth birthday. */
  optOutSignedUnder18: boolean;
}

export function parseDobClaim(row: Record<string, unknown>): DobClaim | null {
  const documentId = row['document_id'];
  const claimed = row['claimed_dob'];
  if (typeof documentId !== 'string' || typeof claimed !== 'string') return null;
  return {
    documentId,
    staffId: String(row['staff_id'] ?? ''),
    claimedDob: claimed.slice(0, 10),
    profileDob: typeof row['profile_dob'] === 'string' ? row['profile_dob'].slice(0, 10) : null,
    optOutSignedUnder18: row['opt_out_signed_under_18'] === true,
  };
}

/** "05.06.1998" — the office's date shape (§9.6). */
export function ukDots(iso: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '—';
}

/**
 * The line beside the check, or null when the dates agree: "Date of birth
 * entered with this code: 15.06.1995 (profile: 31.12.1994)", then what
 * Verify will do, and the opt-out warning when it applies.
 */
export function dobClaimLine(claim: DobClaim | null | undefined): {
  text: string;
  detail: string;
  warning: string | null;
} | null {
  if (!claim || claim.claimedDob === claim.profileDob) return null;
  return {
    text: `Date of birth entered with this code: ${ukDots(claim.claimedDob)} (profile: ${ukDots(claim.profileDob)})`,
    detail:
      'gov.uk is asked with the date entered with the code. Verify also changes the profile’s date of birth to it; Reject leaves the profile as it is.',
    warning: claim.optOutSignedUnder18
      ? 'By that date they were under 18 when they signed the 48-hour opt-out, which an under-18 cannot do — if you verify, ask them to sign it again.'
      : null,
  };
}
