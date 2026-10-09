import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { supabaseConfigured } from '../data';

/**
 * Reads for /staff/roster (ADR-0107): the people on the invite list who have
 * not applied yet, and — from `invite_list_applied_v`, which reads the audit
 * rows the matcher writes — the ones who have. A row is consumed when its
 * person applies, so `invite_roster` IS the waiting list. Both reads are the
 * office's: `invite_roster` has one policy (admin_read) and the view runs
 * with the caller's rights, so a session that is not the office reads nothing.
 */
export interface RosterEntry {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  payroll_id: string | null;
  grp: 'spudbros' | 'thc';
  loaded_at: string;
}

/** `how`: matched by email and name · applied with an invited email under another name · already here when the list was loaded. */
export interface AppliedEntry {
  staff_id: string;
  applied_at: string;
  how: 'applied' | 'name_mismatch' | 'already_here';
  grp: 'spudbros' | 'thc';
  email: string | null;
  display_name: string;
  payroll_id: string | null;
  payroll_id_taken: boolean;
  status: string;
  removed: boolean;
}

export interface RosterPageData {
  waiting: RosterEntry[];
  applied: AppliedEntry[];
  problem: string | null;
}

/** PostgREST returns at most `max_rows` (1000) per request, so the list is read in pages. */
const PAGE = 1000;

interface PageQuery<Row> extends PromiseLike<{
  data: Row[] | null;
  error: { message: string } | null;
}> {
  order(column: string, options: { ascending: boolean }): PageQuery<Row>;
  range(from: number, to: number): PageQuery<Row>;
}

interface ReadClient {
  from(table: 'invite_roster'): { select(columns: string): PageQuery<RosterEntry> };
  from(table: 'invite_list_applied_v'): { select(columns: string): PageQuery<AppliedEntry> };
}

export async function loadRosterPage(): Promise<RosterPageData> {
  if (!supabaseConfigured()) {
    return {
      waiting: [],
      applied: [],
      problem:
        'This environment has no Supabase project, so the invite list cannot be read. See docs/04-setup-github-vercel-supabase.md.',
    };
  }
  const supabase = createClient(await cookies()) as unknown as ReadClient;
  const waiting: RosterEntry[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('invite_roster')
      .select('id, email, first_name, last_name, payroll_id, grp, loaded_at')
      .order('loaded_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return { waiting: [], applied: [], problem: error.message };
    waiting.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE) break;
  }
  const applied: AppliedEntry[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('invite_list_applied_v')
      .select(
        'staff_id, applied_at, how, grp, email, display_name, payroll_id, payroll_id_taken, status, removed',
      )
      .order('applied_at', { ascending: false })
      .order('staff_id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return { waiting, applied: [], problem: error.message };
    applied.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE) break;
  }
  return { waiting, applied, problem: null };
}
