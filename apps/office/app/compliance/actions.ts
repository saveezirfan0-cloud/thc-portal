'use server';

import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@thc/db/server';
import { createAdminClient } from '@thc/db/admin';
import { evidenceFileProblem } from '@thc/domain';
import { reviewErrorMessage, uploadRefusal } from './messages';
import { supabaseConfigured } from './data';
import { visaLimitProblem, visaLimitValue } from './conditions';
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
type RpcArguments = Record<string, string | number | boolean | null>;
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
  revalidatePath('/staff', 'layout');
  revalidatePath('/onboarding', 'layout');
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

/**
 * What the reviewer confirms beside the document (conditions.ts): the course
 * level of a student (D32) or a work or dependant visa's weekly hours limit
 * (D36). Saved after the Verify, each audited on its own.
 */
export interface VerifyConditions {
  staffId: string;
  belowDegreeLevel?: boolean;
  /** Typed as the reviewer typed it: empty for "no limit on the visa". */
  visaHourLimit?: string;
}

/** Verify. Reports the full compliance re-check's answer rather than hiding it. */
export async function verifyDocument(
  docId: string,
  dates: VerifyDates = {},
  conditions?: VerifyConditions,
): Promise<ActionResult> {
  if (conditions?.visaHourLimit !== undefined) {
    const problem = visaLimitProblem(conditions.visaHourLimit);
    if (problem) return { ok: false, message: problem };
  }
  const args: RpcArguments = { p_doc: docId };
  if (dates.expiry) args['p_expiry'] = dates.expiry;
  if (dates.rightToWorkUntil) args['p_right_to_work_until'] = dates.rightToWorkUntil;
  const result = await call('compliance_verify_document', args);
  if (isFailure(result)) return result;
  const saved = conditions ? await saveConditions(conditions) : '';
  const verified = verifiedMessage(result, dates);
  return verified.ok
    ? { ok: true, message: `${verified.message ?? 'Verified.'}${saved}` }
    : verified;
}

async function saveConditions(conditions: VerifyConditions): Promise<string> {
  const parts: string[] = [];
  if (conditions.belowDegreeLevel !== undefined) {
    const saved = await setBelowDegreeLevel(conditions.staffId, conditions.belowDegreeLevel);
    parts.push(saved.ok ? (saved.message ?? '') : `Course level not saved: ${saved.message}`);
  }
  if (conditions.visaHourLimit !== undefined) {
    const saved = await setVisaHourLimit(conditions.staffId, conditions.visaHourLimit);
    parts.push(saved.ok ? (saved.message ?? '') : `Visa hours limit not saved: ${saved.message}`);
  }
  const text = parts.filter(Boolean).join(' ');
  return text ? ` ${text}` : '';
}

