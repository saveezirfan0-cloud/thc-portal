import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { readAllPages } from '@thc/db/paged';
import type { PageReply } from '@thc/db/paged';
import { type ShortStaffedRole, type ShortStaffedRow, toShortStaffed } from './short-staffed';
import { readProblem } from '../_lib/dbError';

/**
 * The read behind "Short-staffed — next 48 hours".
 *
 * Its own loader rather than a fourth query inside `loadDashboard`, so the
 * panel can fail on its own without taking the KPIs with it, and so this
 * file is the only one that knows the view's name.
 *
 * `dashboard_short_staffed_v` is chosen over re-filtering the ten-day list
 * because that list selects by event DATE: a role starting after midnight
 * on an event dated yesterday starts inside the next 48 hours and is not on
 * it. The view selects by the section's own start (RULE-18) and carries no
 * money.
 */

export interface ShortStaffedData {
  /** null when this environment cannot read at all (no Supabase). */
  roles: ShortStaffedRole[] | null;
  problem: string | null;
}

export async function loadShortStaffed(): Promise<ShortStaffedData> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    // The page's own alert already says there is no database here.
    return { roles: null, problem: null };
  }

  // Untyped: the view is not in the generated `Database` type until the
  // types are regenerated after 20261001200400, and the typed client refuses
  // a relation it does not know. The row shape is asserted below instead.
  const supabase = createClient(await cookies()) as unknown as SupabaseClient;
  // Paged (go-live audit M11): one row per short section, by its own start
  // and then its id, so a busy 48 hours never loses its last rows quietly.
  const { data, error } = await readAllPages<ShortStaffedRow>(
    (range) =>
      supabase
        .from('dashboard_short_staffed_v')
        .select(
          'shift_id, event_id, event_title, event_date, client_name, venue_name, role_name, starts_at, ends_at, headcount, confirmed, open_positions',
        )
        .order('starts_at', { ascending: true })
        .order('shift_id', { ascending: true })
        .range(range.from, range.to) as unknown as PromiseLike<PageReply<ShortStaffedRow>>,
    { what: 'short-staffed sections', key: (row) => row.shift_id },
  );

  if (error) return { roles: null, problem: readProblem(error) };

  // Must match 20261001200400_dashboard_short_staffed.sql.
  return { roles: toShortStaffed(data), problem: null };
}
