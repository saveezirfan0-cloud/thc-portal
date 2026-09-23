/**
 * The row shapes /staff/:id reads, mirroring the views in
 * 20260922094500_staff_profile.sql.
 *
 * Every personal column here is nullable for one reason: §1.7's removal
 * masks them in the view, so a removed worker's profile is a real page
 * with real history and no personal data on it. The screen renders the
 * nulls as "—" rather than hiding the blocks, because §1.7 keeps the
 * record openable.
 */
import type { CapBand, StaffRow } from '../types';
import type { FeedbackEntry } from '../../feedback/types';

export type ReviewStatus = 'pending' | 'verified' | 'rejected' | 'superseded';
export type ViolationType = 'no_show' | 'late' | 'left_early' | 'left_geofence' | 'no_checkout';

export interface ProfileRow extends StaffRow {
  email: string | null;
  phone: string | null;
  dob: string | null;
  home_address: string | null;
  share_code: string | null;
  ni_number_masked: string | null;
  has_ni_number: boolean;
  term_dates: string[] | null;
  /** The Sunday the current cap band holds until (§4.4). Students only. */
  weekly_cap_until: string | null;
  contract_signed_at: string | null;
  contract_version: string | null;
  joined_at: string;
  quiz_attempts: number;
  bank_account_holder: string | null;
  bank_sort_code_masked: string | null;
  bank_account_masked: string | null;
  bank_updated_at: string | null;
  hmrc_statement: 'A' | 'B' | 'C' | null;
  hmrc_student_loan: string | null;
  hmrc_postgraduate_loan: boolean | null;
  hmrc_declared_at: string | null;
  shifts_worked: number;
  no_shows: number;
  feedback_count: number;
  documents_pending: number;
  qualification_count: number;
}

export interface DocumentRow {
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
  right_to_work_until: string | null;
  /** The reviewer confirmed settled status: no date, by design (20260923200000). */
  rtw_no_time_limit: boolean;
  completion_date: string | null;
  awarding_institution: string | null;
}

export interface QualificationRow {
  id: string;
  client_id: string;
  client_name: string;
  role_id: string;
  role_name: string;
  granted_how: 'manual' | 'automatic';
  granted_by_name: string | null;
  granted_from_event: string | null;
  granted_from_event_title: string | null;
  granted_from_event_date: string | null;
  granted_at: string;
  do_not_return: boolean;
  note: string | null;
}

export interface ShiftRow {
  booking_id: string;
  booking_status: string;
  cancel_cause: string | null;
  self_cancelled: boolean;
  starts_at: string;
  ends_at: string;
  role_name: string;
  event_id: string;
  event_title: string;
  event_date: string;
  client_name: string;
  venue_name: string;
  check_in_at: string | null;
  check_out_at: string | null;
  kind: 'worked' | 'no_show' | 'turned_away' | null;
  /** RULE-01's verdict, straight from `payable_shifts_v`. */
  pay: { status: string; payableMin: number; floorApplied: boolean } | null;
  violation_count: number;
  unresolved_violation_count: number;
}

export interface ViolationRow {
  id: string;
  booking_id: string;
  type: ViolationType;
  detected_at: string;
  minutes_late: number | null;
  resolved: boolean;
  resolved_at: string | null;
  resolution_note: string | null;
  resolved_by_name: string | null;
  starts_at: string;
  ends_at: string;
  role_name: string;
  event_title: string;
  event_date: string;
  client_name: string;
  venue_name: string;
}

export interface FeedbackRow {
  id: string;
  author_kind: 'client' | 'office';
  author_name: string | null;
  rating: number;
  text: string | null;
  read_at: string | null;
  counts_toward_rating: boolean;
  created_at: string;
  event_title: string;
  event_date: string;
}

export interface ReferenceRow {
  id: string;
  name: string;
  relationship: string;
  phone: string;
  email: string;
}

export interface DeclarationRow {
  id: string;
  source: 'onboarding' | 'in_employment';
  answer: boolean;
  details: string | null;
  conviction_date: string | null;
  review_status: ReviewStatus;
  declared_at: string;
  reviewed_at: string | null;
}

export interface RoleOption {
  id: string;
  name: string;
}

export interface ClientOption {
  id: string;
  name: string;
}

export interface ProfileData {
  profile: ProfileRow | null;
  documents: DocumentRow[];
  qualifications: QualificationRow[];
  shifts: ShiftRow[];
  violations: ViolationRow[];
  /** `feedback_entries_v` — the same rows /feedback reads (§9.10). */
  feedback: FeedbackEntry[];
  references: ReferenceRow[];
  declarations: DeclarationRow[];
  roles: RoleOption[];
  clients: ClientOption[];
  /** The signed-in manager, named as the author of a new office entry (§9.10). */
  managerName: string | null;
  problem: string | null;
}

export type ActionResult = { ok: true } | { ok: false; message: string };

export type { CapBand };
