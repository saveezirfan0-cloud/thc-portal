import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { supabaseConfigured } from '../data';
import { readProblem } from '../../_lib/dbError';

/**
 * The client card's first read (ADR-0161): does this client exist, and what
 * is it called? One row of `clients_directory_v` — the view the card's
 * general info is read from, so a 404 here is exactly a missing card there.
 * Three columns only: the view is flattened into the query, so its margin,
 * rate-card and event-count sub-reads are never computed for this read.
 *
 * The page answers the 404 on this, BEFORE the card streams in behind a
 * Suspense (ADR-0109).
 */
export interface ClientHead {
  client: { id: string; name: string; archived_at: string | null } | null;
  problem: string | null;
}

const NOT_CONFIGURED =
  'This environment has no Supabase project, so the client card cannot be read. See docs/04-setup-github-vercel-supabase.md.';

export async function loadClientHead(id: string): Promise<ClientHead> {
  if (!supabaseConfigured()) return { client: null, problem: NOT_CONFIGURED };
  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from('clients_directory_v')
    .select('id, name, archived_at')
    .eq('id', id)
    .maybeSingle<{ id: string; name: string; archived_at: string | null }>();
  if (error) return { client: null, problem: readProblem(error) };
  return { client: data ?? null, problem: null };
}
