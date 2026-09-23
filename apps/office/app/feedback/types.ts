/**
 * The row shapes /feedback and the profile's Feedback tab read, mirroring
 * `feedback_entries_v` (20260923140000_feedback_inbox.sql).
 */
export type AuthorKind = 'client' | 'office';

export interface FeedbackEntry {
  id: string;
  author_kind: AuthorKind;
  /** 1–5. */
  rating: number;
  text: string | null;
  created_at: string;
  /** Set when an office entry was edited — the "edited" line. */
  updated_at: string | null;
  read_at: string | null;
  read_by_name: string | null;
  /** A client entry nobody has marked read yet. */
  unread: boolean;
  /** §9.10: office entries always; client entries once read. */
  counts_toward_rating: boolean;
  /** Office entries only (§9.10). */
  editable: boolean;
  /** Office entries, or a client entry about a removed worker (§1.7). */
  deletable: boolean;
  author_id: string | null;
  /** The manager's own name (office), or the portal user's (client). */
  author_name: string | null;
  staff_id: string;
  /** Already anonymised for a removed worker (§1.7). */
  staff_name: string;
  employee_id: number | null;
  staff_removed: boolean;
  staff_removed_at: string | null;
  /** Null only for an office entry "not tied to an event". */
  event_id: string | null;
  event_title: string | null;
  event_date: string | null;
  venue_name: string | null;
  client_id: string | null;
  client_name: string | null;
  role_names: string | null;
}

export type Tab = 'client' | 'office';
export type ReadFilter = 'all' | 'unread' | 'read';

/** Everything /feedback keeps in its URL. */
export interface FeedbackQuery {
  tab: Tab;
  q: string;
  clientId: string;
  status: ReadFilter;
  authorId: string;
  page: number;
}

export interface Option {
  id: string;
  name: string;
}

/** One line of the worker typeahead. */
export interface WorkerOption {
  id: string;
  name: string;
  employee_id: number | null;
  role_names: string[];
  status: string;
}

/** An event the worker was booked on, for the optional event select. */
export interface EventOption {
  id: string;
  title: string;
  date: string;
  client: string | null;
}

export interface OfficeDraft {
  staffId: string;
  rating: number;
  text: string;
  /** '' = not tied to an event. */
  eventId: string;
}

export type ActionResult = { ok: true } | { ok: false; message: string };
