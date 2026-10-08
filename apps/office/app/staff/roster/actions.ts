'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@thc/db/server';
import { supabaseConfigured } from '../data';
import { parseRoster } from './parse';

/**
 * The invite list (ADR-0107) — the office's, through its own session, so
 * `load_invite_roster()` and `remove_invite_roster_entries()` ask the
 * database who is calling (a viewer and a worker are refused there).
 */

export interface RosterReport {
  loaded: number;
  updated: number;
  held: ReportRow[];
  skipped: ReportRow[];
}

export interface ReportRow {
  email?: string;
  group?: string;
  payroll_id?: string;
  reason: string;
}

export type LoadResult = { ok: true; report: RosterReport } | { ok: false; message: string };

export type RemoveResult = { ok: true; removed: number } | { ok: false; message: string };

const NOT_CONFIGURED =
  'This environment has no Supabase project, so the list cannot be loaded. See docs/04-setup-github-vercel-supabase.md.';

const MESSAGES: Readonly<Record<string, string>> = {
  rows_not_an_array: 'The list could not be read. Paste it again.',
  too_many_rows: 'Up to 5,000 rows at a time — split the list and load it in parts.',
  not_authorised: 'Only the office can do this.',
  read_only: 'Your login is read-only, so this cannot be changed.',
};

interface RpcClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export async function loadRoster(text: string): Promise<LoadResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  const parsed = parseRoster(text);
  if (parsed.problems.length > 0) return { ok: false, message: parsed.problems.join(' ') };
  if (parsed.rows.length === 0)
    return { ok: false, message: 'There are no people under the header row.' };

  const supabase = createClient(await cookies()) as unknown as RpcClient;
  const { data, error } = await supabase.rpc('load_invite_roster', { p_rows: parsed.rows });
  if (error) return { ok: false, message: MESSAGES[error.message] ?? error.message };

  revalidatePath('/staff/roster');
  revalidatePath('/staff');
  const r = (data ?? {}) as Partial<RosterReport>;
  return {
    ok: true,
    report: {
      loaded: Number(r.loaded ?? 0),
      updated: Number(r.updated ?? 0),
      held: r.held ?? [],
      skipped: r.skipped ?? [],
    },
  };
}

/** `ids` null removes every entry still waiting. */
export async function removeRosterEntries(ids: string[] | null): Promise<RemoveResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const supabase = createClient(await cookies()) as unknown as RpcClient;
  const { data, error } = await supabase.rpc('remove_invite_roster_entries', { p_ids: ids });
  if (error) return { ok: false, message: MESSAGES[error.message] ?? error.message };
  revalidatePath('/staff/roster');
  return { ok: true, removed: Number(data ?? 0) };
}
