/**
 * The row shape of `office_profile_change_requests()` (20260930203000),
 * ADR-0044. Typed by hand until `gen:types` runs against the live project
 * (docs/19 §8, Phase 2.1).
 *
 * A removed worker's row comes back already anonymised by the function:
 * "Deleted account #id", no current name, photo or evidence path (§1.7).
 */
export type ChangeKind = 'name' | 'photo';
export type ChangeStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

export interface ChangeRequestRow {
  id: string;
  staff_id: string;
  kind: ChangeKind;
  status: ChangeStatus;
  display_name: string;
  employee_id: number | null;
  removed: boolean;
  staff_status: string;
  rtw_branch: string | null;
  right_to_work_until: string | null;
  current_first_name: string | null;
  current_last_name: string | null;
  current_photo_path: string | null;
  proposed_first_name: string | null;
  proposed_last_name: string | null;
  proposed_photo_path: string | null;
  evidence_path: string | null;
  worker_note: string | null;
  /** The profile at the moment of the decision: {firstName, lastName} or {photoPath}. */
  previous_value: { firstName?: string; lastName?: string; photoPath?: string | null } | null;
  created_at: string;
  decided_at: string | null;
  decided_by_name: string | null;
  decision_reason: string | null;
}

/** A row with its two photos signed for the page (`_lib/photos.ts`). */
export interface ChangeRequestView extends ChangeRequestRow {
  current_photo_url: string | null;
  proposed_photo_url: string | null;
}

export type DecisionResult = { ok: true } | { ok: false; message: string };
