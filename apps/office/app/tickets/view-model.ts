/**
 * Tickets (ADR-0198) — the words, the tones and the address of the list.
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
  const page = Number(one(params['page']));
  return {
    tab: tab === 'closed' || tab === 'all' ? tab : 'open',
    q: one(params['q']).trim().slice(0, 100),
    kind: isKind(kind) ? kind : null,
    severity: isSeverity(severity) ? severity : null,
    status: isStatus(status) ? status : null,
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
