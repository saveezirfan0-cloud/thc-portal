/**
 * /settings — the Django-Admin replacement (§6, §2.4, §9.11, §9.12).
 *
 * The scope names four things THC must be able to change "without a
 * release": the §6 scoring weights, the Willo stage map (§2.4), the
 * standard venue-type radii (§9.11) and the sender addresses (§9.12).
 * Three of them live in the key/value `settings` table; the fourth already
 * has a proper home in `venue_types`, which the venue modal pre-fills
 * from, so this screen edits that table rather than shadowing it.
 */

import type { BufferSuggestionRule } from '@thc/domain';

export interface ScoringWeights {
  show_rate: number;
  rating: number;
  proximity: number;
  fair_rotation: number;
  venue_history: number;
}

/**
 * §2.4: the "Review interview on Willo" link, as a template with `{id}`
 * where Willo's candidate id goes (onboarding_candidates_v substitutes it).
 * Null until THC supplies the Willo account; the link is then "not connected".
 */
export type WilloReviewUrlTemplate = string | null;

/**
 * ADR-0149: the interview's public link, carried by the OC1 reminder email.
 * Null = none set, and the email is as it was.
 */
export type WilloInterviewUrl = string | null;

/** §2.4, Appendix B: Willo's own stage names → the kanban's. */
export interface WilloStageMap {
  new_response: string;
  accepted: string;
  rejected: string;
}

/** §9.12: exactly two addresses, and no others are used. */
export interface Senders {
  timesheets: string;
  admin: string;
  /**
   * Where replies go, when not to the sending address (optional). For a
   * sender on a sending-only subdomain, e.g. admin@updates… replying to
   * admin@… (packages/notifications/src/senders.ts).
   */
  timesheets_reply_to?: string;
  admin_reply_to?: string;
}

export interface VenueTypeRadius {
  key: string;
  label: string;
  default_radius_m: number;
  sort_order: number;
}

export interface SettingsData {
  weights: ScoringWeights;
  willo: WilloStageMap;
  willoReviewUrlTemplate: WilloReviewUrlTemplate;
  willoInterviewUrl: WilloInterviewUrl;
  senders: Senders;
  /** ADR-0179: who gets a hidden copy of every timesheet sent to a client (`document_office_copy`). */
  documentOfficeCopy: string[];
  /**
   * §8's fixed recipients for the office/payroll emails, read from the
   * notification register on the server so the screen's note can never
   * drift from what the drain sends. Not a setting.
   */
  recipients: { e5e6: string[]; e7: string[] };
  /** RULE-06's different-venue gap, in minutes (§3.4). */
  bookedElsewhereGapMinutes: number;
  /** §3.4's escalation radius, in miles. */
  escalationRadiusMiles: number;
  venueTypes: VenueTypeRadius[];
  /**
   * Completion letter requirement §4: what the rota does with a Working Time
   * 48 h breach. Never a Student visa limit or a right-to-work expiry, which
   * are always refused (20260923100200_rota_guard.sql).
   */
  rotaGuardMode: RotaGuardMode;
  /**
   * ADR-0181: the suggested buffer the Shift Builder pre-fills
   * (`settings.buffer_suggestion`), defaulted like the builder reads it.
   */
  bufferSuggestion: BufferSuggestionRule;
  /**
   * ADR-0083: the register codes switched off on the Notifications tab
   * (`settings.notification_switches`). Everything else is on.
   */
  notificationsOff: string[];
  /**
   * ADR-0134 N1: THC's on-the-day phone number, shown on every Client
   * Portal event page as a tap-to-call link (`client_portal_phone`). Empty
   * hides it.
   */
  clientPortalPhone: string;
  /**
   * ADR-0164: two-step sign-in compulsory for every Back Office login
   * (`office_two_step_required`), and how long one sign-in lasts
   * (`office_session_max_hours`). The database enforces both.
   */
  officeTwoStepRequired: boolean;
  officeSessionMaxHours: number;
  /**
   * ADR-0176: the `invoicing` row, read as `invoicing_config()` reads it
   * (every value defaulted; off when the row is missing).
   */
  invoicing: InvoicingSettings;
  problem: string | null;
}

/** ADR-0176: THC's own details as printed on every invoice (`settings.invoicing.company`). */
export interface InvoicingCompany {
  name: string;
  company_reg: string;
  vat_reg: string;
  email: string;
  website: string;
}

/** ADR-0176: where the client pays (`settings.invoicing.bank`). */
export interface InvoicingBank {
  account_name: string;
  bank: string;
  account_number: string;
  sort_code: string;
}

/**
 * ADR-0176: `settings.invoicing`, the shape `invoicing_config()` reads
 * (20261022100000_invoices_sent.sql §2). Snapshotted onto each invoice as it
 * is issued, so a change here never alters an invoice already sent.
 */
export interface InvoicingSettings {
  enabled: boolean;
  /** "HH:MM", 24-hour, UK time: sent at this time the morning after a PO's last event. */
  time: string;
  /** "YYYY-MM-DD": go-live. Events dated before it are never invoiced. */
  first_event_date: string;
  po_window_days: number;
  vat_rate: number;
  payment_terms_days: number;
  company: InvoicingCompany;
  bank: InvoicingBank;
  late_payment_note: string;
}

/** The screen's tabs; `?tab=notifications`, `?tab=tickets` and `?tab=xero` open the others. */
export type SettingsTab = 'general' | 'notifications' | 'tickets' | 'xero';

export function parseSettingsTab(value: unknown): SettingsTab {
  return value === 'notifications' || value === 'tickets' || value === 'xero' ? value : 'general';
}

export type RotaGuardMode = 'block' | 'warn';

export type ActionResult = { ok: true } | { ok: false; message: string };

/** The kanban stages a Willo outcome may map onto (§2.2, §2.4). */
export const KANBAN_STAGES = [
  'interview_requested',
  'interview_completed',
  'documents',
  'rejected',
] as const;
