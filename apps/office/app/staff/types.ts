/**
 * The row shapes /staff reads, mirroring `staff_directory_v` and
 * `student_visa_v` (20260922091732_staff_directory.sql).
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
  | 'student_term_20'
  | 'student_holiday_48'
  | 'graduated_48'
  | 'standard_48'
  | 'opted_out_none'
  // What the cap_band enum actually carries for no ceiling (0008), and the
  // two bands the completion letter requirement added (20260922093000).
  | 'uncapped'
  | 'student_term_10'
  | 'visa_expired_0'
  // A work or dependant visa's own weekly hours limit (20260930130000, D36).
  | 'visa_limit';

export interface StaffRow {
  id: string;
  employee_id: number | null;
  status: StaffStatus;
  removed: boolean;
  display_name: string;
  photo_path: string | null;
  /** Short-lived signed URL for the selfie, set on the server (_lib/photos.ts). */
  photo_url?: string | null;
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
  // Appended by 20260928110000 (the 26.09 deferrals).
  /** The Sunday the current cap band holds until; null when nothing on the calendar ends it (§4.4). */
  weekly_cap_until: string | null;
  /** The end of the last WORKED shift (§10.6, E8's lastShiftDate). */
  last_shift_at: string | null;
  /** Confirmed shifts the system released from the worker: cutoff, block, leaving, GDPR. */
  released_shift_count: number;
  /** When the P45 was asked for — left_at while the row is inactive (§10.6). */
  p45_requested_at: string | null;
}

export interface StudentRow {
  id: string;
  display_name: string;
  employee_id: number | null;
  photo_path: string | null;
  /** Short-lived signed URL for the selfie, set on the server (_lib/photos.ts). */
  photo_url?: string | null;
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
  // Completion letter requirement §4 reporting (20260923100100).
  below_degree_level: boolean;
  course_completion_date: string | null;
  completion_letter_status: 'pending' | 'verified' | 'rejected' | null;
  completion_letter_rejection: string | null;
  completion_date_claimed: string | null;
  completion_effective_from: string | null;
  wtr_optout_cancelled_from: string | null;
  optout_eligible: boolean;
  rtw_days_left: number | null;
}
