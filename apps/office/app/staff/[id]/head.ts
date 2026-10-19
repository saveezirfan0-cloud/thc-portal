import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { supabaseConfigured } from '../data';
import { readProblem } from '../../_lib/dbError';

/**
 * The profile's first read (ADR-0161): does this worker exist, and what does
 * the topbar call them? One indexed row of `staff_profile_v` — the view the
 * full profile is read from, so a 404 here is exactly a missing profile
 * there, and the name is the view's (§1.7: "Deleted account #id" for a
 * removed worker). Only the three columns are asked for: the view is
 * flattened into the query, so its weekly-cap join and personal columns are
 * never computed for this read.
 *
 * The page decides between the profile and a real 404 on this, BEFORE the
 * rest of the profile streams in behind a Suspense (ADR-0109: a 200 sent
 * ahead of a notFound() is a 404 that answers 200).
 */
export interface ProfileHead {
  profile: { id: string; display_name: string; employee_id: number | null } | null;
  problem: string | null;
}

const NOT_CONFIGURED =
  'This environment has no Supabase project, so the profile cannot be read. See docs/04-setup-github-vercel-supabase.md.';

export async function loadProfileHead(id: string): Promise<ProfileHead> {
  if (!supabaseConfigured()) return { profile: null, problem: NOT_CONFIGURED };
  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from('staff_profile_v')
    .select('id, display_name, employee_id')
    .eq('id', id)
    .maybeSingle<{ id: string; display_name: string; employee_id: number | null }>();
  if (error) return { profile: null, problem: readProblem(error) };
  return { profile: data ?? null, problem: null };
}
