'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@thc/db/server';
import { reviewErrorMessage } from './messages';
import { supabaseConfigured } from './data';
import { READ_ONLY_MESSAGE, officeMayWrite, sessionIsAdmin } from '../_lib/sessionRole';
import type { ActionResult } from './types';

/**
 * Withdrawing a completion letter's approval (ADR-0183) — when the course
 * turns out not to be over. Correcting a verified term letter's periods is
 * ADR-0178's setTermLetterPeriods (./actions.ts).
 *
 * Through the MANAGER'S OWN SESSION: the database names who did it in the
 * audit row and refuses anyone who is not the office (assert_reviewer; a
 * viewer meets office_read_only). Nothing is decided here beyond refusing
 * what the database would refuse anyway, in the same words.
 */

const NOT_CONFIGURED =
  'This environment has no Supabase project, so this cannot be saved. See docs/04-setup-github-vercel-supabase.md.';

type RpcArguments = Record<string, string>;
interface RpcClient {
  rpc(
    fn: string,
    args: RpcArguments,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

async function call(fn: string, args: RpcArguments): Promise<{ data: unknown } | ActionResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const session = createClient(await cookies());
  // A read-only login (ADR-0060) is told so before anything is sent; the
  // database refuses it anyway (office_read_only, assert_reviewer).
  if (!(await officeMayWrite(session))) {
    return {
      ok: false,
      message: (await sessionIsAdmin(session))
        ? READ_ONLY_MESSAGE
        : reviewErrorMessage('not_authorised'),
    };
  }
  const supabase = session as unknown as RpcClient;
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, message: reviewErrorMessage(error.message) };
  revalidatePath('/compliance');
  revalidatePath('/staff', 'layout');
  revalidatePath('/onboarding', 'layout');
  return { data };
}

const NOTE_LIMIT = 500;

/**
 * "Withdraw approval" on a verified completion letter: the graduation is
 * undone and the term letter decides the weekly limit again. The worker
 * is not sent a rejection.
 */
export async function withdrawCompletionApproval(
  docId: string,
  reason: string,
): Promise<ActionResult> {
  if (reason.trim() === '') return { ok: false, message: 'Say why the approval is withdrawn.' };
  if (reason.trim().length > NOTE_LIMIT) {
    return { ok: false, message: `Keep the reason to ${NOTE_LIMIT} characters.` };
  }
  const result = await call('compliance_withdraw_completion_approval', {
    p_doc: docId,
    p_reason: reason.trim(),
  });
  if ('ok' in result) return result;
  const data = (result.data ?? {}) as { termLetterId?: string | null; withdrawnCount?: number };
  const count = (data.withdrawnCount ?? 1) > 1 ? ` (${data.withdrawnCount} approved letters)` : '';
  return {
    ok: true,
    message: data.termLetterId
      ? `Approval withdrawn${count}. Their term letter decides the weekly limit again — check its dates are right.`
      : `Approval withdrawn${count}. There is no current term letter on file: ask the worker to upload one.`,
  };
}

/**
 * "Not needed — graduated" on a pending or rejected Term Dates Letter
 * (ADR-0213, TK-19): someone who has told us their course is over needs no
 * term letter, so it leaves Needs review as superseded — with no message to
 * the worker, unlike Reject, whose N8 would ask them for the wrong document.
 */
export async function setAsideTermLetter(docId: string): Promise<ActionResult> {
  const result = await call('compliance_set_aside_term_letter', { p_doc: docId });
  if ('ok' in result) return result;
  return {
    ok: true,
    message:
      'Set aside as not needed. Nothing was sent to the worker — their app asks for a Completion Letter instead.',
  };
}
