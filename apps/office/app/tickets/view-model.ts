/**
 * Tickets (ADR-0202) — the words, the tones and the address of the list.
 * Pure, so `__tests__/view-model.test.ts` pins it without a browser or a
 * database. The database holds the same sets (tickets_kind_check and
 * friends, create_ticket / update_ticket).
 */

import type { Tone } from '@thc/ui';

export const KINDS = ['bug', 'request', 'idea', 'update', 'question'] as const;
export type TicketKind = (typeof KINDS)[number];

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type TicketSeverity = (typeof SEVERITIES)[number];

export const STATUSES = ['new', 'in_progress', 'waiting', 'resolved', 'closed'] as const;
export type TicketStatus = (typeof STATUSES)[number];

export const KIND_LABEL: Readonly<Record<TicketKind, string>> = {
  bug: 'Bug — something is broken',
  request: 'Request — I need something',
  idea: 'Idea — it could be better',
  update: 'Update — something to tell you',
  question: 'Question',
};

/** The short word on a list row and in a filter. */
export const KIND_SHORT: Readonly<Record<TicketKind, string>> = {
  bug: 'Bug',
  request: 'Request',
  idea: 'Idea',
  update: 'Update',
  question: 'Question',
};

export const KIND_TONE: Readonly<Record<TicketKind, Tone>> = {
  bug: 'coral',
  request: 'cyan',
  idea: 'green',
  update: 'purple',
  question: 'amber',
};

export const SEVERITY_LABEL: Readonly<Record<TicketSeverity, string>> = {
  low: 'Low — a nuisance',
  medium: 'Medium — slows me down',
  high: 'High — I cannot do my job properly',
  critical: 'Critical — nobody can work',
};

export const SEVERITY_SHORT: Readonly<Record<TicketSeverity, string>> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

export const SEVERITY_TONE: Readonly<Record<TicketSeverity, Tone>> = {
  low: 'neutral',
  medium: 'amber',
  high: 'coral',
  critical: 'coral',
};

export const STATUS_LABEL: Readonly<Record<TicketStatus, string>> = {
  new: 'New',
  in_progress: 'In progress',
  waiting: 'Waiting',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const STATUS_TONE: Readonly<Record<TicketStatus, Tone>> = {
  new: 'cyan',
  in_progress: 'purple',
  waiting: 'amber',
  resolved: 'green',
  closed: 'neutral',
};

/** Field caps, equal to the database's. */
export const TITLE_MIN = 3;
export const TITLE_MAX = 200;
export const DETAILS_MAX = 5000;
export const COMMENT_MAX = 5000;
export const RESOLUTION_MAX = 2000;
export const LINK_MAX = 500;

/** "TK-12" — the id the team quotes. */
export function ticketRef(no: number): string {
  return `TK-${no}`;
}

/** Open = still being worked; the list's default tab. */
export function isOpen(status: TicketStatus): boolean {
  return status !== 'resolved' && status !== 'closed';
}

export function isKind(value: unknown): value is TicketKind {
  return typeof value === 'string' && (KINDS as readonly string[]).includes(value);
}
export function isSeverity(value: unknown): value is TicketSeverity {
  return typeof value === 'string' && (SEVERITIES as readonly string[]).includes(value);
}
export function isStatus(value: unknown): value is TicketStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

export interface TicketDraft {
  kind: string;
  severity: string;
  title: string;
  details: string;
  link: string;
}

/** The first thing wrong with a report, in the reporter's words; null when it can be sent. */
export function validateDraft(draft: TicketDraft): string | null {
  if (!isKind(draft.kind)) return 'Choose what kind of report this is.';
  if (draft.severity !== '' && !isSeverity(draft.severity)) {
    return 'Choose how bad it is, or leave it blank.';
  }
  const title = draft.title.trim();
  if (title.length < TITLE_MIN) return 'A one-line summary is required.';
  if (title.length > TITLE_MAX) return `The summary is at most ${TITLE_MAX} characters.`;
  if (draft.details.trim().length > DETAILS_MAX) {
    return `The details are at most ${DETAILS_MAX.toLocaleString('en-GB')} characters.`;
  }
  const link = draft.link.trim();
  if (link !== '' && (link.length > LINK_MAX || !/^https?:\/\/\S+$/i.test(link))) {
    return 'The recording link must start with https:// and have no spaces.';
  }
  return null;
}

export type TabId = 'open' | 'closed' | 'all';

export interface TicketQuery {
  tab: TabId;
  q: string;
  kind: TicketKind | null;
  severity: TicketSeverity | null;
  status: TicketStatus | null;
  /** The owner's own filter (ADR-0202): a label, or `none` for not yet labelled. Ignored for anyone else. */
  scope: ScopeLabel | 'none' | null;
  page: number;
}

export const PAGE_SIZE = 50;

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

/** The address's filters, with anything unrecognised dropped rather than trusted. */
export function parseQuery(params: Record<string, string | string[] | undefined>): TicketQuery {
  const tab = one(params['tab']);
  const kind = one(params['kind']);
  const severity = one(params['severity']);
  const status = one(params['status']);
  const scope = one(params['scope']);
  const page = Number(one(params['page']));
  return {
    tab: tab === 'closed' || tab === 'all' ? tab : 'open',
    q: one(params['q']).trim().slice(0, 100),
    kind: isKind(kind) ? kind : null,
    severity: isSeverity(severity) ? severity : null,
    status: isStatus(status) ? status : null,
    scope: scope === 'none' || isScopeLabel(scope) ? scope : null,
    page: Number.isSafeInteger(page) && page > 1 ? page : 1,
  };
}

/** The list's address for a query, leaving a default out. */
export function ticketsHref(query: Partial<TicketQuery>): string {
  const params = new URLSearchParams();
  if (query.tab && query.tab !== 'open') params.set('tab', query.tab);
  if (query.q) params.set('q', query.q);
  if (query.kind) params.set('kind', query.kind);
  if (query.severity) params.set('severity', query.severity);
  if (query.status) params.set('status', query.status);
  if (query.scope) params.set('scope', query.scope);
  if (query.page && query.page > 1) params.set('page', String(query.page));
  const text = params.toString();
  return text ? `/tickets?${text}` : '/tickets';
}

/**
 * A search box's text as an ilike pattern, `%`, `_` and `\` escaped and the
 * commas and parentheses PostgREST's `or()` grammar reads as syntax removed.
 */
export function ilikePattern(text: string): string {
  const safe = text.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/[(),]/g, ' ');
  return `%${safe.trim()}%`;
}

