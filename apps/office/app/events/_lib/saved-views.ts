import { EVENT_STATUS_LABEL, type EventStatus } from '@thc/domain';
import { isCalendarView } from '../calendar';
import { EVENT_STATUSES, type EventFilterSet, sameFilterSet } from './filters';

/**
 * Saved views on Scheduling (/events).
 *
 * A manager names the current filter set ("Client A · cancelled") and gets
 * it back as a chip above the list. Views are kept per BROWSER in
 * localStorage — there is no table behind them, so they do not follow a
 * manager to another device and are not shared between managers. Views per
 * user across devices would need a table (owner, name, filter JSON) with an
 * own-row RLS policy.
 *
 * Storage is optional. Private windows, locked-down browsers and full
 * quotas all throw from `localStorage`, sometimes on the property access
 * itself, so every read and write here is wrapped and the screen works with
 * no saved views at all when storage is unavailable.
 */

export interface SavedView {
  name: string;
  filters: EventFilterSet;
}

/** Versioned, so a later shape can ignore this one rather than misread it. */
export const SAVED_VIEWS_KEY = 'thc.office.events.savedViews.v1';

/** Enough for a manager's regulars; a chip row is not a filing cabinet. */
export const MAX_SAVED_VIEWS = 12;

export const MAX_VIEW_NAME = 40;

/** Trimmed, inner whitespace collapsed, capped. '' means "no name". */
export function normaliseViewName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_VIEW_NAME).trim();
}

function sameName(a: string, b: string): boolean {
  return normaliseViewName(a).toLowerCase() === normaliseViewName(b).toLowerCase();
}

/**
 * Add a view, or replace the one already carrying that name (case-
 * insensitively) in place, so re-saving "Weddings" updates it rather than
 * making a second "Weddings". A nameless view is refused (the list comes
 * back unchanged). Past the cap, the oldest view makes room.
 */
export function upsertSavedView(
  list: SavedView[],
  name: string,
  filters: EventFilterSet,
): SavedView[] {
  const clean = normaliseViewName(name);
  if (!clean) return list;
  const entry: SavedView = { name: clean, filters: { ...filters, q: filters.q.trim() } };
  const index = list.findIndex((view) => sameName(view.name, clean));
  if (index >= 0) {
    return list.map((view, i) => (i === index ? entry : view));
  }
  const next = [...list, entry];
  return next.length > MAX_SAVED_VIEWS ? next.slice(next.length - MAX_SAVED_VIEWS) : next;
}

export function removeSavedView(list: SavedView[], name: string): SavedView[] {
  return list.filter((view) => !sameName(view.name, name));
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
// (De)serialising — tolerant on the way in
// ---------------------------------------------------------------------

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function toSavedView(value: unknown): SavedView | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as { name?: unknown; filters?: unknown };
  const name = normaliseViewName(str(record.name) ?? '');
  if (!name || !record.filters || typeof record.filters !== 'object') return null;
  const f = record.filters as Record<string, unknown>;
  const view = str(f.view) ?? '';
  const status = str(f.status) ?? '';
  if (!isCalendarView(view)) return null;
  return {
    name,
    filters: {
      view,
      q: (str(f.q) ?? '').trim(),
      clientId: str(f.clientId) ?? '',
      // A status this build no longer knows is dropped, not kept: it would
      // filter the list to nothing.
      status: (EVENT_STATUSES as readonly string[]).includes(status) ? status : '',
    },
  };
}

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
    if (view && !out.some((existing) => sameName(existing.name, view.name))) out.push(view);
  }
  return out.slice(0, MAX_SAVED_VIEWS);
}

export function serialiseSavedViews(list: SavedView[]): string {
  return JSON.stringify(list);
}

// ---------------------------------------------------------------------
// Storage — every touch wrapped
// ---------------------------------------------------------------------

export type ViewStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * The browser's localStorage, or null. Reading `window.localStorage` can
 * itself throw (a SecurityError with storage disabled), so even the lookup
 * is inside the try.
 */
export function browserStorage(): ViewStorage | null {
  try {
    if (typeof window === 'undefined') return null;
    const storage = window.localStorage;
    // A Safari private window used to hand out a store that threw on write.
    const probe = `${SAVED_VIEWS_KEY}.probe`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
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

/** True when the list was stored; false when storage refused it. */
export function writeSavedViews(
  storage: ViewStorage | null | undefined,
  list: SavedView[],
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SAVED_VIEWS_KEY, serialiseSavedViews(list));
    return true;
  } catch {
    return false;
  }
}
