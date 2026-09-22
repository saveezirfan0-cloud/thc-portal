/**
 * The row shapes /clients reads, mirroring `clients_directory_v`
 * (20260922091447_clients_directory.sql).
 */
export interface Client {
  id: string;
  name: string;
  contact_name: string;
  phone: string;
  /** The on-site contact staff see at the venue; pre-fills every event (§3.2). */
  staff_contact_point: string;
  contact_emails: string[];
  /** Whether this client pays for breaks (§3.2). */
  pays_breaks: boolean;
  /** Whether this client is charged for buffer staff who attend (§3.2, RULE-15). */
  pays_buffer: boolean;
  /** Role names on this client's rate card, for the directory's chips. */
  rate_card_roles: string[];
  rate_card_count: number;
  event_count: number;
  /** Null where nothing has been delivered: no margin is not 0% (§9.7). */
  avg_margin_pct: number | null;
}

/** §9.7: every field on the form is mandatory, both policies included. */
export interface ClientDraft {
  name: string;
  contact_name: string;
  phone: string;
  staff_contact_point: string;
  contact_emails: string[];
  pays_breaks: boolean;
  pays_buffer: boolean;
}

export type ActionResult = { ok: true } | { ok: false; message: string };