/** A search for "tk-12" or "12" is a ticket number. */
export function ticketNumberOf(text: string): number | null {
  const match = /^(?:tk-?)?(\d{1,9})$/i.exec(text.trim());
  return match ? Number(match[1]) : null;
}

// ──────────────────────────────────────────────────────────────────────
// The owner's internal tracking (ADR-0202): the scope label and the time.
// Hidden from everyone else by the database (ticket_tracker_allowed()).
// ──────────────────────────────────────────────────────────────────────

/** Against the original scope. Set after a ticket is raised, never by the reporter. */
export const SCOPE_LABELS = ['fix', 'update', 'issue', 'against_scope', 'addition'] as const;
export type ScopeLabel = (typeof SCOPE_LABELS)[number];

export const SCOPE_SHORT: Readonly<Record<ScopeLabel, string>> = {
  fix: 'Fix',
  update: 'Update',
  issue: 'Issue',
  against_scope: 'Against scope',
  addition: 'Addition',
};

export const SCOPE_HELP: Readonly<Record<ScopeLabel, string>> = {
  fix: 'in scope: delivered but not working as specified',
  update: 'in scope: a change to something already covered',
  issue: 'in scope: a problem raised, to be looked into',
  against_scope: 'contradicts what was agreed',
  addition: 'never in the original scope',
};

export const SCOPE_TONE: Readonly<Record<ScopeLabel, Tone>> = {
  fix: 'green',
  update: 'cyan',
  issue: 'neutral',
  against_scope: 'coral',
  addition: 'purple',
};

export function isScopeLabel(value: unknown): value is ScopeLabel {
  return typeof value === 'string' && (SCOPE_LABELS as readonly string[]).includes(value);
}

/** Outside what was agreed: the two labels that default to billable. */
export function isOutsideScope(label: ScopeLabel | null | undefined): boolean {
  return label === 'against_scope' || label === 'addition';
}

export const WORKERS = ['owner', 'claude'] as const;
export type Worker = (typeof WORKERS)[number];
export const WORKER_LABEL: Readonly<Record<Worker, string>> = { owner: 'Me', claude: 'Claude' };
export function isWorker(value: unknown): value is Worker {
  return typeof value === 'string' && (WORKERS as readonly string[]).includes(value);
}

export const NOTE_MAX = 500;
export const MAX_MINUTES = 1440;

/**
 * "90", "90m", "1h", "1h 30m", "1h30", "1.5h", "1:30" → minutes; null when it
 * is not a duration or falls outside 1 minute … 24 hours. A bare number is
 * minutes: that is what someone types after "I spent 15".
 */
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!t) return null;
  let minutes: number | null = null;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{1,2}):(\d{2})$/.exec(t))) {
    minutes = Number(m[1]) * 60 + Number(m[2]);
  } else if ((m = /^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)$/.exec(t))) {
    minutes = Math.round(Number(m[1]) * 60);
  } else if (
    (m =
      /^(?:(\d+)\s*(?:h|hr|hrs|hour|hours)\s*)?(?:(\d+)\s*(?:m|min|mins|minute|minutes)?)?$/.exec(
        t,
      ))
  ) {
    const hours = m[1] === undefined ? 0 : Number(m[1]);
    const mins = m[2] === undefined ? 0 : Number(m[2]);
    if (m[1] === undefined && m[2] === undefined) return null;
    minutes = hours * 60 + mins;
  } else if ((m = /^(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)$/.exec(t))) {
    minutes = Math.round(Number(m[1]));
  }
  if (minutes === null || !Number.isFinite(minutes) || minutes < 1 || minutes > MAX_MINUTES) {
    return null;
  }
  return minutes;
}

