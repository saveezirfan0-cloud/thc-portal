/**
 * Row shapes for /onboarding and /onboarding/:id, mirroring the views in
 * supabase/migrations/20260923110000_onboarding_pipeline.sql.
 *
 * `status` is typed as the database's enum, which is wider than the
 * §2.12 machine in @thc/domain: 0001_init reserved `additional_info` and
 * nothing uses it (ADR-0013). The view-model narrows before it asks the
 * machine anything.
 */
import type { StaffStatus } from '../staff/types';
import type { RtwCheckRow } from '../_lib/rtwCheck';

export type { StaffStatus };

export type ReviewStatus = 'pending' | 'verified' | 'rejected' | 'superseded';
export type RejectionCause = 'willo' | 'manager' | 'quiz_failed';

export interface CandidateRow {
  id: string;
  first_name: string;
  last_name: string;
  display_name: string;
  email: string;
  phone: string;
  dob: string | null;
  age: number | null;
  applied_age_band: string | null;
  photo_path: string | null;
  /** Short-lived signed URL for the selfie, set on the server (_lib/photos.ts). */
  photo_url?: string | null;
  status: StaffStatus;
  stage_entered_at: string;
  onboarding_started_at: string;
  applied_at: string;
  gdpr_consent_at: string | null;
  employee_id: number | null;
  rtw_branch: string | null;
  right_to_work_until: string | null;
  share_code: string | null;
  activated: boolean;
  role_names: string[];
  role_ids: string[];
  willo_linked: boolean;
  willo_review_url: string | null;
  willo_invited_at: string | null;
  willo_answers_done: number | null;
  willo_answers_total: number | null;
  willo_completed_at: string | null;
  willo_decision: 'accepted' | 'rejected' | null;
  willo_decided_at: string | null;
  willo_decided_via: 'willo' | 'office' | null;
  docs_total: number;
  docs_verified: number;
  docs_pending: number;
  docs_rejected: number;
  last_doc_rejected_at: string | null;
  docs_missing: string[] | null;
  quiz_blockers: string[] | null;
  declaration_answer: boolean | null;
  declaration_status: ReviewStatus | null;
  quiz_attempts_used: number;
  quiz_best_score: number | null;
  quiz_passed_at: string | null;
  hmrc_submitted_at: string | null;
  references_count: number;
  bank_saved: boolean;
  ni_entered: boolean;
  contract_signed_at: string | null;
  contract_version: string | null;
  rejected_at: string | null;
  rejected_from: StaffStatus | null;
  rejection_cause: RejectionCause | null;
  rejection_reason: string | null;
  rejected_by_name: string | null;
  // Appended by 20260928110000 (the 26.09 deferrals).
  /** When the login was activated — null until the password is set (§2.7). */
  activated_at: string | null;
  /**
   * When the last of HMRC, references and bank landed (ADR-0013): the
   * derived move to Contract, which nothing else stamps. Null while any
   * of the three is still open.
   */
  additional_info_done_at: string | null;
  /** Every attempt's percentage this period, in attempt order (§2.9). */
  quiz_scores: number[];
}

export interface ReturningRow {
  application_id: string;
  applied_at: string;
  applicant_name: string;
  matched_on: 'email_dob' | 'msisdn_dob' | null;
  staff_id: string;
  existing_name: string;
  employee_id: number | null;
  status: StaffStatus;
  block_kind: string | null;
  block_reason: string | null;
  rating: number | null;
  reliability: number | null;
  shifts_worked: number;
}

export interface RoleOption {
  id: string;
  name: string;
}

export interface BoardData {
  candidates: CandidateRow[];
  returning: ReturningRow[];
  roles: RoleOption[];
  /**
   * Who arrived through a referral link (ADR-0040): a separate, best-effort
   * read of `application_referrals` — `onboarding_candidates_v` is not
   * restated for it (docs/18 §0.6). Absent or empty draws no chip.
   */
  referred?: ReferredOnBoard;
  problem: string | null;
}

/**
 * One `application_referrals` row (20260930100100) with the referrer's
 * `staff` row embedded. Admin-read only; the applicant never sees it.
 */
