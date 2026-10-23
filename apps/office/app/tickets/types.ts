import type { TicketKind, TicketSeverity, TicketStatus } from './view-model';

/** A row of `tickets` (20261024120000). */
export interface Ticket {
  id: string;
  ticket_no: number;
  kind: TicketKind;
  severity: TicketSeverity | null;
  status: TicketStatus;
  title: string;
  details: string | null;
  page_path: string | null;
  link_url: string | null;
  reporter_id: string | null;
  reporter_name: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

/** A row of `ticket_comments`. `change` rows are the status / severity lines. */
export interface TicketComment {
  id: number;
  ticket_id: string;
  kind: 'comment' | 'change';
  body: string;
  author_id: string | null;
  author_name: string;
  created_at: string;
}

export type ActionResult = { ok: true; ref?: string } | { ok: false; message: string };
