'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@thc/db/server';
import { supabaseConfigured } from './data';
import { validateDraft } from './view-model';
import type { ActionResult, EventOption, OfficeDraft, WorkerOption } from './types';

/**
 * Writes for /feedback and the profile's Feedback tab (§9.10), through the
 * RPCs in 20260923140000_feedback_inbox.sql.
 *
 * They are security invoker, so the gate is the admin_all policy on
 * `feedback`: a caller who is not an admin finds nothing to act on. The
 * rules — client entries read-only, Mark as read once, an event the worker
 * was booked on — are in the database (feedback_guard() and the RPCs), so
 * a PATCH straight to the REST API meets the same refusals as this file.
 *
 * Every write revalidates the worker's profile as well as the inbox,
 * because each can move `staff.rating` (§6), which the profile header and
 * the directory both print.
 */

const NOT_CONFIGURED =
  'This environment has no Supabase project, so this cannot be saved. See docs/04-setup-github-vercel-supabase.md.';

/** See the roles actions: the generated types are still the placeholder. */
type RpcArguments = Record<string, string | number | null>;

interface RpcClient {
  rpc(
    fn: string,
    args: RpcArguments,
  ): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

/** The database's refusals, in the manager's words where the raw one is a code. */
function message(error: { message: string; code?: string }): string {
  if (error.message === 'unknown_feedback') return 'That entry no longer exists.';
  if (error.message === 'unknown_staff') return 'That worker could not be found.';
  return error.message;
}

function staffIdOf(data: unknown): string | null {
  if (data && typeof data === 'object' && 'staffId' in data) {
    const id = (data as { staffId: unknown }).staffId;
    return typeof id === 'string' ? id : null;
  }
  return null;
}

function refresh(staffId: string | null) {
  revalidatePath('/feedback');
  revalidatePath('/staff');
  if (staffId) revalidatePath(`/staff/${staffId}`);
}

async function call(
  fn: string,
  args: RpcArguments,
): Promise<{ data: unknown } | { error: string }> {
  if (!supabaseConfigured()) return { error: NOT_CONFIGURED };
  const supabase = createClient(await cookies()) as unknown as RpcClient;
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { error: message(error) };
  return { data };
}

/** §9.10 Mark as read — from here the entry counts toward the rating. */
export async function markRead(id: string): Promise<ActionResult> {
  const result = await call('mark_feedback_read', { p_id: id });
  if ('error' in result) return { ok: false, message: result.error };
  refresh(staffIdOf(result.data));
  return { ok: true };
}

export async function addOfficeFeedback(draft: OfficeDraft): Promise<ActionResult> {
  const invalid = validateDraft(draft);
  if (invalid) return { ok: false, message: invalid };

  const result = await call('add_office_feedback', {
    p_staff: draft.staffId,
    p_rating: draft.rating,
    p_text: draft.text.trim(),
    p_event: draft.eventId || null,
  });
  if ('error' in result) return { ok: false, message: result.error };
  refresh(draft.staffId);
  return { ok: true };
}

export async function updateOfficeFeedback(id: string, draft: OfficeDraft): Promise<ActionResult> {
  const invalid = validateDraft(draft);
  if (invalid) return { ok: false, message: invalid };

  const result = await call('update_office_feedback', {
    p_id: id,
    p_rating: draft.rating,
    p_text: draft.text.trim(),
    p_event: draft.eventId || null,
  });
  if ('error' in result) return { ok: false, message: result.error };
  refresh(staffIdOf(result.data) ?? draft.staffId);
  return { ok: true };
}

/**
 * An office entry at any time; a client entry only once the worker has
 * been removed, to redact a name if asked (§1.7). The database refuses the
 * rest — this does not re-check it.
 */
export async function deleteFeedback(id: string): Promise<ActionResult> {
  const result = await call('delete_feedback', { p_id: id });
  if ('error' in result) return { ok: false, message: result.error };
  refresh(staffIdOf(result.data));
  return { ok: true };
}

/**
 * The Worker typeahead. `staff_directory_v` already applies §1.7, and a
 * removed worker is left out: no new feedback can be added about one.
 */
export async function searchWorkers(q: string): Promise<WorkerOption[]> {
  const needle = q.trim();
  if (!supabaseConfigured() || needle.length < 2) return [];

  const supabase = createClient(await cookies());
  const escaped = needle.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { data } = await supabase
    .from('staff_directory_v')
    .select('id, display_name, employee_id, role_names, status')
    .eq('removed', false)
    .ilike('display_name', `%${escaped}%`)
    .order('display_name')
    .limit(8)
    .returns<
      {
        id: string;
        display_name: string;
        employee_id: number | null;
        role_names: string[];
        status: string;
      }[]
    >();

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.display_name,
    employee_id: row.employee_id,
    role_names: row.role_names ?? [],
    status: row.status,
  }));
}

/** The events a worker was booked on — the only ones an entry may name. */
export async function workerEvents(staffId: string): Promise<EventOption[]> {
  if (!supabaseConfigured() || !staffId) return [];

  const supabase = createClient(await cookies());
  const { data } = await supabase
    .from('staff_shift_history_v')
    .select('event_id, event_title, event_date, client_name')
    .eq('staff_id', staffId)
    .order('event_date', { ascending: false })
    .limit(60)
    .returns<
      { event_id: string; event_title: string; event_date: string; client_name: string | null }[]
    >();

  return (data ?? []).map((row) => ({
    id: row.event_id,
    title: row.event_title,
    date: row.event_date,
    client: row.client_name,
  }));
}
