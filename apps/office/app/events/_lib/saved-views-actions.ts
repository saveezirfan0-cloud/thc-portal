'use server';

import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { eventsDb, supabaseConfigured } from '../db';
import type { EventFilterSet } from './filters';
import {
  MAX_SAVED_VIEWS,
  SAVED_VIEW_SCOPE,
  type SavedView,
  type SavedViewRow,
  explainSavedViewError,
  findSavedView,
  isPermissionRefusal,
  normaliseViewName,
  savedViewQuery,
  savedViewsFromRows,
  toSavedView,
  viewsToMove,
} from './saved-views';

/**
 * Saved views on Scheduling, read and written on the manager's own session
 * (ADR-0053). `office_saved_views` holds the rule — own rows only, Back
 * Office logins only, at most 30, `query` limited to the four filter keys —
 * so these actions never use the service key: a refusal from the database
 * is the answer, and the bar turns read-only on it.
 *
 * Each write returns the fresh list, so what the bar shows after a save is
 * what the table holds, including a view saved on another device since the
 * page opened.
 */

export type SavedViewsOutcome =
  | { ok: true; views: SavedView[]; message?: string }
  | {
      ok: false;
      message: string;
      /** True when retrying will not help (not configured, or refused): stop offering writes. */
      readOnly: boolean;
    };

const TABLE = 'office_saved_views';

const NOT_CONFIGURED =
  'This environment has no Supabase project, so saved views are not available (docs/04-setup-github-vercel-supabase.md).';

async function db(): Promise<SupabaseClient> {
  return eventsDb(await cookies());
}

async function readViews(client: SupabaseClient): Promise<SavedViewsOutcome> {
  const { data, error } = await client
    .from(TABLE)
    .select('id, name, query')
    .eq('scope', SAVED_VIEW_SCOPE)
    .order('created_at', { ascending: true });
  if (error) {
    console.error('saved views: list failed', error.message);
    return { ok: false, message: explainSavedViewError(error), readOnly: true };
  }
  return { ok: true, views: savedViewsFromRows(data as SavedViewRow[] | null) };
}

function refused(error: { code?: string; message?: string }): SavedViewsOutcome {
  console.error('saved views: write refused', error.code, error.message);
  return { ok: false, message: explainSavedViewError(error), readOnly: isPermissionRefusal(error) };
}

/** The signed-in manager's views, oldest first. */
export async function listMySavedViews(): Promise<SavedViewsOutcome> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED, readOnly: true };
  return readViews(await db());
}

/**
 * Save the filters under a name. Re-using a name (case-insensitively)
 * updates that view in place rather than making a second one.
 */
export async function saveMyView(
  name: string,
  filters: EventFilterSet,
): Promise<SavedViewsOutcome> {
  const clean = normaliseViewName(typeof name === 'string' ? name : '');
  if (!clean) return { ok: false, message: 'Give the view a name.', readOnly: false };
  const shaped = savedViewQuery(filters);
  if (!shaped.ok) return { ok: false, message: shaped.message, readOnly: false };
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED, readOnly: true };

  const client = await db();
  const current = await readViews(client);
  if (!current.ok) return current;

  const existing = findSavedView(current.views, clean);
  if (!existing && current.views.length >= MAX_SAVED_VIEWS) {
    return {
      ok: false,
      message: explainSavedViewError({ message: 'saved_views_cap' }),
      readOnly: false,
    };
  }

  const { error } = existing?.id
    ? await client.from(TABLE).update({ name: clean, query: shaped.query }).eq('id', existing.id)
    : await client
        .from(TABLE)
        .insert({ scope: SAVED_VIEW_SCOPE, name: clean, query: shaped.query });
  if (error) return refused(error);

  const after = await readViews(client);
  if (!after.ok) return after;
  return { ...after, message: existing ? `Updated “${existing.name}”.` : 'View saved.' };
}

/** Delete one of the manager's own views. Another person's id matches nothing (RLS). */
export async function deleteMyView(id: string): Promise<SavedViewsOutcome> {
  if (typeof id !== 'string' || !id) {
    return { ok: false, message: 'That view no longer exists.', readOnly: false };
  }
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED, readOnly: true };

  const client = await db();
  const { error } = await client.from(TABLE).delete().eq('id', id).eq('scope', SAVED_VIEW_SCOPE);
  if (error) return refused(error);
  return readViews(client);
}

/**
 * The one-tap move of this browser's old localStorage views into the
 * account. The list comes from the browser, so it is re-parsed here and
 * never trusted: only valid views, not already saved under that name, up
 * to the cap. One INSERT, so it lands whole or not at all; the browser
 * clears its copy only on `ok`.
 */
export async function moveLocalViews(local: unknown): Promise<SavedViewsOutcome> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED, readOnly: true };
  const parsed = (Array.isArray(local) ? local : [])
    .map((item) => toSavedView(item))
    .filter((view): view is SavedView => view !== null);

  const client = await db();
  const current = await readViews(client);
  if (!current.ok) return current;

  const { views, skipped } = viewsToMove(parsed, current.views);
  if (views.length > 0) {
    const { error } = await client
      .from(TABLE)
      .insert(
        views.map((view) => ({ scope: SAVED_VIEW_SCOPE, name: view.name, query: view.query })),
      );
    if (error) return refused(error);
  }

  const after = await readViews(client);
  if (!after.ok) return after;
  const moved = `Moved ${views.length} saved view${views.length === 1 ? '' : 's'} to your account.`;
  const left =
    skipped > 0
      ? ` ${skipped} could not be moved (a duplicate name, an invalid filter or no room).`
      : '';
  return { ...after, message: moved + left };
}
