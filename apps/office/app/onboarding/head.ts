import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { supabaseConfigured } from '../staff/data';
import { readProblem } from '../_lib/dbError';

/**
 * The candidate screen's first read (ADR-0161): is this person in the
 * pipeline, and what is their name? One indexed row of
 * `onboarding_candidates_v` — the view the full record is read from, so a
 * 404 here is exactly a missing candidate there (§1.7: a removed person is
 * not in it). Two columns only: the view is flattened into the query, so its
 * per-row document, quiz and reference sub-reads are never computed here.
 *
 * The page answers the 404 on this, BEFORE the record streams in behind a
 * Suspense (ADR-0109).
 */
export interface CandidateHead {
  candidate: { id: string; display_name: string } | null;
  problem: string | null;
}

const NOT_CONFIGURED =
  'This environment has no Supabase project, so the onboarding pipeline cannot be read. See docs/04-setup-github-vercel-supabase.md.';

export async function loadCandidateHead(id: string): Promise<CandidateHead> {
  if (!supabaseConfigured()) return { candidate: null, problem: NOT_CONFIGURED };
  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from('onboarding_candidates_v')
    .select('id, display_name')
    .eq('id', id)
    .maybeSingle<{ id: string; display_name: string }>();
  if (error) return { candidate: null, problem: readProblem(error) };
  return { candidate: data ?? null, problem: null };
}