function verifiedMessage(result: { data: unknown }, dates: VerifyDates): ActionResult {
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

/**
 * The course level of a student (D32, ADR-0037): below degree level, the
 * Student visa allows 10 hours a week in term time instead of 20.
 */
export async function setBelowDegreeLevel(staffId: string, below: boolean): Promise<ActionResult> {
  const result = await call('compliance_set_below_degree_level', {
    p_staff: staffId,
    p_below: below,
  });
  if (isFailure(result)) return result;
  const data = (result.data ?? {}) as { changed?: boolean; capHours?: number | null };
  if (!data.changed) return { ok: true, message: '' };
  return {
    ok: true,
    message: below
      ? 'Course recorded as below degree level: 10 h a week in term time.'
      : 'Course recorded as degree level or above: 20 h a week in term time.',
  };
}

/** A work or dependant visa's weekly hours limit (D36). Empty clears it. */
export async function setVisaHourLimit(staffId: string, typed: string): Promise<ActionResult> {
  const problem = visaLimitProblem(typed);
  if (problem) return { ok: false, message: problem };
  const hours = visaLimitValue(typed);
  const result = await call('compliance_set_visa_hour_limit', { p_staff: staffId, p_hours: hours });
  if (isFailure(result)) return result;
  const data = (result.data ?? {}) as { changed?: boolean };
  if (!data.changed) return { ok: true, message: '' };
  return {
    ok: true,
    message:
      hours === null
        ? 'No hours limit on the visa.'
        : `Visa hours limit recorded: ${hours} h a week — the 48-hour opt-out cannot lift it.`,
  };
}

/**
 * What the reviewer needs beside a worker's document and cannot read off the
 * document row: the full NI number (D43) and the two conditions (D32, D36).
 * Read through the manager's own session, so RLS decides.
 */
export interface ReviewFacts {
  niNumber: string | null;
  belowDegreeLevel: boolean;
  visaHourLimit: number | null;
}

interface FactsRead {
  from(table: 'staff'): {
    select(columns: string): {
      eq(
        column: 'id',
        value: string,
      ): {
        maybeSingle(): PromiseLike<{
          data: {
            ni_number: string | null;
            below_degree_level: boolean | null;
            visa_weekly_hour_limit: number | null;
          } | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
}

export async function reviewFacts(
  staffId: string,
): Promise<{ ok: true; facts: ReviewFacts } | { ok: false; message: string }> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const supabase = createClient(await cookies()) as unknown as FactsRead;
  const { data, error } = await supabase
    .from('staff')
    .select('ni_number, below_degree_level, visa_weekly_hour_limit')
    .eq('id', staffId)
    .maybeSingle();
  if (error) return { ok: false, message: error.message };
  return {
    ok: true,
    facts: {
      niNumber: data?.ni_number ?? null,
      belowDegreeLevel: data?.below_degree_level === true,
      visaHourLimit: data?.visa_weekly_hour_limit ?? null,
    },
  };
}

/**
 * The NI check (D43): NI evidence verified before the number was entered,
 * compared now that it has been. A mismatch needs a reason — the worker is
 * sent it in N8 and asked to re-upload.
 */
export async function resolveNiCheck(
  docId: string,
  matches: boolean,
  reason = '',
): Promise<ActionResult> {
  if (!matches && reason.trim() === '')
    return { ok: false, message: 'Say what does not match — the worker is sent it.' };
  const result = await call('compliance_resolve_ni_check', {
    p_doc: docId,
    p_matches: matches,
    p_reason: matches ? null : reason.trim(),
  });
  if (isFailure(result)) return result;
  return {
    ok: true,
    message: matches
      ? 'Recorded: the NI number matches the evidence.'
      : 'NI evidence rejected. The worker has been asked to re-upload.',
  };
}

/** Reject. The reason goes to the worker word for word in N8. */
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
 * The "Right-to-work date missing — re-verify" row (20260927160000): the
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

// ---------------------------------------------------------------------
// The office's uploads (D47 completion letter, D31 gov.uk report)
//
// The documents bucket is service-role only, so an upload is two steps, as
// in the Staff App: the service key issues a one-object signed upload for a
// name THIS server chose — after checking the caller is the office — and the
// browser sends the bytes straight to Storage (a server action takes 1 MB,
// the rule allows 10). The RPC then judges what Storage recorded, through
// the manager's own session, and refuses anything else.
// ---------------------------------------------------------------------

export type OfficeUploadFolder = 'completion-letter' | 'share-code-report';
export type OfficeUploadSlot =
  { ok: true; path: string; token: string } | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function isOffice(): Promise<boolean> {
  const supabase = createClient(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return false;
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', auth.user.id)
    .maybeSingle<{ role: string }>();
  return profile?.role === 'admin';
}

function serviceClient(): ReturnType<typeof createAdminClient> | null {
  try {
    return createAdminClient();
  } catch {
    return null;
  }
}

const NO_SERVICE_KEY = 'Set SUPABASE_SERVICE_ROLE_KEY for the Back Office to upload documents.';

export async function startOfficeUpload(
  staffId: string,
  folder: OfficeUploadFolder,
  file: { name: string; type: string; size: number },
): Promise<OfficeUploadSlot> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  if (!UUID.test(staffId)) return { ok: false, message: uploadRefusal('invalid_path') };
  if (folder !== 'completion-letter' && folder !== 'share-code-report') {
    return { ok: false, message: uploadRefusal('invalid_path') };
  }
  const problem = evidenceFileProblem(file);
  if (problem) return { ok: false, message: uploadRefusal(problem) };
  if (!(await isOffice())) return { ok: false, message: reviewErrorMessage('not_authorised') };
  const admin = serviceClient();
  if (!admin) return { ok: false, message: NO_SERVICE_KEY };

  const ext = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase();
  const path = `${staffId}/${folder}/${randomUUID()}.${ext}`;
  const { data, error } = await admin.storage.from('documents').createSignedUploadUrl(path);
  if (error || !data) return { ok: false, message: uploadRefusal('invalid_path') };
  return { ok: true, path: data.path, token: data.token };
}

/** Removes a refused upload — only a fresh object nothing references (evidence_path_discardable). */
async function discard(staffId: string, path: string): Promise<void> {
  const admin = serviceClient();
  if (!admin) return;
  const { data } = await admin.rpc(
    'evidence_path_discardable' as never,
    { p_staff: staffId, p_path: path } as never,
  );
  if (data === true) await admin.storage.from('documents').remove([path]);
}

export interface OfficeCompletionLetter {
  staffId: string;
  path: string;
  completionDate: string;
  form: 'letter' | 'transcript' | 'university_email';
  institution?: string;
}

/** D47: the office's completion-letter upload. Lands pending — Approve confirms the dates. */
export async function submitOfficeCompletionLetter(
  input: OfficeCompletionLetter,
): Promise<ActionResult> {
  if (!input.path.startsWith(`${input.staffId}/completion-letter/`)) {
    return { ok: false, message: uploadRefusal('invalid_path') };
  }
  if (!input.completionDate)
    return { ok: false, message: uploadRefusal('completion_date_required') };
  const result = await call('office_submit_completion_letter', {
    p_staff: input.staffId,
    p_file_path: input.path,
    p_completion_date: input.completionDate,
    p_evidence_form: input.form,
    p_awarding_institution: input.institution?.trim() || null,
  });
  if (isFailure(result)) {
    await discard(input.staffId, input.path);
    return result;
  }
  const data = (result.data ?? {}) as { ok?: boolean; reason?: string };
  if (!data.ok) {
    await discard(input.staffId, input.path);
    return { ok: false, message: uploadRefusal(data.reason) };
  }
  return {
    ok: true,
    message:
      'Uploaded. It is waiting in Needs review: approve it there with the completion date and the visa expiry — the weekly limit changes only then.',
  };
}

/** D31: the gov.uk report the office downloaded, attached to a hand-verified share code. */
export async function attachRtwReport(
  docId: string,
  staffId: string,
  path: string,
): Promise<ActionResult> {
  if (!path.startsWith(`${staffId}/share-code-report/`)) {
    return { ok: false, message: uploadRefusal('invalid_path') };
  }
  const result = await call('compliance_attach_rtw_report', { p_doc: docId, p_path: path });
  if (isFailure(result)) {
    await discard(staffId, path);
    return result;
  }
  const data = (result.data ?? {}) as { ok?: boolean; reason?: string };
  if (!data.ok) {
    await discard(staffId, path);
    return { ok: false, message: uploadRefusal(data.reason) };
  }
  return { ok: true, message: 'gov.uk report attached to the share code.' };
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