export interface ReferralRow {
  application_id: string;
  candidate_staff_id: string;
  referrer_staff_id: string;
  recorded_at: string;
  referrer: {
    first_name: string;
    last_name: string;
    employee_id: number | null;
    removed_at: string | null;
  } | null;
}

/** "Referred by {name} ({employeeId})" on /onboarding/:id (ADR-0040). */
export interface CandidateReferral {
  referrerId: string;
  /** "Deleted account #id" once the referrer is removed (§1.7). */
  referrerName: string;
  referrerEmployeeId: number | null;
  recordedAt: string;
}

/** The kanban's "Referred" chip: by candidate, and by returning application. */
export interface ReferredOnBoard {
  candidates: string[];
  applications: string[];
}

/** One row of staff_documents_v (20260922094500), plus term dates. */
export interface CandidateDocument {
  id: string;
  doc_type: string;
  doc_label: string;
  review_status: ReviewStatus;
  superseded: boolean;
  file_path: string | null;
  uploaded_at: string;
  expiry_date: string | null;
  expires_on: string | null;
  ai_confidence: number | null;
  needs_manual_review: boolean;
  rejection_reason: string | null;
  reviewed_at: string | null;
  reviewed_by_name: string | null;
  share_code: string | null;
  gov_report_path: string | null;
  right_to_work_until: string | null;
  /** The reviewer confirmed settled status: no date, by design (20260923200000). */
  rtw_no_time_limit: boolean;
  term_dates: string[] | null;
  completion_date: string | null;
  awarding_institution: string | null;
}

export interface Declaration {
  id: string;
  source: 'onboarding' | 'in_employment';
  answer: boolean;
  details: string | null;
  conviction_date: string | null;
  review_status: ReviewStatus;
  declared_at: string;
  reviewed_at: string | null;
  review_note: string | null;
  superseded: boolean;
}

export interface Reference {
  id: string;
  name: string;
  relationship: string;
  phone: string;
  email: string;
}

export interface QuizAttempt {
  id: string;
  attempt_no: number;
  score: number;
  passed: boolean;
  taken_at: string;
}

export interface HmrcChecklist {
  q1_other_job: boolean;
  q2_pension: boolean | null;
  q3_since_6_april: boolean | null;
  statement: 'A' | 'B' | 'C';
  student_loan: 'none' | 'plan1' | 'plan2' | 'plan4';
  postgraduate_loan: boolean;
  declared: boolean;
  submitted_at: string;
}

/** The columns of staff_profile_v the candidate profile reads. */
export interface CandidateMoney {
  weekly_cap_hours: number | null;
  weekly_cap_band:
    | 'student_term_20'
    | 'student_holiday_48'
    | 'graduated_48'
    | 'standard_48'
    | 'opted_out_none'
    | null;
  weekly_cap_until: string | null;
  term_dates: string[] | null;
  ni_number_masked: string | null;
  bank_account_holder: string | null;
  bank_sort_code_masked: string | null;
  bank_account_masked: string | null;
  bank_updated_at: string | null;
  home_address: string | null;
  wtr_optout: boolean;
}

/** One published §2.11 agreement (contract_versions), as the candidate read it. */
export interface ContractVersion {
  version: string;
  title: string;
  body: string;
  is_placeholder: boolean;
}

export interface Application {
  created_at: string;
  consented_at: string;
  outcome: 'candidate_created' | 'returning_applicant';
  matched_on: string | null;
}

export interface CandidateData {
  candidate: CandidateRow | null;
  profile: CandidateMoney | null;
  documents: CandidateDocument[];
  declarations: Declaration[];
  references: Reference[];
  attempts: QuizAttempt[];
  hmrc: HmrcChecklist | null;
  application: Application | null;
  /** The agreement text by `candidate.contract_version`; null before the contract phase. */
  contract: ContractVersion | null;
  roles: RoleOption[];
  /** The latest automated gov.uk check per share-code document (ADR-0025). */
  rtwChecks?: RtwCheckRow[];
  /** settings.rtw_check.enabled. */
  rtwCheckEnabled?: boolean;
  /** The latest referral that brought this person in (ADR-0040); best-effort. */
  referral?: CandidateReferral | null;
  problem: string | null;
}

export type ActionResult = { ok: true; message?: string } | { ok: false; message: string };
