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
  /**
   * ADR-0146: barred at this client without being cleared here
   * (bar_from_client). Absent before 20261015150000 is applied.
   */
  bar_only?: boolean;
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

/** One page of the "+ Add staff" picker's search (`searchQualifyPicker`). */
export type PickerPage =
  { ok: true; workers: StaffOption[]; total: number } | { ok: false; message: string };

/** One role's ask of a worker (ADR-0110): `clients_shift_requirements_v`. */
export interface ShiftRequirementRow {
  id: string;
  client_id: string;
  role_id: string;
  role_name: string;
  quiz_id: string | null;
  quiz_title: string | null;
  quiz_attempts_max: number | null;
  kit_message: string | null;
  /** ADR-0111: live questions in the pool, and how many a sitting is dealt (null: all, in order). */
  quiz_question_pool: number | null;
  quiz_questions_per_attempt: number | null;
}

/** Where one worker stands on a client's quiz (ADR-0110): `clients_quiz_results_v`. */
export interface QuizResultRow {
  quiz_id: string;
  client_id: string;
  quiz_title: string;
  staff_id: string;
  display_name: string;
  employee_id: number | null;
  attempts_used: number;
  attempts_max: number;
  passed: boolean;
  passed_at: string | null;
  last_attempt_at: string | null;
  failed: boolean;
  best_correct: number | null;
  total: number | null;
}

/**
 * One "Request this person again" from the Client Portal (ADR-0135 §2):
 * `clients_worker_requests_v`, read under the admin's own policies.
 */
export interface WorkerRequestRow {
  id: string;
  client_id: string;
  staff_id: string;
  /** The worker's name, or "Deleted account #id" (§1.7). */
  worker_name: string;
  employee_id: number | null;
  worker_removed: boolean;
  event_id: string | null;
  event_title: string | null;
  event_date: string | null;
  role: string | null;
  note: string | null;
  requested_by_name: string | null;
  created_at: string;
  handled_at: string | null;
}

/**
 * ADR-0176: who the client's invoice is addressed to and where it is
 * emailed — `clients.accounts_contact_name`, `invoice_emails` (up to 5;
 * empty sends it to the contact emails) and `billing_address` (printed
 * under "Invoice to"). Set by `set_client_invoice_details()`.
 */
export interface InvoiceDetails {
  accountsContactName: string | null;
  invoiceEmails: string[];
  /** Copied on the invoice email (ADR-0176, THC 21.10.2026). */
  invoiceCcEmails: string[];
  billingAddress: string | null;
}

export interface ClientCardData {
  client: Client | null;
  /** `clients.name_badges` (ADR-0081): badges go with every Allocation Timesheet. */
  nameBadges: boolean;
  /** ADR-0203: THC invoices this client outside the platform. */
  excludeFromInvoicing: boolean;
  /** ADR-0135 §3: CP2 / CP3 to this client's timesheet recipients (both on by default). */
  lineupEmails: { confirmed: boolean; changed: boolean };
  /** ADR-0176: the Invoicing panel. */
  invoicing: InvoiceDetails;
  rateCard: RateCardRow[];
  /** Every dress code stored on any client's rate card, most-used first. */
  dressCodeLibrary: string[];
  qualified: QualifiedStaffRow[];
  /** ADR-0110: per role, the quiz and the kit message; and who has sat the quiz. */
  requirements: ShiftRequirementRow[];
  quizResults: QuizResultRow[];
  /** ADR-0135 §2: "Request again" messages from the Client Portal, open first. */
  workerRequests: WorkerRequestRow[];
  events: ClientEventRow[];
  roles: RoleOption[];
  problem: string | null;
}

export type ActionResult = { ok: true } | { ok: false; message: string };
