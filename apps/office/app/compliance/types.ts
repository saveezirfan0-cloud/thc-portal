/**
 * Row shapes for /compliance, mirroring the views in
 * 20260923100000_compliance_review.sql, 20260923100100_completion_letter.sql
 * and 20260923100200_rota_guard.sql. Every view is security_invoker, so RLS
 * (admin_all on staff / compliance_docs / criminal_declarations, admin_read on
 * audit_log) is what keeps this screen the office's.
 */

export type StaffStatus =
  | 'interview_requested'
  | 'interview_completed'
  | 'documents'
  | 'quiz'
  | 'contract'
  | 'compliant'
  | 'blocked'
  | 'inactive'
  | 'rejected'
  | 'removed';

export type BlockKind = 'auto_document' | 'manual' | 'conviction_review' | null;

/**
 * One item waiting on the office: a pending document, a pending Yes
 * declaration (§4.1), or — kind `rtw_check` — an automated gov.uk check in
 * needs_review whose document has already been rejected (no right to work;
 * ADR-0025), where `item_id` is the check's id.
 */
export interface QueueRow {
  kind: 'document' | 'declaration' | 'rtw_check';
  item_id: string;
  staff_id: string;
  display_name: string;
  employee_id: number | null;
  status: StaffStatus;
  is_candidate: boolean;
  block_kind: BlockKind;
  block_reason: string | null;
  rtw_branch: string | null;
  photo_path: string | null;
  /** doc_type, or `criminal_declaration`. */
  item_type: string;
  item_label: string;
  submitted_at: string;
  file_path: string | null;
  ai_confidence: number | null;
  needs_manual_review: boolean;
  expiry_date: string | null;
  term_dates: string[] | null;
  doc_right_to_work_until: string | null;
  share_code: string | null;
  awarding_institution: string | null;
  is_reupload: boolean;
  previous_rejection: string | null;
  declaration_source: 'onboarding' | 'in_employment' | null;
  declaration_details: string | null;
  conviction_date: string | null;
  staff_right_to_work_until: string | null;
  // Completion letter only (requirement §2.1).
  evidence_form: 'letter' | 'transcript' | 'university_email' | null;
  completion_date_claimed: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  // The latest automated right-to-work check (20260928100000, ADR-0025);
  // null on every row that is not a share code (optional: absent before it).
  rtw_check_id?: string | null;
  rtw_check_status?:
    'queued' | 'running' | 'passed' | 'rejected' | 'needs_review' | 'failed' | null;
  rtw_check_source?: 'provider' | 'govuk' | null;
  rtw_check_outcome?: string | null;
  rtw_check_attempts?: number | null;
  rtw_checked_at?: string | null;
  rtw_check_reason?: string | null;
  rtw_check_until?: string | null;
  rtw_check_no_time_limit?: boolean | null;
  rtw_check_conditions?: string[] | null;
  rtw_check_report_path?: string | null;
  /** Share codes only: whether ADR-0018's hand-typed date is allowed now. */
  rtw_manual_allowed?: boolean | null;
}

export type RadarState = 'expired' | 'expiring' | 'valid';

export interface RadarRow {
  staff_id: string;
  display_name: string;
  employee_id: number | null;
  rtw_branch: string | null;
  status: StaffStatus;
  block_kind: BlockKind;
  photo_path: string | null;
  doc_id: string;
  doc_type: string;
  doc_label: string;
  expires_on: string;
  days_left: number;
  state: RadarState;
  n1_at: string | null;
  n2_at: string | null;
  n3_at: string | null;
  n4_at: string | null;
  replacement_in_review: boolean;
}

/** A Working Time 48 breach let through because the rota guard is in warn mode. */
export interface WarningRow {
  id: number;
  at: string;
  booking_id: string;
  staff_id: string;
  worker: string;
  employee_id: number | null;
  event_title: string | null;
  starts_at: string | null;
  cap_hours: number | null;
  band: string | null;
  booked_hours: number | null;
  shift_hours: number | null;
}

/** One row of the §4 / acceptance criterion 7 export. */
export interface AuditRow {
  id: number;
  at: string;
  record_type: 'completion_letter' | 'wtr_optout';
  event: string;
  document_id: string | null;
  staff_id: string | null;
  employee_id: number | null;
  worker: string | null;
  actor_name: string | null;
  evidence_form: string | null;
  file_path: string | null;
  uploaded_at: string | null;
  completion_date_claimed: string | null;
  completion_date: string | null;
  visa_expiry: string | null;
  reason: string | null;
  notice_days: number | null;
  effective_from: string | null;
  retain_until: string | null;
}

export interface CompliancePageData {
  queue: QueueRow[];
  radar: RadarRow[];
  warnings: WarningRow[];
  rotaGuardMode: 'block' | 'warn';
  /** settings.rtw_check.enabled — the automated gov.uk check (ADR-0025). */
  rtwCheckEnabled: boolean;
  problem: string | null;
}

export type ActionResult = { ok: true; message?: string } | { ok: false; message: string };
