/**
 * The row shapes /clients/:id reads, mirroring the views in
 * 20260922095200_client_card.sql.
 *
 * The `clients_` prefix on every one of those views is deliberate and is
 * not cosmetic: the singular `client_` prefix belongs to the Client
 * Portal, and 050_client_views.sql forbids a money column on anything
 * carrying it (§11.1, ADR-0004). Everything here is charge rates and
 * margins.
 */
import type { Client } from '../types';

export interface RateCardRow {
  id: string;
  role_id: string;
  role_name: string;
  role_description: string | null;
  /**
   * The money columns are null when the card was read for an office role
   * without finance (ADR-0061): the row then comes from `client_rate_cards`
   * itself — role and dress codes only.
   */
  charge_rate: number | null;
  /** From the §9.8 catalogue, never from the client. */
  base_pay_rate: number | null;
  /** base × 1.1207, through final_rate() (§9.8). */
  final_pay_rate: number | null;
  margin_per_hour: number | null;
  /** Of the charge: the share of what the client pays that THC keeps. */
  margin_pct: number | null;
  dress_codes: string[];
  /** How many built role sections use this role at this client. */
  section_count: number;
}

export interface QualifiedStaffRow {
  staff_id: string;
  display_name: string;
  employee_id: number | null;
  photo_path: string | null;
  /** Short-lived signed URL for the selfie, set on the server (_lib/photos.ts). */
  photo_url?: string | null;
  status: string;
  rating: number | null;
  reliability: number | null;
  role_names: string[];
  role_ids: string[];
  /** The entry ids, in the same order as role_ids. */
  qualification_ids: string[];
  do_not_return: boolean;
  first_granted_at: string;
  last_granted_at: string;
  granted_how: 'manual' | 'automatic';
  granted_by_name: string | null;
  granted_from_event_title: string | null;
  granted_from_event_date: string | null;
  notes: string | null;
}

export interface ClientEventRow {
  id: string;
  title: string;
  po_number: string | null;
  event_date: string;
  starts_at: string;
  ends_at: string;
  venue_name: string;
  cancelled_at: string | null;
  status: 'upcoming' | 'ongoing' | 'completed' | 'cancelled';
  section_count: number;
  roles_summary: string | null;
  /** Null on a cancelled event — never zero (§9.7). */
  margin_gbp: number | null;
  margin_pct: number | null;
}

export interface RoleOption {
  id: string;
  name: string;
  /** From `role_rates_v` (ADR-0061); null when it could not be read. */
  pay_rate: number | null;
}

export interface StaffOption {
  id: string;
  display_name: string;
  employee_id: number | null;
  role_names: string[];
}

export interface ClientCardData {
  client: Client | null;
  rateCard: RateCardRow[];
  qualified: QualifiedStaffRow[];
  events: ClientEventRow[];
  roles: RoleOption[];
  staff: StaffOption[];
  problem: string | null;
}

export type ActionResult = { ok: true } | { ok: false; message: string };
