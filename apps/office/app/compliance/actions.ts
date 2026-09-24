'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@thc/db/server';
import { reviewErrorMessage } from './messages';
import { supabaseConfigured } from './data';
import type { ActionResult } from './types';

/**
 * The office's review actions (§4.1, §10.7, completion letter requirement
 * §2.2).
 *
 * Every one goes through the MANAGER'S OWN SESSION, never the service key:
 * the reviewer's identity is part of the record (§1.8 audit stamp,
 * requirement §4 "reviewer identity"), and each RPC refuses a caller who is
 * not an admin with a profile behind them. Nothing here decides anything —
 * the §4.3 re-check, the N8/N15 pushes and the cap all happen in the
 * database, whichever screen pressed the button.
 */

const NOT_CONFIGURED =
  'This environment has no Supabase project, so this cannot be saved. See docs/04-setup-github-vercel-supabase.md.';

/** See apps/office/app/staff/[id]/actions.ts: the generated types are a placeholder. */
type RpcArguments = Record<string, string | null>;
interface RpcClient {
  rpc(
    fn: string,
    args: RpcArguments,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

async function call(fn: string, args: RpcArguments): Promise<{ data: unknown } | ActionResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const supabase = createClient(await cookies()) as unknown as RpcClient;
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, message: reviewErrorMessage(error.message) };
  revalidatePath('/compliance');
  revalidatePath('/staff');
  return { data };
}

function isFailure(result: { data: unknown } | ActionResult): result is ActionResult {
  return 'ok' in result;
}

/**
 * The date a right-to-work document is verified on (20260923200000): the
 * expiry of a visa or status document, or the right-to-work-until of a share
 * code report — `NO_TIME_LIMIT` for EU settled status. The database refuses
 * those three documents without it.
 */
export interface VerifyDates {
  expiry?: string | null;
  rightToWorkUntil?: string | null;
}

/** §4.1 Verify. Reports the §4.3 re-check's answer rather than hiding it. */
export async function verifyDocument(
  docId: string,
  dates: VerifyDates = {},
): Promise<ActionResult> {
  const args: RpcArguments = { p_doc: docId };
  if (dates.expiry) args['p_expiry'] = dates.expiry;
  if (dates.rightToWorkUntil) args['p_right_to_work_until'] = dates.rightToWorkUntil;
  const result = await call('compliance_verify_document', args);
  if (isFailure(result)) return result;
  const data = (result.data ?? {}) as {
    unblocked?: boolean;
    status?: string;
    blockers?: string[];
    rightToWorkUntil?: string | null;
  };
  const rtw =
    dates.expiry || dates.rightToWorkUntil
      ? data.rightToWorkUntil
        ? ` Right to work until ${ukDate(data.rightToWorkUntil)} — no shift after it can be rostered.`
        : ' Right to work: no time limit on file.'
      : '';
  if (data.unblocked)
    return { ok: true, message: `Verified. Everything is in order — unblocked.${rtw}` };
  if (data.status === 'blocked' && data.blockers?.length) {
    return {
      ok: true,
      message: `Verified. Still blocked: ${data.blockers.map(blockerLabel).join(', ')}.${rtw}`,
    };
  }
  return { ok: true, message: `Verified.${rtw}` };
}

/** §4.1 Reject. The reason goes to the worker word for word in N8. */
export async function rejectDocument(docId: string, reason: string): Promise<ActionResult> {
  if (reason.trim() === '')
    return { ok: false, message: 'A rejection needs a reason — the worker is sent it.' };
  const result = await call('compliance_reject_document', {
    p_doc: docId,
    p_reason: reason.trim(),
  });
  if (isFailure(result)) return result;
  return { ok: true, message: 'Rejected. The worker has been asked to re-upload.' };
}

/**
 * Completion letter requirement §2.2: the reviewer confirms the completion
 * date and the visa expiry. Both are required here and again in the database.
 */
