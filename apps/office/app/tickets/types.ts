import type {
  Activity,
  ScopeLabel,
  TicketKind,
  TicketSeverity,
  TicketStatus,
  Worker,
} from './view-model';

/** A row of `tickets` (20261025110000). */
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
  assignee_id: string | null;
  assignee_name: string | null;
  resolution: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

/** A row of `ticket_comments`. `change` rows are the status / severity lines. */
export interface TicketComment {
  id: number;
  ticket_id: string;
  kind: 'comment' | 'change';
  activity: Activity;
  body: string;
  author_id: string | null;
  author_name: string;
  created_at: string;
}

export type ActionResult = { ok: true; ref?: string } | { ok: false; message: string };

/** A row of `ticket_scope`: the owner's internal label. */
export interface TicketScope {
  ticket_id: string;
  label: ScopeLabel;
  note: string | null;
}

/** A row of `ticket_time`. A running timer has `started_at` and no `ended_at` / `minutes`. */
export interface TimeEntry {
  id: number;
  ticket_id: string;
  worked_by: Worker;
  worked_on: string;
  started_at: string | null;
  ended_at: string | null;
  minutes: number | null;
  billable: boolean;
  note: string | null;
  logged_by: string | null;
}

/** The caller's running timer, with the ticket it is on. */
export interface RunningTimer {
  id: number;
  ticket_id: string;
  ticket_no: number;
  title: string;
  worked_by: Worker;
  started_at: string;
}
