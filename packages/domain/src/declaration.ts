import type { DeclarationReviewStatus, StaffStatus } from './state';

/**
 * The criminal declaration after the office has looked at it (ADR-0180).
 *
 * Two halves of one rule, each mirroring a database function that is
 * authoritative:
 *
 *   declarationReviewActions()  which review buttons a declaration carries
 *                               in the Back Office — compliance_verify_declaration,
 *                               compliance_reject_declaration,
 *                               compliance_request_declaration_details and
 *                               compliance_reverse_declaration_rejection
 *                               each refuse what this does not offer;
 *   canUpdateDeclaration()      whether the worker is offered "Update your
 *                               declaration" — declaration_update_allowed(),
 *                               which update_my_declaration() asks.
 *
 * What the worker never sees: the details they typed (shown back nowhere)
 * and the office's own review note. They see the message the office wrote
 * FOR them when it asked for more details, and nothing else.
 */

type BlockKind = 'auto_document' | 'manual' | 'conviction_review' | null;

/**
 * What every office login that may not decide a criminal declaration is
 * shown beside it (ADR-0180): only the users an owner named on /users —
 * owners, while nobody is named — Verify, Reject, Ask for more details or
 * Reverse rejection. can_review_criminal_records() in the database.
 */
export const CRIMINAL_RECORDS_READ_ONLY =
  'Only office users allowed to review criminal records can decide this.';

/** The office's message to the worker, bounded in the database at the same number. */
export const DECLARATION_MESSAGE_MAX = 1000;

/** The reversal note ("Reviewed by …, cleared to work"), bounded in the database too. */
export const REVERSAL_NOTE_MAX = 1000;

/** A declaration as both screens hold it. `status` may also read `superseded` from older rows. */
export interface DeclarationForReview {
  answer: boolean;
  status: DeclarationReviewStatus | 'superseded';
  superseded: boolean;
}

export interface DeclarationReviewActions {
  verify: boolean;
  reject: boolean;
  /** "Ask for more details": a message to the worker, who answers with an updated declaration. */
  askForDetails: boolean;
  /** "Reverse rejection": the office decided the worker can work after all. */
  reverse: boolean;
}

const NONE: DeclarationReviewActions = {
  verify: false,
  reject: false,
  askForDetails: false,
  reverse: false,
};

/**
 * The review actions on one declaration. A No is verified on submission and
 * never reviewed; a superseded row is history; a Rejected or Removed person
 * has nothing left to review (§4.1, the database's `not_reviewable`).
 */
export function declarationReviewActions(
  declaration: DeclarationForReview,
  staffStatus: StaffStatus,
): DeclarationReviewActions {
  if (!declaration.answer || declaration.superseded || declaration.status === 'superseded') {
    return NONE;
  }
  if (staffStatus === 'rejected' || staffStatus === 'removed') return NONE;
  if (declaration.status === 'pending') {
    return { verify: true, reject: true, askForDetails: true, reverse: false };
  }
  if (declaration.status === 'rejected') return { ...NONE, reverse: true };
  return NONE;
}

/** The latest declaration the worker made that is not superseded. */
export interface LatestDeclaration {
  answer: boolean;
  source: 'onboarding' | 'in_employment';
  status: DeclarationReviewStatus | 'superseded';
  superseded: boolean;
}

/**
 * Whether the worker may send an updated declaration from the app — the
 * office asked for more details, or rejected their Yes — decided by where
 * they are NOW, whichever source the declaration had (a worker who is
 * already staff may carry a rejected onboarding declaration):
 *
 *   · a candidate at the documents stage;
 *   · a compliant worker — sending it pauses their shifts, as any
 *     declaration from the app does (`updatePausesShifts`);
 *   · a worker locked to Documents (blocked for a document, or for the
 *     review itself), whose block simply stays.
 *
 * Never a manual hold: it has nothing behind it for the worker to do
 * (§10.1 case 2), and in employment that is what a rejection makes. The
 * office can reverse its rejection instead.
 */
export function canUpdateDeclaration(input: {
  status: StaffStatus;
  blockKind: BlockKind;
  latest: LatestDeclaration | null;
}): boolean {
  const { status, blockKind, latest } = input;
  if (!latest || !latest.answer || latest.superseded) return false;
  if (latest.status !== 'details_requested' && latest.status !== 'rejected') return false;
  if (status === 'documents' || status === 'compliant') return true;
  return (
    status === 'blocked' && (blockKind === 'conviction_review' || blockKind === 'auto_document')
  );
}

/** A compliant worker's update pauses their shifts while it is reviewed (§10.7). */
export function updatePausesShifts(status: StaffStatus): boolean {
  return status === 'compliant';
}

/** What each refusal from `update_my_declaration()` means to the worker. */
export const UPDATE_DECLARATION_REASONS: Record<string, string> = {
  not_eligible:
    'Your declaration can’t be updated from the app right now. Please contact the office at: admin@thehospitalitycompany.co.uk',
  details_required: 'Enter the details of the conviction.',
  details_too_long: 'Keep the details under 4,000 characters — the office will contact you.',
  conviction_date_in_future: 'The date of conviction can’t be in the future.',
  unknown_staff: 'We couldn’t find your record. Please contact the office.',
};
