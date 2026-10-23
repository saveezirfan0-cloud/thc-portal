'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@thc/db/server';
import { explainDbError } from '../_lib/dbError';
import { supabaseConfigured } from './data';
import { COMMENT_MAX, isSeverity, isStatus, validateDraft, type TicketDraft } from './view-model';
import type { ActionResult } from './types';

/**
 * Writes for the Report button and /tickets (ADR-0199), through the three
 * RPCs in 20261024120000_tickets.sql. They are security definer and check
 * the caller themselves: any Back Office login may report and comment (a
 * Viewer too); changing a status or severity needs `write`. Every rule —
 * the caps, the kinds, 20 reports an hour, who may change what — is in the
 * database, so a call that skips this file meets the same refusals.
 */

const NOT_CONFIGURED =
  'This environment has no Supabase project, so this cannot be saved. See docs/04-setup-github-vercel-supabase.md.';

type RpcArguments = Record<string, string | number | null>;

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

/** A comment on a ticket's thread; emailed. */
export async function addComment(ticketId: string, body: string): Promise<ActionResult> {
  const text = body.trim();
  if (!text) return { ok: false, message: 'Write a comment first.' };
  if (text.length > COMMENT_MAX) {
    return {
      ok: false,
      message: `A comment is at most ${COMMENT_MAX.toLocaleString('en-GB')} characters.`,
    };
  }
  const result = await call('add_ticket_comment', { p_ticket: ticketId, p_body: text });
  if ('error' in result) return { ok: false, message: result.error };
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath('/tickets');
  return { ok: true };
}

/** Status and / or severity, with an optional note (a comment, emailed). */
export async function updateTicket(
  ticketId: string,
  change: { status?: string; severity?: string; note?: string },
): Promise<ActionResult> {
  if (change.status && !isStatus(change.status)) {
    return { ok: false, message: 'Choose a status from the list.' };
  }
  if (change.severity && !isSeverity(change.severity)) {
    return { ok: false, message: 'Choose a severity from the list.' };
  }
  const result = await call('update_ticket', {
    p_ticket: ticketId,
    p_status: change.status || null,
    p_severity: change.severity || null,
    p_note: change.note?.trim() || null,
  });
  if ('error' in result) return { ok: false, message: result.error };
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath('/tickets');
  return { ok: true };
}
