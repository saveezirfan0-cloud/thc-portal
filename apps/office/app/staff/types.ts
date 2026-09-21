/**
 * The row shapes /staff reads, mirroring `staff_directory_v` and
 * `student_visa_v` (20260921170000_staff_directory.sql).
 *
 * `display_name` is the only name any caller prints: the view applies
 * §1.7's anonymisation, so a removed worker reads as "Deleted account #id"
 * whatever the underlying row still holds.
 */
export type StaffStatus =
  | 'interview_requested'
  | 'interview_completed'
  | 'documents'
  | 'quiz'
  | 'additional_info'
  | 'contract'
  | 'compliant'
  | 'blocked'
  | 'inactive'
  | 'rejected'
  | 'removed';

export type BlockKind = 'auto_document' | 'manual' | 'conviction_review' | null;

/** RULE-20's bands (0008_weekly_cap.sql). */
export type CapBand =
  'student_term_20' | 'student_holiday_48' | 'graduated_48' | 'standard_48' | 'opted_out_none';

export interface StaffRow {
  id: string;
  employee_id: number | null;
  status: StaffStatus;
  removed: boolean;
  display_name: string;
  photo_path: string | null;
  rating: number | null;
  /** Show-rate, as a percentage. */
  reliability: number | null;
  block_kind: BlockKind;
  block_reason: string | null;
  rtw_branch: string | null;
  right_to_work_until: string | null;
  graduated_at: string | null;
  wtr_optout: boolean;
  left_at: string | null;
  leave_reason: string | null;
  role_names: string[];
  unresolved_violations: number;
  do_not_return_clients: string[];
  /** Null means no ceiling — the 48h opt-out with no visa limit (RULE-20). */
  weekly_cap_hours: number | null;
  weekly_cap_band: CapBand | null;
  weekly_booked_hours: number | null;
}

export interface StudentRow {
  id: string;
  display_name: string;
  employee_id: number | null;
  photo_path: string | null;
  status: StaffStatus;
  weekly_cap_hours: number | null;
  weekly_cap_band: CapBand | null;
  weekly_booked_hours: number | null;
  right_to_work_until: string | null;
  graduated_at: string | null;
  wtr_optout: boolean;
  term_letter_verified_at: string | null;
  term_letter_expires_at: string | null;
  completion_letter_verified_at: string | null;
  completion_letter_in_review: boolean;
}
