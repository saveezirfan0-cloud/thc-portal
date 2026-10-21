'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@thc/db/server';
import {
  CRIMINAL_RECORDS_READ_ONLY,
  DECLARATION_MESSAGE_MAX,
  REVERSAL_NOTE_MAX,
} from '@thc/domain';
import { reviewErrorMessage } from './messages';
import { supabaseConfigured } from './data';
import type { ActionResult } from './types';

/**
 * The two declaration follow-ups (ADR-0180): Ask for more details on a
 * pending Yes, and Reverse rejection on a rejected one. Beside Verify and
 * Reject in ./actions.ts, and on the same terms: through the MANAGER'S OWN
 * SESSION, never the service key, so the reviewer is the audit stamp and
 * the database refuses anyone who is not an office reviewer allowed to
 * change things (assert_reviewer, office_can('write') — a viewer reads
 * only). The re-check, the unblock, the onboarding move and the pushes
 * all happen in the database.
 */

const NOT_CONFIGURED =
  'This environment has no Supabase project, so this cannot be saved. See docs/04-setup-github-vercel-supabase.md.';

/** The refusals these two RPCs add; anything else is the review queue's wording. */
const REFUSALS: [RegExp, string][] = [
  [/^message_required/, 'Write the message the worker is sent.'],
  [/^message_too_long/, `Keep the message under ${DECLARATION_MESSAGE_MAX} characters.`],
  [/^note_required/, 'A reversal needs a note — who reviewed it and why they can work.'],
  [/^note_too_long/, `Keep the note under ${REVERSAL_NOTE_MAX} characters.`],
  [/^not_rejected: verified/, 'This declaration is already verified.'],
  [
    /^not_rejected: superseded/,
    'The worker has already sent an updated declaration — review that one instead.',
  ],
  [/^not_rejected/, 'Only a rejected declaration can have its rejection reversed.'],
  [
    /^not_pending: details_requested/,
    'More details have already been asked for. Their updated declaration comes back to Needs review.',
  ],
  [
    /^not_pending: superseded/,
    'The worker has already sent an updated declaration — review that one instead.',
  ],
  [/^read_only/, 'Your office role can view this but not change it.'],
  [/^cannot_answer_from_app/, 'This person can’t answer from the app right now — call them.'],
  [/^not_criminal_records_reviewer/, CRIMINAL_RECORDS_READ_ONLY],
];

function refusal(raw: string): string {
  for (const [pattern, message] of REFUSALS) if (pattern.test(raw)) return message;
  return reviewErrorMessage(raw);
}

/** See ./actions.ts: the generated types are a placeholder. */
interface RpcClient {
  rpc(
    fn: string,
    args: Record<string, string>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

async function call(
  fn: string,
  args: Record<string, string>,
): Promise<{ data: Record<string, unknown> } | ActionResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const supabase = createClient(await cookies()) as unknown as RpcClient;
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, message: refusal(error.message) };
  revalidatePath('/compliance');
  revalidatePath('/staff', 'layout');
  revalidatePath('/onboarding', 'layout');
  return { data: (data ?? {}) as Record<string, unknown> };
}

/**
 * Ask for more details. The message reaches the worker word for word, as
 * a notification and in the app where they answer; the declaration leaves
 * Needs review until their updated one arrives.
 */
export async function requestDeclarationDetails(
  declarationId: string,
  message: string,
): Promise<ActionResult> {
  const text = message.trim();
  if (text === '') return { ok: false, message: 'Write the message the worker is sent.' };
  if (text.length > DECLARATION_MESSAGE_MAX) {
    return { ok: false, message: `Keep the message under ${DECLARATION_MESSAGE_MAX} characters.` };
  }
  const result = await call('compliance_request_declaration_details', {
    p_declaration: declarationId,
    p_message: text,
  });
  if ('ok' in result) return result;
  return {
    ok: true,
    message:
      result.data['source'] === 'in_employment'
        ? 'Sent. Their shifts stay paused; their updated declaration comes back to Needs review.'
        : 'Sent. Their updated declaration comes back to Needs review.',
  };
}

/**
 * Reverse rejection. Recorded with the reviewer and the note; the database
 * moves a candidate on, or lifts the block the rejection made and runs the
 * full compliance check.
 */
export async function reverseDeclarationRejection(
  declarationId: string,
  note: string,
): Promise<ActionResult> {
  const text = note.trim();
  if (text === '') {
    return {
      ok: false,
      message: 'A reversal needs a note — who reviewed it and why they can work.',
    };
  }
  if (text.length > REVERSAL_NOTE_MAX) {
    return { ok: false, message: `Keep the note under ${REVERSAL_NOTE_MAX} characters.` };
  }
  const result = await call('compliance_reverse_declaration_rejection', {
    p_declaration: declarationId,
    p_note: text,
  });
  if ('ok' in result) return result;
  return { ok: true, message: reversedMessage(result.data) };
}

function reversedMessage(data: Record<string, unknown>): string {
  if (data['advanced'] === true) {
    return 'Rejection reversed. The declaration is verified and they have moved on to the quiz.';
  }
  if (data['unblocked'] === true) {
    return 'Rejection reversed. Unblocked, and told their shifts are open again.';
  }
  if (data['status'] === 'blocked') {
    return data['liftedHold'] === true
      ? 'Rejection reversed. Still blocked until the rest of their compliance is in order — they are told when their shifts open again.'
      : 'Rejection reversed. They are still blocked for another reason — unblock them from their profile when that is resolved.';
  }
  return 'Rejection reversed. The declaration is verified.';
}

/**
 * May the signed-in office user decide a criminal declaration
 * (can_review_criminal_records(), 20261022170200)? Asked by the screens so
 * they draw Verify, Reject, Ask for more details and Reverse rejection only
 * for someone the database will let press them. Any failure is a no: the
 * declaration then reads as read-only, and the database decides anyway.
 */
export async function canReviewCriminalRecords(): Promise<boolean> {
  if (!supabaseConfigured()) return false;
  try {
    const supabase = createClient(await cookies()) as unknown as {
      rpc(fn: string): PromiseLike<{ data: unknown; error: { message: string } | null }>;
    };
    const { data, error } = await supabase.rpc('can_review_criminal_records');
    return !error && data === true;
  } catch {
    return false;
  }
}
