'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@thc/db/server';
import { supabaseConfigured } from '../data';
import { parseRoster } from './parse';

/**
 * The invite list (ADR-0105) — the office's, through its own session, so
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

/** Why a row was not taken, in a sentence. */
export const REASON_TEXT: Readonly<Record<string, string>> = {
  bad_email: 'Not an email address',
  group_unknown: 'Group not understood — use SpudBros Express or THC',
  bad_payroll_id: 'Payroll ID can only hold letters, digits and hyphens',
  duplicate_email_in_file: 'This email is in the list twice',
  duplicate_payroll_id_in_file: 'This Payroll ID is in the list twice',
  payroll_id_taken: 'Another person already has this Payroll ID',
  has_upcoming_shifts:
    'Already here with an upcoming shift — not switched to SpudBros; move the shift first',
  name_mismatch:
    'The name on the sheet is not the name of the worker who has this email — nothing was changed. Check the email',
  already_marked_spudbros: 'Already marked SpudBros Express — a list never switches them back',
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
