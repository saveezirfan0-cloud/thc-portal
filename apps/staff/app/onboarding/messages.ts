/**
 * The sentences a worker sees for each refusal the step RPCs raise
 * (migrations 20260923120000/100/200). The database decides; this names it.
 *
 * Anything unmapped falls through to a generic line rather than the raw
 * code — these are candidates on a phone, not managers reading a log.
 */
const REASONS: Record<string, string> = {
  unknown_staff: 'We couldn’t find your record. Please contact the office.',
  wrong_stage: 'This step isn’t open for you right now.',
  previous_step: 'Please finish the previous step first.',
  documents_submitted: 'Your documents are already with the office, so this can’t be changed now.',
  bad_branch: 'Choose which describes you.',
  dob_required: 'Your date of birth is required.',
  under_18: 'You must be 18 or over to work with us.',
  doc_choice_required: 'Choose which documents you will provide.',
  bad_share_code:
    "Share code must be 9 letters and numbers starting with W — e.g. W123AB4CD. Spaces are fine, we'll remove them.",
  visa_type_required: 'Choose your visa type.',
  expiry_required: 'The expiry date is required.',
  expiry_past: 'That expiry date has already passed.',
  address_required: 'Enter the first line of your address and your town.',
  bad_postcode: 'Enter a UK postcode, e.g. E2 0RY.',
  pin_outside_uk: 'Drop the pin on your home in the UK.',
  photo_required: 'Take a photo to continue.',
  photo_locked: 'Your photo is already set. To change it, contact the office.',
  wrong_path: 'That upload didn’t go through. Please try again.',
  doc_not_for_branch: 'That document isn’t one we need for your right to work.',
  file_empty: 'That file is empty.',
  file_too_large: 'That file is over 10 MB. Try a smaller photo or scan.',
  file_type: 'We take PDF, JPG, PNG or HEIC files only.',
  already_verified: 'This document is already verified.',
  // Re-entering a share code after the gov.uk check (ADR-0025).
  documents_not_submitted: 'Change your share code on step 1 before you submit.',
  no_share_code_branch: 'Your right-to-work option has no share code.',
  already_pending: 'Your share code is already being checked.',
  too_many_attempts:
    'You’ve entered a share code several times today. Please try again tomorrow, or contact the office.',
  not_rejected: 'Only a rejected document can be replaced now.',
  already_submitted: 'Your documents are already with the office.',
  missing_document: 'Upload every document on the list first.',
  declaration_required: 'Answer the criminal conviction question.',
  details_required: 'Tell us the offence, the date and the outcome.',
  bad_conviction_date: 'The date of conviction can’t be in the future.',
  induction_first: 'Finish the Health & Safety induction first.',
  no_attempts_left: 'You have no attempts left.',
  quiz_incomplete: 'Answer every question before you submit.',
  // The quiz was replaced between loading and submitting (20260930140000):
  // the screen reloads the current questions (QuizStep).
  quiz_changed: 'The quiz has been updated — here are the current questions.',
  bad_answer: 'One of the answers wasn’t recognised. Please try again.',
  quiz_not_configured: 'The quiz isn’t available yet. Please contact the office.',
  answer_required: 'Answer the questions shown.',
  bad_student_loan: 'Choose your student loan.',
  gender_required: 'Choose male or female for your HMRC payroll record.',
  invalid_ni: 'That doesn’t look like a National Insurance number. It should look like AB123456C.',
  ni_locked: 'Your NI number is already on file and locked. Corrections go through the office.',
  two_references_required: 'We need two referees.',
  reference_incomplete: 'Each referee needs a name, relationship, phone and email.',
  bad_reference_email: 'Check the referee’s email address.',
  bad_reference_phone: 'Check the referee’s phone number.',
  reference_is_relative: 'Referees can’t be relatives — try an employer, tutor, teacher or coach.',
  same_referee_twice: 'Your two referees must be two different people.',
  holder_required: 'Please enter the name on the account.',
  bad_sort_code: 'A sort code is six digits, e.g. 40-47-84.',
  bad_account_number: 'An account number is eight digits.',
  agreement_required: 'Tick “I agree” to sign.',
  contract_version_changed:
    'The agreement was updated while you were reading it. Please read the new version.',
  contract_not_configured: 'The agreement isn’t available yet. Please contact the office.',
};

export const NOT_CONFIGURED =
  'This environment has no Supabase project, so nothing can be saved. See docs/04-setup-github-vercel-supabase.md.';

/**
 * The refusal code a database message carries, when it is one of ours — for
 * the screens that do something besides showing the sentence (QuizStep
 * reloads on `quiz_changed`).
 */
export function reasonCode(raw: string | null | undefined): string | null {
  const text = raw ?? '';
  // `missing_document:<key>` carries which one; the screen already names it.
  for (const code of Object.keys(REASONS)) {
    if (text === code || text.startsWith(`${code}:`) || text.includes(`${code}`)) return code;
  }
  return null;
}

export function reasonMessage(raw: string | null | undefined): string {
  const code = reasonCode(raw);
  if (code) return REASONS[code]!;
  return 'Something went wrong. Please try again, or contact the office at admin@thehospitalitycompany.co.uk.';
}