export async function approveCompletionLetter(
  docId: string,
  completionDate: string,
  visaExpiry: string,
): Promise<ActionResult> {
  if (!completionDate) return { ok: false, message: 'Confirm the course completion date.' };
  if (!visaExpiry) return { ok: false, message: 'Confirm the visa expiry date.' };
  const result = await call('approve_completion_letter', {
    p_doc: docId,
    p_completion_date: completionDate,
    p_visa_expiry: visaExpiry,
  });
  if (isFailure(result)) return result;
  const data = (result.data ?? {}) as {
    effectiveFrom?: string;
    capHours?: number | null;
    visaExpiry?: string;
    visaDiscrepancy?: boolean;
    releaseBlockedByVisa?: boolean;
  };
  if (data.releaseBlockedByVisa) {
    return {
      ok: true,
      message: `Approved — but the right to work ends ${ukDate(data.visaExpiry)}, before the release would start, so the hours do not change.`,
    };
  }
  const cap = data.capHours === null ? 'no weekly limit' : `${data.capHours ?? 48} h/week`;
  const discrepancy = data.visaDiscrepancy
    ? ` The visa expiry on file differs; the earlier date (${ukDate(data.visaExpiry)}) is kept.`
    : '';
  return {
    ok: true,
    message: `Approved: ${cap} from ${ukDate(data.effectiveFrom)}.${discrepancy}`,
  };
}

/**
 * The "Right-to-work date missing — re-verify" row (20260926100400): the
 * share code report is already verified, only the date was never written
 * down. The reviewer re-runs the gov.uk check and confirms the date it
 * shows — or `NO_TIME_LIMIT` for settled status on the EU branch, and
 * nowhere else. The status does not change, so no re-check and no N8; the
 * worker's date follows through the same trigger Verify uses.
 */
export async function confirmRtwDate(
  docId: string,
  rightToWorkUntil: string,
): Promise<ActionResult> {
  if (!rightToWorkUntil) return { ok: false, message: 'Confirm the right-to-work date.' };
  const result = await call('compliance_confirm_rtw_date', {
    p_doc: docId,
    p_right_to_work_until: rightToWorkUntil,
  });
  if (isFailure(result)) return result;
  const data = (result.data ?? {}) as { noTimeLimit?: boolean; rightToWorkUntil?: string | null };
  if (data.noTimeLimit) {
    return { ok: true, message: 'Confirmed: settled status, no time limit on the right to work.' };
  }
  return {
    ok: true,
    message: `Confirmed. Right to work until ${ukDate(data.rightToWorkUntil ?? rightToWorkUntil)} — no shift after it can be rostered, and the reminder ladder counts down to it.`,
  };
}

/** §10.7 Verify on a Yes declaration. */
export async function verifyDeclaration(declarationId: string): Promise<ActionResult> {
  const result = await call('compliance_verify_declaration', {
    p_declaration: declarationId,
    p_note: null,
  });
  if (isFailure(result)) return result;
  const data = (result.data ?? {}) as { unblocked?: boolean };
  return {
    ok: true,
    message: data.unblocked
      ? 'Verified. Unblocked, and told their shifts are open again.'
      : 'Verified.',
  };
}

/** §10.7 Reject. The reason is kept on the manual block; the worker is not pushed. */
export async function rejectDeclaration(
  declarationId: string,
  reason: string,
): Promise<ActionResult> {
  if (reason.trim() === '') return { ok: false, message: 'A rejection needs a reason.' };
  const result = await call('compliance_reject_declaration', {
    p_declaration: declarationId,
    p_reason: reason.trim(),
  });
  if (isFailure(result)) return result;
  return { ok: true, message: 'Rejected.' };
}

function ukDate(iso: string | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

function blockerLabel(reason: string): string {
  const [kind, doc] = reason.split(':');
  const name = (doc ?? '').replace(/_/g, ' ');
  if (kind === 'document_expired') return `${name} expired`;
  if (kind === 'document_unverified') return `${name} not yet verified`;
  if (kind === 'conviction_unreviewed') return 'criminal declaration under review';
  return reason;
}
