import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { readProblem } from '../../_lib/dbError';
import { supabaseConfigured } from '../data';

/**
 * The list the office works through to bring names on file to the passport
 * (ADR-0193): `office_names_to_review()`, a definer with the admin check in
 * its own body, called through the manager's own session.
 */
export interface NameToReview {
  staff_id: string;
  status: string;
  first_name: string;
  last_name: string;
  /** initial | characters | lower_case | upper_case */
  reasons: string[];
  /** The name on the Home Office record from the latest share-code check. */
  record_name: string | null;
}

interface ReviewRpc {
  rpc(
    fn: 'office_names_to_review',
  ): PromiseLike<{ data: NameToReview[] | null; error: { message: string } | null }>;
}

export async function loadNamesToReview(): Promise<{
  rows: NameToReview[];
  problem: string | null;
}> {
  if (!supabaseConfigured()) {
    return { rows: [], problem: 'This environment has no Supabase project.' };
  }
  const supabase = createClient(await cookies()) as unknown as ReviewRpc;
  const { data, error } = await supabase.rpc('office_names_to_review');
  if (error) return { rows: [], problem: readProblem(error) };
  return { rows: data ?? [], problem: null };
}
