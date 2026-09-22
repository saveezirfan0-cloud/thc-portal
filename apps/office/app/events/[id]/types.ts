/**
 * The row shapes /events/:id reads, mirroring the views in
 * 20260922100500_event_board.sql and the `auto_assign_candidates` function
 * that has fed the engine since 20260921141500.
 */
import type { EventStatus, HardGate } from '@thc/domain';

export interface BoardEvent {
  id: string;
  title: string;
  event_date: string;
  client_id: string;
  client_name: string;
  staff_contact_point: string;
  venue_id: string | null;
  venue_name: string;
  venue_address: string;
  geofence_radius_m: number;
  po_number: string | null;
  onsite_contact: string | null;
  notes: string | null;
  auto_assign: boolean;
  /** The EVENT's copies, not the client's live ones (§3.2). */
  pays_breaks: boolean;
  pays_buffer: boolean;
  cancelled_at: string | null;
  cancel_reason: string | null;
  cancelled_by_name: string | null;
  payroll_exported_at: string | null;
  starts_at: string;
  ends_at: string;
  status: EventStatus;
  section_count: number;
}

export interface BoardSection {
  id: string;
  role_id: string;
  role_name: string;
  starts_at: string;
  ends_at: string;
  headcount: number;
  buffer: number;
  charge_rate: number;
  pay_rate: number;
  final_pay_rate: number;
  dress_code: string | null;
  auto_assign: boolean;
  allocation_per_hour: number;
  /** Confirmed, worked and closed — never invited (§3.2, §3.3). */
  confirmed: number;
  invited: number;
  applied: number;
  /** headcount − confirmed. Never headcount + buffer (the buffer is not a seat). */
  open_slots: number;
  no_shows: number;
}

export interface RosterRow {
  booking_id: string;
  shift_id: string;
  role_id: string;
  role_name: string;
  staff_id: string;
  display_name: string;
  employee_id: number | null;
  photo_path: string | null;
  rating: number | null;
  reliability: number | null;
  status: string;
  source: 'auto' | 'manual' | 'self' | 'escalation';
  invited_at: string;
  confirmed_at: string | null;
  day_before_confirmed_at: string | null;
  on_day_confirmed_at: string | null;
  reconfirm_required: boolean;
  reconfirm_reason: string | null;
  applied_at: string | null;
  self_cancelled: boolean;
  cancel_cause: string | null;
  qualified_here: boolean;
  /** Present while a no-show stands. Get back is resolve_violation() on it. */
  no_show_violation: string | null;
  no_show: boolean;
  payroll_exported_at: string | null;
}

/** One row of `auto_assign_candidates(shift)`. */
export interface CandidateRow {
  staff_id: string;
  gate: HardGate | null;
  qualified: boolean;
  booking_status: string | null;
  reliability: number;
  rating: number;
  distance_km: number;
  future_shifts: number;
  venue_times: number;
}

export interface PoolPerson {
  staff_id: string;
  display_name: string;
  employee_id: number | null;
  rating: number | null;
  reliability: number | null;
}

export interface BoardData {
  event: BoardEvent | null;
  sections: BoardSection[];
  roster: RosterRow[];
  /** Keyed by section id. */
  candidates: Record<string, CandidateRow[]>;
  people: Record<string, PoolPerson>;
  problem: string | null;
}

export type ActionResult = { ok: true; message?: string } | { ok: false; message: string };
