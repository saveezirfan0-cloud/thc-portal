'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@thc/db/server';
import { reviewErrorMessage } from './messages';
import { supabaseConfigured } from './data';
import { READ_ONLY_MESSAGE, officeMayWrite, sessionIsAdmin } from '../_lib/sessionRole';
import { termDatesPayload, termDatesPayloadProblem } from './termDates';
import type { Period } from './termDates';
import type { ActionResult } from './types';

/**
 * Correcting a letter the office has already decided (ADR-0178): the
 * holiday periods on a worker's current verified University Term Dates
 * Letter, and the approval of an Official University Completion Letter.
 *
 * Both go through the MANAGER'S OWN SESSION: the database names who did it
 * in the audit row, and refuses anyone who is not an owner or a manager
 * (`assert_letter_editor`). Nothing is decided here beyond refusing what
 * the database would refuse anyway, in the same words.
 */

const NOT_CONFIGURED =
  'This environment has no Supabase project, so this cannot be saved. See docs/04-setup-github-vercel-supabase.md.';

type RpcArguments = Record<string, string | boolean | string[]>;
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
  // database refuses it anyway (office_read_only, assert_letter_editor).
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

/** `2027-01-17` → `17.01.2027`. */
function shown(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

/**
 * "Correct term dates" on the current verified term letter. Same rules as
 * Verify: complete, ordered, real periods; none at all only when ticked.
 */
export async function correctTermDates(
  docId: string,
  periods: readonly Period[],
  note: string,
  noHolidays = false,
): Promise<ActionResult> {
  const problem = termDatesPayloadProblem(periods, noHolidays);
  if (problem) return { ok: false, message: problem };
  if (note.trim() === '') return { ok: false, message: 'Say why the dates are being corrected.' };
  if (note.trim().length > NOTE_LIMIT) {
    return { ok: false, message: `Keep the note to ${NOTE_LIMIT} characters.` };
  }
  const result = await call('compliance_correct_term_dates', {
    p_doc: docId,
    p_term_dates: termDatesPayload(periods),
    p_note: note.trim(),
    p_no_holidays: periods.length === 0 && noHolidays,
  });
  if ('ok' in result) return result;
  const data = (result.data ?? {}) as { expiresOn?: string; unblocked?: boolean };
  return {
    ok: true,
    message: `Term dates corrected. The letter now expires ${shown(data.expiresOn)}; the weekly limit and the reminders follow the new dates.${
      data.unblocked ? ' The expiry block is lifted — everything else is in order.' : ''
    }`,
  };
}

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