/** 5 → "5m", 65 → "1h 05m", 120 → "2h". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, '0')}m`;
}

/** Hours to two places, for a bill: 90 → "1.50". */
export function formatHours(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

/** 3725 seconds → "01:02:05", for the running timer. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/** "2026-10" for a date, in UK time — the month a piece of work is billed in. */
export function monthOf(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  return `${year}-${month}`;
}

/** "?month=" → a valid "YYYY-MM"; anything else is the current month. */
export function parseMonth(value: string | string[] | undefined, now: Date = new Date()): string {
  const text = (Array.isArray(value) ? value[0] : value) ?? '';
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(text);
  return match && Number(match[1]) >= 2020 && Number(match[1]) <= 2100 ? text : monthOf(now);
}

/** The first day of the month and of the next, as dates (the range is [from, to)). */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return { from: `${month}-01`, to: `${next}-01` };
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export interface TimeRow {
  ticketNo: number;
  title: string;
  label: ScopeLabel | null;
  workedBy: Worker;
  workedOn: string;
  minutes: number;
  billable: boolean;
  note: string | null;
}

export interface TimeSummary {
  minutes: number;
  billableMinutes: number;
  byLabel: Record<ScopeLabel | 'unlabelled', { minutes: number; billableMinutes: number }>;
  byWorker: Record<Worker, number>;
  /** One line per ticket, most time first. */
  tickets: {
    ticketNo: number;
    title: string;
    label: ScopeLabel | null;
    minutes: number;
    billableMinutes: number;
  }[];
}

/** Totals for a month's time rows: overall, by label, by who worked, by ticket. */
export function summariseTime(rows: readonly TimeRow[]): TimeSummary {
  const byLabel = Object.fromEntries(
    [...SCOPE_LABELS, 'unlabelled'].map((k) => [k, { minutes: 0, billableMinutes: 0 }]),
  ) as TimeSummary['byLabel'];
  const byWorker: Record<Worker, number> = { owner: 0, claude: 0 };
  const byTicket = new Map<number, TimeSummary['tickets'][number]>();
  let minutes = 0;
  let billableMinutes = 0;
  for (const row of rows) {
    const key = row.label ?? 'unlabelled';
    minutes += row.minutes;
    byLabel[key].minutes += row.minutes;
    byWorker[row.workedBy] += row.minutes;
    if (row.billable) {
      billableMinutes += row.minutes;
      byLabel[key].billableMinutes += row.minutes;
    }
    const line = byTicket.get(row.ticketNo) ?? {
      ticketNo: row.ticketNo,
      title: row.title,
      label: row.label,
      minutes: 0,
      billableMinutes: 0,
    };
    line.minutes += row.minutes;
    if (row.billable) line.billableMinutes += row.minutes;
    byTicket.set(row.ticketNo, line);
  }
  return {
    minutes,
    billableMinutes,
    byLabel,
    byWorker,
    tickets: [...byTicket.values()].sort(
      (a, b) => b.minutes - a.minutes || a.ticketNo - b.ticketNo,
    ),
  };
}

function csvCell(value: string | number): string {
  const text = String(value);
  // A cell that starts like a formula is read by Excel as one.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The month's time as CSV, one row per entry, for the invoice. */
export function timeCsv(rows: readonly TimeRow[]): string {
  const head = [
    'Date',
    'Ticket',
    'Title',
    'Scope label',
    'Worked by',
    'Minutes',
    'Hours',
    'Billable',
    'Note',
  ];
  const lines = rows.map((r) =>
    [
      r.workedOn,
      ticketRef(r.ticketNo),
      r.title,
      r.label ? SCOPE_SHORT[r.label] : 'Not labelled',
      WORKER_LABEL[r.workedBy],
      r.minutes,
      formatHours(r.minutes),
      r.billable ? 'Yes' : 'No',
      r.note ?? '',
    ]
      .map(csvCell)
      .join(','),
  );
  return [head.join(','), ...lines].join('\r\n') + '\r\n';
}

/** What sort of update a comment is. */
export const ACTIVITIES = ['note', 'email', 'call', 'meeting', 'task'] as const;
export type Activity = (typeof ACTIVITIES)[number];
export const ACTIVITY_LABEL: Readonly<Record<Activity, string>> = {
  note: 'Note',
  email: 'Email',
  call: 'Call',
  meeting: 'Meeting',
  task: 'Task',
};
export function isActivity(value: unknown): value is Activity {
  return typeof value === 'string' && (ACTIVITIES as readonly string[]).includes(value);
}
