import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { supabaseConfigured } from '../data';
import { parseRosterReport } from './report';
import type { RosterReportData } from './report';

/**
 * Reads for /staff/roster (ADR-0107): the people on the invite list who have
 * not applied yet. A row is consumed when its person applies, so the table
 * IS that list. `invite_roster` has one policy — admin_read — so a session
 * that is not the office reads nothing.
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

export interface RosterPageData {
  waiting: RosterEntry[];
  /** The reminder report and possible matches (ADR-0123); null when it could not be read. */
  report: RosterReportData | null;
  problem: string | null;
}

/** PostgREST returns at most `max_rows` (1000) per request, so the list is read in pages. */
const PAGE = 1000;

interface PageQuery extends PromiseLike<{
  data: RosterEntry[] | null;
  error: { message: string } | null;
}> {
  order(column: string, options: { ascending: boolean }): PageQuery;
  range(from: number, to: number): PageQuery;
}

interface ReadClient {
  from(table: 'invite_roster'): { select(columns: string): PageQuery };
  rpc(fn: 'invite_roster_report'): PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;
}

export async function loadRosterPage(): Promise<RosterPageData> {
  if (!supabaseConfigured()) {
    return {
      waiting: [],
      report: null,
      problem:
        'This environment has no Supabase project, so the invite list cannot be read. See docs/04-setup-github-vercel-supabase.md.',
    };
  }
  const supabase = createClient(await cookies()) as unknown as ReadClient;
  const reportCall = supabase.rpc('invite_roster_report');
  const waiting: RosterEntry[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('invite_roster')
      .select('id, email, first_name, last_name, payroll_id, grp, loaded_at')
      .order('loaded_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return { waiting: [], report: null, problem: error.message };
    waiting.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE) break;
  }
  // The report is extra: if it fails, the list still shows, and says why.
  const { data: reportData, error: reportError } = await reportCall;
  return {
    waiting,
    report: reportError ? null : parseRosterReport(reportData),
    problem: reportError ? `The reminder report could not be read: ${reportError.message}` : null,
  };
}
