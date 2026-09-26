import type {
  EventOption,
  FeedbackEntry,
  FeedbackQuery,
  OfficeDraft,
  ReadFilter,
  Tab,
} from './types';

/**
 * Pure helpers for /feedback (§9.10) and the profile's Feedback tab (§9.6).
 *
 * Nothing here decides whether an entry counts toward the rating: that is
 * `feedback_counts()` in the database, and the rows arrive carrying the
 * answer (`counts_toward_rating`). This file turns rows into the words and
 * tones the wireframe prints, and keeps the URL state in one shape.
 */

export const PAGE_SIZE = 20;
export const UK = 'Europe/London';

// ---------------------------------------------------------------------
// Stars
// ---------------------------------------------------------------------

/** "★★★☆☆" — always five glyphs, whatever arrives. */
export function starString(rating: number): string {
  const n = Math.max(0, Math.min(5, Math.round(rating)));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

/**
 * The colour of a row's stars. §9.6's rating bands (0–2.9 red · 3.0–3.9
 * amber · 4.0+ green) applied to a whole-star entry, which is what the
 * wireframe draws: ★★ coral, ★★★ amber, ★★★★ green.
 */
export function starTone(rating: number): 'coral' | 'amber' | 'green' {
  if (rating < 3) return 'coral';
  if (rating < 4) return 'amber';
  return 'green';
}

// ---------------------------------------------------------------------
// Dates — §1.8: these are record stamps, shown in UK time, never dual.
// ---------------------------------------------------------------------

/**
 * Three letters, always. ICU's en-GB short month for September is "Sept"
 * in current Node and browsers and "Sep" in older ones; the wireframe
 * prints "Sep", and a date that changes width with the runtime is a test
 * that passes on one machine only.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parts(at: Date, options: Intl.DateTimeFormatOptions): Record<string, string> {
  const wantsShortMonth = options.month === 'short';
  const out: Record<string, string> = {};
  const formatter = new Intl.DateTimeFormat('en-GB', {
    ...options,
    ...(wantsShortMonth ? { month: 'numeric' } : {}),
    timeZone: UK,
  });
  for (const part of formatter.formatToParts(at)) {
    out[part.type] = part.value;
  }
  if (wantsShortMonth) out.month = MONTHS[Number(out.month) - 1] ?? '';
  return out;
}

/** A `date` column has no instant; midday UTC lands on the same UK day. */
function instant(iso: string): Date {
  return new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
}

function valid(at: Date): boolean {
  return !Number.isNaN(at.getTime());
}

/** "Wed 17 Sep" */
export function ukDay(iso: string): string {
  const at = instant(iso);
  if (!valid(at)) return '—';
  const p = parts(at, { weekday: 'short', day: '2-digit', month: 'short' });
  return `${p.weekday} ${p.day} ${p.month}`;
}

/** "Thu 18 Sep 09:12" */
export function ukDayTime(iso: string): string {
  const at = instant(iso);
  if (!valid(at)) return '—';
  const p = parts(at, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return `${p.weekday} ${p.day} ${p.month} ${p.hour}:${p.minute}`;
}

/** "17 Sep 2026 · 23:50" */
export function ukStamp(iso: string): string {
  const at = instant(iso);
  if (!valid(at)) return '—';
  const p = parts(at, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return `${p.day} ${p.month} ${p.year} · ${p.hour}:${p.minute}`;
}

/** "07 Sep" */
export function ukShort(iso: string): string {
  const at = instant(iso);
  if (!valid(at)) return '—';
  const p = parts(at, { day: '2-digit', month: 'short' });
  return `${p.day} ${p.month}`;
}

/** "17.09.2026" — the profile feed's date, as the rest of §9.6 prints dates. */
export function ukNumericDate(iso: string): string {
  const at = instant(iso);
  if (!valid(at)) return '—';
  const p = parts(at, { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${p.day}.${p.month}.${p.year}`;
}

// ---------------------------------------------------------------------
// Row copy
// ---------------------------------------------------------------------

/**
 * The worker line under the name: "Press Night · Mandarin Oriental · Wed
 * 17 Sep · Waiting Staff". The role is printed on the client tab only,
 * as the wireframe does. An office entry with no event says so.
 */
export function eventLine(entry: FeedbackEntry, withRole: boolean): string {
  if (!entry.event_id) return 'Not tied to an event';
  const bits = [entry.event_title, entry.client_name, entry.event_date && ukDay(entry.event_date)];
  if (withRole && entry.role_names) bits.push(entry.role_names);
  return bits.filter(Boolean).join(' · ');
}

/**
 * The meta line under a client comment: "from Sophie L. (client) ·
 * submitted Thu 18 Sep 09:12", plus §1.7's note when the worker has since
 * been removed and the comment is kept verbatim.
 */
export function clientMetaLine(entry: FeedbackEntry): string {
  const who = entry.author_name ?? entry.client_name ?? 'the client';
  const bits = [`from ${who} (client)`, `submitted ${ukDayTime(entry.created_at)}`];
  if (entry.staff_removed && entry.staff_removed_at) {
    bits.push(`worker GDPR-removed ${ukShort(entry.staff_removed_at)} — comment retained verbatim`);
  }
  return bits.join(' · ');
}

/** The meta line under an office comment: "17 Sep 2026 · 23:50 · edited 19 Sep". */
export function officeMetaLine(entry: FeedbackEntry): string {
  const base = ukStamp(entry.created_at);
  return entry.updated_at ? `${base} · edited ${ukShort(entry.updated_at)}` : base;
}

export interface StatusPill {
  tone: 'amber' | 'green';
  label: string;
}

/**
 * The client tab's status pill: "Unread — not in rating" until someone
 * presses Mark as read, then "Read · Gisela M. · 07 Sep".
 */
export function clientStatus(entry: FeedbackEntry): StatusPill {
  if (!entry.read_at) return { tone: 'amber', label: 'Unread — not in rating' };
  const who = entry.read_by_name ? ` · ${entry.read_by_name}` : '';
  return { tone: 'green', label: `Read${who} · ${ukShort(entry.read_at)}` };
}

/** The comment in the wireframe's quotation marks, or nothing. */
export function quoted(text: string | null): string | null {
  const t = text?.trim();
  return t ? `“${t}”` : null;
}

// ---------------------------------------------------------------------
// The URL
// ---------------------------------------------------------------------

type Params = Record<string, string | string[] | undefined>;

function single(params: Params, key: string): string {
  const value = params[key];
  return ((Array.isArray(value) ? value[0] : value) ?? '').trim();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Normalise whatever is in the address bar. Anything unrecognised falls
 * back to the default rather than erroring: a mistyped link should still
 * open the inbox.
 */
export function parseQuery(params: Params): FeedbackQuery {
  const tab: Tab = single(params, 'tab') === 'office' ? 'office' : 'client';
  const statusRaw = single(params, 'status');
  const status: ReadFilter = statusRaw === 'unread' || statusRaw === 'read' ? statusRaw : 'all';
  const page = Number.parseInt(single(params, 'page'), 10);
  const clientId = single(params, 'client');
  const authorId = single(params, 'author');
  return {
    tab,
    q: single(params, 'q').slice(0, 80),
    clientId: UUID.test(clientId) ? clientId : '',
    status,
    authorId: UUID.test(authorId) ? authorId : '',
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/**
 * The link for a changed query. Any change other than the page itself
 * starts again at page 1 — a new search on page 7 of the old one would
 * otherwise land on an empty page. Filters belonging to the other tab are
 * dropped when the tab changes.
 */
export function hrefFor(query: FeedbackQuery, patch: Partial<FeedbackQuery> = {}): string {
  const next: FeedbackQuery = { ...query, ...patch };
  if (patch.page === undefined) next.page = 1;
  if (patch.tab && patch.tab !== query.tab) {
    next.clientId = '';
    next.status = 'all';
    next.authorId = '';
  }
  const params = new URLSearchParams();
  if (next.tab === 'office') params.set('tab', 'office');
  if (next.q) params.set('q', next.q);
  if (next.tab === 'client') {
    if (next.clientId) params.set('client', next.clientId);
    if (next.status !== 'all') params.set('status', next.status);
  } else if (next.authorId) {
    params.set('author', next.authorId);
  }
  if (next.page > 1) params.set('page', String(next.page));
  const qs = params.toString();
  return qs ? `/feedback?${qs}` : '/feedback';
}

/** PostgREST's ilike pattern for a staff-name search, with its wildcards escaped. */
export function ilikePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export interface PageInfo {
  page: number;
  pages: number;
  from: number;
  to: number;
  label: string;
}

/** "Showing 1–20 of 312" and "1 / 16". */
export function pageInfo(page: number, total: number, size = PAGE_SIZE): PageInfo {
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, page), pages);
  const from = total === 0 ? 0 : (current - 1) * size + 1;
  const to = Math.min(total, current * size);
  const label = total === 0 ? 'Nothing to show' : `Showing ${from}–${to} of ${total}`;
  return { page: current, pages, from, to, label };
}

// ---------------------------------------------------------------------
// The office form
// ---------------------------------------------------------------------

/**
 * The same three checks `add_office_feedback()` makes, so the manager is
 * told before the round trip. The database is still the rule.
 */
export function validateDraft(draft: OfficeDraft): string | null {
  if (!draft.staffId) return 'Choose the worker this is about.';
  if (!Number.isInteger(draft.rating) || draft.rating < 1 || draft.rating > 5) {
    return 'Choose between 1 and 5 stars.';
  }
  if (draft.text.trim() === '') return 'Add a comment.';
  return null;
}

/** "Press Night · Mandarin Oriental · 17 Sep" for the event select. */
export function eventOptionLabel(event: EventOption): string {
  return [event.title, event.client, ukShort(event.date)].filter(Boolean).join(' · ');
}

/**
 * The worker's events for the select, newest first and once each — a
 * worker with two role sections at one event was booked twice on it.
 */
export function uniqueEvents(events: EventOption[]): EventOption[] {
  const seen = new Set<string>();
  const out: EventOption[] = [];
  for (const event of [...events].sort((a, b) => b.date.localeCompare(a.date))) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    out.push(event);
  }
  return out;
}

/** "THC-00811 · Bar Staff" beside a typeahead name. */
export function workerSubline(worker: {
  employee_id: number | null;
  role_names: string[];
  status: string;
}): string {
  const bits: string[] = [];
  if (worker.employee_id !== null) bits.push(`THC-${String(worker.employee_id).padStart(5, '0')}`);
  if (worker.role_names.length > 0) bits.push(worker.role_names.join(', '));
  if (worker.status === 'blocked') bits.push('blocked');
  return bits.join(' · ');
}
