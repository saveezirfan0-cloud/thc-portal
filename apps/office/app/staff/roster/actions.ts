'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@thc/db/server';
import { explainDbError } from '../../_lib/dbError';
import { supabaseConfigured } from '../data';
import type { BulkLinkOutcome, LinkItem } from './bulk';
import { parseEmailRecords } from './emails';
import type { EmailRecordKind, EmailRecordsPage } from './emails';
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
  not_permitted: 'Only an owner or manager can change Payroll IDs.',
  // link_invite_roster_entry (ADR-0123)
  unknown_entry: 'That person is no longer on the list. Reload the page.',
  unknown_staff: 'That staff record is no longer there. Reload the page.',
  name_mismatch: 'The names do not agree, so they were not linked.',
  payroll_id_taken: 'Somebody else already has this Payroll ID. Check who on the Staff page.',
  has_other_payroll_id: 'This person already has a different Payroll ID.',
  // staff_email_records (ADR-0144)
  unknown_email: 'That email is not one this page lists. Reload the page.',
  unknown_kind: 'That count is not one this page shows. Reload the page.',
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
  if (error)
    return {
      ok: false,
      message:
        MESSAGES[error.message] ??
        explainDbError(error, { codes: MESSAGES, log: '[invite roster]' }),
    };

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
  if (error)
    return {
      ok: false,
      message:
        MESSAGES[error.message] ??
        explainDbError(error, { codes: MESSAGES, log: '[invite roster]' }),
    };
  revalidatePath('/staff/roster');
  return { ok: true, removed: Number(data ?? 0) };
}

export type LinkResult =
  { ok: true; payrollId: string | null; spudbros: string } | { ok: false; message: string };

/**
 * Link a list row to the person who applied (ADR-0123, ADR-0143) — under
 * another email, or with the listed one but held back:
 * `link_invite_roster_entry()` applies the Payroll ID and group and consumes
 * the row, so the daily reminders stop. `confirmName` is the office's word,
 * given after seeing both names, that they are the same person; it lifts the
 * name check and nothing else. Owner and manager only, in the database.
 */
export async function linkRosterEntry(
  entryId: string,
  staffId: string,
  confirmName = false,
): Promise<LinkResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const supabase = createClient(await cookies()) as unknown as RpcClient;
  const { data, error } = await supabase.rpc('link_invite_roster_entry', {
    p_entry: entryId,
    p_staff: staffId,
    p_confirm_name: confirmName,
  });
  if (error)
    return {
      ok: false,
      message:
        MESSAGES[error.message] ??
        explainDbError(error, { codes: MESSAGES, log: '[invite roster]' }),
    };
  revalidatePath('/staff/roster');
  const result = (data ?? {}) as { payrollId?: string | null; spudbros?: string };
  return {
    ok: true,
    payrollId: result.payrollId ?? null,
    spudbros: result.spudbros ?? 'unchanged',
  };
}

/** At most this many rows in one "Link ticked": the invite list's largest real batch is under 1,000. */
const MAX_BULK_LINK = 1000;

export type BulkLinkResult = ({ ok: true } & BulkLinkOutcome) | { ok: false; message: string };

/**
 * Link many applied rows in one go (ADR-0145): each through
 * `link_invite_roster_entry()`, one at a time, so every row is refused or
 * linked on its own and a refusal never undoes the others. The database
 * checks each call exactly as a single Link (owner and manager only, names,
 * a taken Payroll ID).
 */
export async function linkRosterEntries(items: LinkItem[]): Promise<BulkLinkResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  if (items.length === 0) return { ok: false, message: 'Tick at least one person to link.' };
  if (items.length > MAX_BULK_LINK)
    return { ok: false, message: `Up to ${MAX_BULK_LINK} at a time. Link them in parts.` };
  const supabase = createClient(await cookies()) as unknown as RpcClient;
  const outcome: BulkLinkOutcome = { linked: 0, heldSpudbros: 0, failed: [] };
  for (const item of items) {
    const { data, error } = await supabase.rpc('link_invite_roster_entry', {
      p_entry: item.entryId,
      p_staff: item.staffId,
      p_confirm_name: item.confirmName === true,
    });
    if (error) {
      // Who may link is the same for every row: stop at the first refusal of the login itself.
      if (['not_authorised', 'read_only', 'not_permitted'].includes(error.message))
        return { ok: false, message: MESSAGES[error.message]! };
      outcome.failed.push({
        entryId: item.entryId,
        message:
          MESSAGES[error.message] ??
          explainDbError(error, { codes: MESSAGES, log: '[invite roster]' }),
      });
      continue;
    }
    outcome.linked += 1;
    if ((data as { spudbros?: string } | null)?.spudbros === 'held_upcoming_shifts')
      outcome.heldSpudbros += 1;
  }
  if (outcome.linked > 0) revalidatePath('/staff/roster');
  return { ok: true, ...outcome };
}

export type ToggleResult =
  { ok: true; enabled: boolean; cancelled: number } | { ok: false; message: string };

/**
 * Turn the daily reminder (IR1) on or off (ADR-0123). Off also cancels the
 * reminders queued and not yet sent, so it stops at once.
 */
export async function setRemindersEnabled(enabled: boolean): Promise<ToggleResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const supabase = createClient(await cookies()) as unknown as RpcClient;
  const { data, error } = await supabase.rpc('set_invite_roster_reminders', {
    p_enabled: enabled,
  });
  if (error)
    return {
      ok: false,
      message:
        MESSAGES[error.message] ??
        explainDbError(error, { codes: MESSAGES, log: '[invite roster]' }),
    };
  revalidatePath('/staff/roster');
  const result = (data ?? {}) as { enabled?: boolean; cancelled?: number };
  return { ok: true, enabled: result.enabled ?? enabled, cancelled: Number(result.cancelled ?? 0) };
}

export type EmailRecordsResult =
  { ok: true; page: EmailRecordsPage } | { ok: false; message: string };

/**
 * The records behind one count on "Emails staff receive" (ADR-0144): who,
 * when, and why for one not delivered. A page at a time, read with the
 * office's own session, so `staff_email_records()` decides who may see them.
 */
export async function loadEmailRecords(
  id: string,
  kind: EmailRecordKind,
  offset: number,
  limit: number,
): Promise<EmailRecordsResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const supabase = createClient(await cookies()) as unknown as RpcClient;
  const { data, error } = await supabase.rpc('staff_email_records', {
    p_id: id,
    p_kind: kind,
    p_limit: limit,
    p_offset: Math.max(0, Math.floor(offset)),
  });
  if (error)
    return {
      ok: false,
      message:
        MESSAGES[error.message] ??
        explainDbError(error, { codes: MESSAGES, log: '[staff emails]' }),
    };
  return { ok: true, page: parseEmailRecords(data) };
}
