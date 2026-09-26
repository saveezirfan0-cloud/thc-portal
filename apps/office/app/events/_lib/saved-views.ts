import { EVENT_STATUS_LABEL, type EventStatus } from '@thc/domain';
import { isCalendarView } from '../calendar';
import { EVENT_STATUSES, type EventFilterSet, sameFilterSet } from './filters';

/**
 * Saved views on Scheduling (/events) — ADR-0053.
 *
 * A manager names the current filter set ("Client A · cancelled") and gets
 * it back as a chip above the list. Views live in `office_saved_views`
 * (20260930222000), one row per owner and name, so they follow a manager
 * from the office PC to a laptop; they are never shared between managers.
 * The database is the rule: own rows only, at most 30, and `query` holds
 * only the four filter keys below as bounded strings. The helpers here
 * apply the same limits first so the manager gets a sentence, not an error
 * code.
 *
 * Before the table, views were kept per BROWSER in localStorage. That key is
 * now only READ — to offer "Move my saved views to my account" once — and
 * cleared after the move. Storage stays optional: private windows, locked-
 * down browsers and full quotas all throw from `localStorage`, sometimes on
 * the property access itself, so every touch is wrapped.
 *
 * Pure, and free of `next/*`, so it is unit-tested directly.
 */

export interface SavedView {
  /** The row id; absent for a view still only in this browser. */
  id?: string;
  name: string;
  filters: EventFilterSet;
}

/** The only `scope` there is today (`office_saved_views.scope`). */
export const SAVED_VIEW_SCOPE = 'events';

/** The pre-table localStorage key, versioned. Read once for the move, then cleared. */
export const SAVED_VIEWS_KEY = 'thc.office.events.savedViews.v1';

/** Per person, across devices. The database refuses the 31st (`saved_views_cap`). */
export const MAX_SAVED_VIEWS = 30;

/** `office_saved_views_name_shape`: 1–60 characters, trimmed. */
export const MAX_VIEW_NAME = 60;

/** `office_saved_view_query_ok`: every filter value is at most 100 characters. */
export const MAX_FILTER_TEXT = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/** Trimmed, inner whitespace (control characters included) collapsed, capped. '' means "no name". */
export function normaliseViewName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_VIEW_NAME).trim();
}

function sameName(a: string, b: string): boolean {
  return normaliseViewName(a).toLowerCase() === normaliseViewName(b).toLowerCase();
}

export function findSavedView(list: SavedView[], name: string): SavedView | undefined {
  return list.find((view) => sameName(view.name, name));
}

/** The saved view the screen is showing right now, if any. */
export function activeSavedView(list: SavedView[], current: EventFilterSet): SavedView | undefined {
  return list.find((view) => sameFilterSet(view.filters, current));
}

const VIEW_LABEL: Record<EventFilterSet['view'], string> = {
  list: 'List',
  month: 'Month',
  week: 'Week',
  day: 'Day',
};

/**
 * "Client A · Cancelled · “gala” · Week" — what a filter set does, in the
 * words the toolbar uses. The default name offered when saving, and the
 * chip's tooltip. `clientName` resolves an id; an id it cannot resolve (a
 * client since removed) reads "Unknown client" rather than a UUID.
 */
export function describeFilterSet(
  set: EventFilterSet,
  clientName: (id: string) => string | undefined = () => undefined,
): string {
  const parts: string[] = [];
  if (set.clientId) parts.push(clientName(set.clientId) ?? 'Unknown client');
  if (set.status) parts.push(EVENT_STATUS_LABEL[set.status as EventStatus] ?? set.status);
  if (set.q.trim()) parts.push(`“${set.q.trim()}”`);
  if (parts.length === 0) parts.push('All events');
  parts.push(VIEW_LABEL[set.view]);
  return parts.join(' · ');
}

// ---------------------------------------------------------------------
// The stored shape: `office_saved_views.query`
// ---------------------------------------------------------------------

/** Exactly what the database accepts in `query` — four strings, nothing else. */
export interface SavedViewQuery {
  view: EventFilterSet['view'];
  q: string;
  clientId: string;
  status: string;
}

export type SavedViewQueryResult =
  { ok: true; query: SavedViewQuery } | { ok: false; message: string };

/**
 * A filter set → the JSON the table stores, checked against the same rules
 * as `office_saved_view_query_ok`. Built key by key from the known four, so
 * whatever else an object carries is never written.
 */
