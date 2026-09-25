import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@thc/db/server';
import { supabaseConfigured } from '../staff/data';
import { type ActivityRow, type Period, periodStart } from './view-model';

export const PAGE_SIZE = 50;

export interface ActivityFilters {
  entity: string | null;
  actor: string | null;
  query: string | null;
  period: Period;
  before: number | null;
}

export interface ActivityPageData {
  rows: ActivityRow[];
  entities: { entity: string; n: number }[];
  actors: { id: string; name: string; n: number }[];
  /** The id to page from for "Older", when there may be more. */
  nextBefore: number | null;
  problem: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    supabase.rpc('admin_activity', {
      p_limit: PAGE_SIZE,
      p_before: filters.before,
      p_entity: filters.entity,
      p_actor: filters.actor && UUID.test(filters.actor) ? filters.actor : null,
      p_query: filters.query,
      p_since: periodStart(filters.period, new Date()),
    }),
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
