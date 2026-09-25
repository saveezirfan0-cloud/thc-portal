import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@thc/db/server';
import { supabaseConfigured } from '../staff/data';
import { type ActivityFilters, type ActivityRow, periodStart } from './view-model';

export type { ActivityFilters } from './view-model';

export const PAGE_SIZE = 50;

/** admin_activity returns at most this many rows a call (20260930100000). */
const RPC_MAX = 200;

export interface ActivityPageData {
  rows: ActivityRow[];
  entities: { entity: string; n: number }[];
  actors: { id: string; name: string; n: number }[];
  /** The id to page from for "Older", when there may be more. */
  nextBefore: number | null;
  problem: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The RPC's arguments for one page of the log under these filters. */
function activityArgs(filters: ActivityFilters, limit: number, before: number | null, now: Date) {
  return {
    p_limit: limit,
    p_before: before,
    p_entity: filters.entity,
    p_actor: filters.actor && UUID.test(filters.actor) ? filters.actor : null,
    p_query: filters.query,
    p_since: periodStart(filters.period, now),
  };
}

export async function loadActivity(filters: ActivityFilters): Promise<ActivityPageData> {
  const empty = { rows: [], entities: [], actors: [], nextBefore: null };
  if (!supabaseConfigured()) {
    return {
      ...empty,
      problem:
        'This environment has no Supabase project, so there is no activity to show. See docs/04-setup-github-vercel-supabase.md.',
    };
  }
  const supabase = createClient(await cookies()) as unknown as SupabaseClient;
  const [rows, facets] = await Promise.all([
    supabase.rpc('admin_activity', activityArgs(filters, PAGE_SIZE, filters.before, new Date())),
    supabase.rpc('admin_activity_facets'),
  ]);
  const list = (rows.data ?? []) as ActivityRow[];
  const facetData = (facets.data ?? {}) as {
    entities?: { entity: string; n: number }[];
    actors?: { id: string; name: string; n: number }[];
  };
  return {
    rows: list,
    entities: facetData.entities ?? [],
    actors: facetData.actors ?? [],
    nextBefore: list.length === PAGE_SIZE ? (list[list.length - 1]?.id ?? null) : null,
    problem: rows.error?.message ?? facets.error?.message ?? null,
  };
}

/**
 * /activity/export: the whole filtered log, newest first, a page of the
 * RPC's maximum at a time, until `cap` rows have been read. One row past
 * the cap is asked for so the file can say whether it stopped short.
 *
 * `period` is fixed at the first call, so a page read a minute later does
 * not move the window the file was asked for.
 */
export async function* activityExportPages(
  supabase: SupabaseClient,
  filters: ActivityFilters,
  cap: number,
  now: Date = new Date(),
): AsyncGenerator<{ rows: ActivityRow[]; truncated: boolean }, void, void> {
  let read = 0;
  let before = filters.before;
  while (read < cap) {
    const want = Math.min(RPC_MAX, cap - read + 1);
    const { data, error } = await supabase.rpc(
      'admin_activity',
      activityArgs(filters, want, before, now),
    );
    if (error) throw new Error(error.message);
    const page = (data ?? []) as ActivityRow[];
    const room = cap - read;
    if (page.length > room) {
      yield { rows: page.slice(0, room), truncated: true };
      return;
    }
    read += page.length;
    yield { rows: page, truncated: false };
    if (page.length < want) return;
    before = page[page.length - 1]?.id ?? null;
    if (before === null) return;
  }
  // Exactly `cap` read and the last page was full: is there one more?
  const { data } = await supabase.rpc('admin_activity', activityArgs(filters, 1, before, now));
  if ((data ?? []).length > 0) yield { rows: [], truncated: true };
}