export function savedViewQuery(filters: EventFilterSet): SavedViewQueryResult {
  const q = (filters.q ?? '').trim();
  const clientId = (filters.clientId ?? '').trim();
  const status = filters.status ?? '';
  if (!isCalendarView(filters.view)) return { ok: false, message: 'That view cannot be saved.' };
  if (q.length > MAX_FILTER_TEXT) {
    return {
      ok: false,
      message: `Shorten the search to ${MAX_FILTER_TEXT} characters to save it.`,
    };
  }
  if (CONTROL.test(q))
    return { ok: false, message: 'The search contains characters that cannot be saved.' };
  if (clientId && !UUID.test(clientId)) {
    return {
      ok: false,
      message: 'The client filter is not one this screen knows. Pick the client again.',
    };
  }
  if (status && !(EVENT_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, message: 'That status cannot be saved.' };
  }
  return { ok: true, query: { view: filters.view, q, clientId, status } };
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Anything → a clean SavedView, or null. Tolerant: used for both the
 * database rows and the old localStorage entries. A status this build no
 * longer knows is dropped, not kept: it would filter the list to nothing.
 */
export function toSavedView(value: unknown): SavedView | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as { id?: unknown; name?: unknown; filters?: unknown };
  const name = normaliseViewName(str(record.name) ?? '');
  if (!name || !record.filters || typeof record.filters !== 'object') return null;
  const f = record.filters as Record<string, unknown>;
  const view = str(f.view) ?? '';
  const status = str(f.status) ?? '';
  if (!isCalendarView(view)) return null;
  const id = str(record.id);
  return {
    ...(id ? { id } : {}),
    name,
    filters: {
      view,
      q: (str(f.q) ?? '').trim(),
      clientId: str(f.clientId) ?? '',
      status: (EVENT_STATUSES as readonly string[]).includes(status) ? status : '',
    },
  };
}

/** A row of `office_saved_views` as the list query selects it. */
export interface SavedViewRow {
  id: string;
  name: string;
  query: unknown;
}

/** Rows → views, bad rows dropped, duplicate names keep the first. */
export function savedViewsFromRows(rows: readonly SavedViewRow[] | null | undefined): SavedView[] {
  const out: SavedView[] = [];
  for (const row of rows ?? []) {
    const view = toSavedView({ id: row.id, name: row.name, filters: row.query });
    if (view && !findSavedView(out, view.name)) out.push(view);
  }
  return out;
}

/**
 * Which of this browser's old views to move into the account: the valid
 * ones, not already saved under that name, as many as the cap leaves room
 * for. `skipped` counts the rest, so the bar can say so.
 */
export function viewsToMove(
  local: readonly SavedView[],
  remote: readonly SavedView[],
): { views: { name: string; query: SavedViewQuery }[]; skipped: number } {
  const room = Math.max(0, MAX_SAVED_VIEWS - remote.length);
  const views: { name: string; query: SavedViewQuery }[] = [];
  let skipped = 0;
  for (const view of local) {
    const name = normaliseViewName(view.name);
    const query = savedViewQuery(view.filters);
    const taken =
      findSavedView([...remote], name) !== undefined ||
      views.some((moved) => sameName(moved.name, name));
    if (!name || !query.ok || taken || views.length >= room) {
      skipped += 1;
      continue;
    }
    views.push({ name, query: query.query });
  }
  return { views, skipped };
}

/**
 * A database refusal → a sentence. `code` is the Postgres SQLSTATE PostgREST
 * passes through; the guard's own reasons arrive in `message`.
 */
export function explainSavedViewError(error: { code?: string; message?: string } | null): string {
  const message = error?.message ?? '';
  if (message.includes('saved_views_cap')) {
    return `You already have ${MAX_SAVED_VIEWS} saved views. Delete one to save another.`;
  }
  if (error?.code === '23505') return 'A view with that name already exists. Refresh to see it.';
  if (error?.code === '23514')
    return 'That view could not be saved: its name or filters are not valid.';
  if (error?.code === '42501' || error?.code === 'PGRST301') {
    return 'This login is not allowed to change saved views.';
  }
  return 'Saved views could not be reached. Try again in a moment.';
}

/** True for a refusal that will not change on retry: the bar goes read-only. */
export function isPermissionRefusal(error: { code?: string } | null): boolean {
  return error?.code === '42501' || error?.code === 'PGRST301';
}

// ---------------------------------------------------------------------
// The old per-browser store — read for the move, then cleared
// ---------------------------------------------------------------------

/**
 * Whatever is in storage → a clean list. Malformed JSON, a foreign shape or
 * a single bad entry never breaks the screen: bad entries are dropped,
 * duplicate names keep the first, and the cap is applied.
 */
export function parseSavedViews(raw: string | null | undefined): SavedView[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: SavedView[] = [];
  for (const item of data) {
    const view = toSavedView(item);
    // The old format never had ids; do not trust one if it appears.
    if (view) delete view.id;
    if (view && !findSavedView(out, view.name)) out.push(view);
  }
  return out.slice(0, MAX_SAVED_VIEWS);
}

export type ViewStorage = Pick<Storage, 'getItem' | 'removeItem'>;

/**
 * The browser's localStorage, or null. Reading `window.localStorage` can
 * itself throw (a SecurityError with storage disabled), so even the lookup
 * is inside the try.
 */
export function browserStorage(): ViewStorage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readSavedViews(storage: ViewStorage | null | undefined): SavedView[] {
  if (!storage) return [];
  try {
    return parseSavedViews(storage.getItem(SAVED_VIEWS_KEY));
  } catch {
    return [];
  }
}

/** Forget this browser's old views (after they were moved). False when storage refused. */
export function clearSavedViews(storage: ViewStorage | null | undefined): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(SAVED_VIEWS_KEY);
    return true;
  } catch {
    return false;
  }
}
