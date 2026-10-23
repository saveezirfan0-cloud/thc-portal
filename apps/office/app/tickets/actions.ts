'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@thc/db/server';
import { explainDbError } from '../_lib/dbError';
import { loadRunningTimer, supabaseConfigured, trackerAllowed } from './data';
import {
  COMMENT_MAX,
  NOTE_MAX,
  RESOLUTION_MAX,
  isActivity,
  isKind,
  isScopeLabel,
  isSeverity,
  isStatus,
  isWorker,
  parseDuration,
  validateDraft,
  type TicketDraft,
} from './view-model';
import type { ActionResult, RunningTimer } from './types';

/**
 * Writes for the Report button and /tickets (ADR-0202), through the three
 * RPCs in 20261024120000_tickets.sql. They are security definer and check
 * the caller themselves: a Back Office login reports and comments, a Viewer
 * is refused `read_only` (ADR-0060), and so is a status or severity change. Every rule —
 * the caps, the kinds, 20 reports an hour, who may change what — is in the
 * database, so a call that skips this file meets the same refusals.
 */

const NOT_CONFIGURED =
  'This environment has no Supabase project, so this cannot be saved. See docs/04-setup-github-vercel-supabase.md.';

type RpcArguments = Record<string, string | number | boolean | null>;

interface RpcClient {
  rpc(
    fn: string,
    args: RpcArguments,
  ): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

function message(error: { message: string; code?: string }): string {
  return explainDbError(error, {
    log: '[tickets]',
    codes: {
      too_many_tickets: 'That is 20 reports in the last hour. Wait a little, then send the next.',
      unknown_ticket: 'That ticket no longer exists.',
      unknown_time: 'That time entry no longer exists.',
      timer_running: 'A timer is already running. Stop it before starting another.',
      no_timer: 'No timer is running.',
      ticket_has_time:
        'This report has time logged against it, so it cannot be deleted. Close it instead.',
      not_permitted: 'Only the person who tracks tickets can do this.',
    },
  });
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

/** The Report button: log a ticket. `page` is where the reporter was. */
export async function createTicket(draft: TicketDraft, page: string): Promise<ActionResult> {
  const invalid = validateDraft(draft);
  if (invalid) return { ok: false, message: invalid };
  const result = await call('create_ticket', {
    p_kind: draft.kind,
    p_severity: draft.severity || null,
    p_title: draft.title.trim(),
    p_details: draft.details.trim() || null,
    p_page: page.slice(0, 500) || null,
    p_link: draft.link.trim() || null,
  });
  if ('error' in result) return { ok: false, message: result.error };
  revalidatePath('/tickets');
  const data = result.data as { ref?: unknown } | null;
  return { ok: true, ...(typeof data?.ref === 'string' ? { ref: data.ref } : {}) };
}

/** An update on a ticket's thread — a note, email, call, meeting or task; emailed to the owner's list. */
export async function addComment(
  ticketId: string,
  body: string,
  activity: string = 'note',
): Promise<ActionResult> {
  const text = body.trim();
  if (!text) return { ok: false, message: 'Write an update first.' };
  if (text.length > COMMENT_MAX) {
    return {
      ok: false,
      message: `An update is at most ${COMMENT_MAX.toLocaleString('en-GB')} characters.`,
    };
  }
  if (!isActivity(activity))
    return { ok: false, message: 'Choose note, email, call, meeting or task.' };
  const result = await call('add_ticket_comment', {
    p_ticket: ticketId,
    p_body: text,
    p_activity: activity,
  });
  if ('error' in result) return { ok: false, message: result.error };
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath('/tickets');
  return { ok: true };
}

/**
 * Status and / or severity (`none` clears it), with an optional note (a
 * comment, emailed) and, for Resolved or Closed, a resolution note that is
 * emailed to whoever reported it.
 */
export async function updateTicket(
  ticketId: string,
  change: { status?: string; severity?: string; note?: string; resolution?: string },
): Promise<ActionResult> {
  if (change.status && !isStatus(change.status)) {
    return { ok: false, message: 'Choose a status from the list.' };
  }
  if (change.severity && change.severity !== 'none' && !isSeverity(change.severity)) {
    return { ok: false, message: 'Choose a severity from the list.' };
  }
  if ((change.resolution?.trim().length ?? 0) > RESOLUTION_MAX) {
    return {
      ok: false,
      message: `A resolution note is at most ${RESOLUTION_MAX.toLocaleString('en-GB')} characters.`,
    };
  }
  const result = await call('update_ticket', {
    p_ticket: ticketId,
    p_status: change.status || null,
    p_severity: change.severity || null,
    p_note: change.note?.trim() || null,
    p_resolution: change.resolution?.trim() || null,
  });
  if ('error' in result) return { ok: false, message: result.error };
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath('/tickets');
  return { ok: true };
}

/** Re-file a ticket as a bug, request, idea, update or question. */
export async function setKind(ticketId: string, kind: string): Promise<ActionResult> {
  if (!isKind(kind)) return { ok: false, message: 'Choose a category from the list.' };
  const result = await call('set_ticket_kind', { p_ticket: ticketId, p_kind: kind });
  if ('error' in result) return { ok: false, message: result.error };
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath('/tickets');
  return { ok: true };
}

/** Give a ticket to a Back Office login, or to nobody (empty). */
export async function assignTicket(ticketId: string, assignee: string): Promise<ActionResult> {
  const result = await call('assign_ticket', { p_ticket: ticketId, p_assignee: assignee || null });
  if ('error' in result) return { ok: false, message: result.error };
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath('/tickets');
  return { ok: true };
}

/** Delete a report (owners; refused while time is logged on it). */
export async function deleteTicket(ticketId: string): Promise<ActionResult> {
  const result = await call('delete_ticket', { p_ticket: ticketId });
  if ('error' in result) return { ok: false, message: result.error };
  revalidatePath('/tickets');
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────
// The owner's internal tracking (ADR-0202). The database refuses anyone who
// is not a tracker, so these are safe to call from the screen as written.
// ──────────────────────────────────────────────────────────────────────

function refreshTicket(ticketId: string) {
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath('/tickets');
  revalidatePath('/tickets/time');
}

/** Label a ticket after it is raised; an empty label clears it. */
export async function setScope(
  ticketId: string,
  label: string,
  note: string,
): Promise<ActionResult> {
  if (label && !isScopeLabel(label)) return { ok: false, message: 'Choose a label from the list.' };
  if (note.trim().length > NOTE_MAX) {
    return { ok: false, message: `A note is at most ${NOTE_MAX} characters.` };
  }
  const result = await call('set_ticket_scope', {
    p_ticket: ticketId,
    p_label: label || null,
    p_note: note.trim() || null,
  });
  if ('error' in result) return { ok: false, message: result.error };
  refreshTicket(ticketId);
  return { ok: true };
}

/** Start the caller's timer on a ticket, worked by the owner or by claude. */
export async function startTimer(ticketId: string, workedBy: string): Promise<ActionResult> {
  if (!isWorker(workedBy)) return { ok: false, message: 'Choose who is working on it.' };
  const result = await call('start_ticket_timer', { p_ticket: ticketId, p_worked_by: workedBy });
  if ('error' in result) return { ok: false, message: result.error };
  refreshTicket(ticketId);
  return { ok: true };
}

/** Stop the caller's running timer; the time is logged. */
export async function stopTimer(note: string): Promise<ActionResult & { ticketId?: string }> {
  if (note.trim().length > NOTE_MAX) {
    return { ok: false, message: `A note is at most ${NOTE_MAX} characters.` };
  }
  const result = await call('stop_ticket_timer', { p_note: note.trim() || null });
  if ('error' in result) return { ok: false, message: result.error };
  const ticketId = (result.data as { ticketId?: unknown } | null)?.ticketId;
  if (typeof ticketId === 'string') refreshTicket(ticketId);
  return { ok: true, ...(typeof ticketId === 'string' ? { ticketId } : {}) };
}

export interface TimeDraft {
  /** "15", "1h 30m", "1.5h", "1:30" */
  duration: string;
  workedBy: string;
  /** YYYY-MM-DD, or empty for today (UK). */
  workedOn: string;
  note: string;
  billable: boolean | null;
}

function checkDraft(draft: TimeDraft): { minutes: number } | { error: string } {
  const minutes = parseDuration(draft.duration);
  if (minutes === null) {
    return { error: 'Enter a time like 15, 15m, 1h 30m, 1.5h or 1:30 (up to 24 hours).' };
  }
  if (!isWorker(draft.workedBy)) return { error: 'Choose who did the work.' };
  if (draft.note.trim().length > NOTE_MAX)
    return { error: `A note is at most ${NOTE_MAX} characters.` };
  return { minutes };
}

/** Log time by hand — the 5, 10, 15 minutes after an email. */
export async function logTime(ticketId: string, draft: TimeDraft): Promise<ActionResult> {
  const checked = checkDraft(draft);
  if ('error' in checked) return { ok: false, message: checked.error };
  const result = await call('log_ticket_time', {
    p_ticket: ticketId,
    p_minutes: checked.minutes,
    p_worked_by: draft.workedBy,
    p_worked_on: draft.workedOn || null,
    p_note: draft.note.trim() || null,
    p_billable: draft.billable,
  });
  if ('error' in result) return { ok: false, message: result.error };
  refreshTicket(ticketId);
  return { ok: true };
}

/** Correct a finished entry's time, who did it, the day, the note or whether it is billable. */
export async function editTime(
  ticketId: string,
  id: number,
  draft: TimeDraft,
): Promise<ActionResult> {
  const checked = checkDraft(draft);
  if ('error' in checked) return { ok: false, message: checked.error };
  if (!draft.workedOn) return { ok: false, message: 'Choose the day it was worked.' };
  const result = await call('update_ticket_time', {
    p_id: id,
    p_minutes: checked.minutes,
    p_worked_by: draft.workedBy,
    p_worked_on: draft.workedOn,
    p_note: draft.note.trim() || null,
    p_billable: draft.billable,
  });
  if ('error' in result) return { ok: false, message: result.error };
  refreshTicket(ticketId);
  return { ok: true };
}

export async function removeTime(ticketId: string, id: number): Promise<ActionResult> {
  const result = await call('delete_ticket_time', { p_id: id });
  if ('error' in result) return { ok: false, message: result.error };
  refreshTicket(ticketId);
  return { ok: true };
}

/**
 * For the top bar's timer chip: is this login a tracker, and is a timer
 * running? Anyone else gets `{ allowed: false }` and nothing is drawn.
 */
export async function runningTimer(): Promise<{ allowed: boolean; timer: RunningTimer | null }> {
  if (!supabaseConfigured()) return { allowed: false, timer: null };
  const supabase = createClient(await cookies()) as unknown as Parameters<typeof trackerAllowed>[0];
  if (!(await trackerAllowed(supabase))) return { allowed: false, timer: null };
  return { allowed: true, timer: await loadRunningTimer(supabase) };
}
