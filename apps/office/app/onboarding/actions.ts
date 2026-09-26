'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@thc/db/server';
import { createAdminClient } from '@thc/db/admin';
import { sessionIsAdmin } from '../_lib/sessionRole';
import { supabaseConfigured } from '../staff/data';
import { periodToRange, periodsProblem } from './view-model';
import { acceptWithAccount, resendActivation } from './activation';
import { reviewErrorMessage } from '../compliance/messages';
import type { AcceptRpc, AdminAuth, ResendRpc } from './activation';
import type { Period } from './view-model';
import type { ActionResult } from './types';

/**
 * Writes for /onboarding and /onboarding/:id (§2.2, §2.3, §2.4, §2.12).
 *
 * Every write is one RPC from 20260923110000_onboarding_pipeline.sql,
 * called through the SESSION client. Each is `security definer` and
 * refuses a caller whose own profile is not an admin, so the gate is the
 * database's and not this file's — a request crafted around the screen
 * meets the same refusal. None of those RPCs is reached with the service
 * key.
 *
 * Two things do need the service key, and `asAdmin()` below is what stands
 * between that key and the caller in both. Opening a document: the
 * `documents` bucket is deny-all to every signed-in role (20260922183015),
 * so a signed URL can only be minted with it. And Accept: the candidate's
 * login is created through the GoTrue Admin API (activation.ts) — the
 * database write that follows is still the session client's.
 */

const NOT_CONFIGURED =
  'This environment has no Supabase project, so this cannot be saved. See docs/04-setup-github-vercel-supabase.md.';

type RpcArguments = Record<string, string | number | boolean | null | string[]>;

interface RpcClient {
  rpc(fn: string, args: RpcArguments): PromiseLike<{ error: { message: string } | null }>;
}

/** The database's refusals, in words a manager can act on. */
const MESSAGES: Record<string, string> = {
  not_authorised: 'Only the office can do this.',
  roles_required: 'Pick at least one role type before accepting.',
  reason_required: 'A reason is required.',
  activation_link_required:
    'The activation link could not be built — set NEXT_PUBLIC_STAFF_URL for the Back Office.',
  term_dates_invalid: 'Every period needs a start and an end date.',
  already_resolved: 'This entry has already been dealt with.',
  // Accept's login (§1.4, §2.7) — activation.ts and 20260923180000.
  account_service_key:
    'The candidate’s login could not be created — set SUPABASE_SERVICE_ROLE_KEY for the Back Office.',
  account_missing:
    'The login linked to this candidate no longer exists. Ask a developer to check the account before accepting.',
  account_not_staff:
    'This email address already belongs to an office or client login, so it cannot be used for a worker. Ask the candidate for another address.',
  account_link_failed: 'The activation link could not be created. Try again in a minute.',
  account_role_failed: 'The candidate’s login could not be set up for the Staff App. Try again.',
  account_email_mismatch:
    'The login found for this candidate is under a different email address. Check the email on the profile.',
  staff_linked_elsewhere:
    'This candidate is already linked to a different login. Ask a developer to check before accepting.',
  account_linked_elsewhere:
    'This email address’s login already belongs to another staff record — possibly a duplicate. Check before accepting.',
  activation_link_not_personal:
    'The activation link could not be built — set NEXT_PUBLIC_STAFF_URL for the Back Office.',
  // Resend activation link (20260924110000)
  not_accepted:
    'There is no activation link to resend yet — the candidate receives it when they are accepted.',
  not_resendable: 'A rejected or inactive person is not sent an activation link.',
  already_activated:
    'This person has already activated their account. If they have forgotten their password, they can reset it from the Staff App sign-in page.',
  unknown_staff: 'This person no longer exists — refresh the page.',
};

function explain(message: string): string {
  const code = message.split(':')[0]?.trim() ?? '';
  if (MESSAGES[code]) return MESSAGES[code];
  if (code === 'resend_too_soon') {
    const at = message.split(':').slice(1).join(':').trim();
    return `A new link was sent less than 10 minutes ago. You can send another${at ? ` after ${at} (UK time)` : ' shortly'}.`;
  }
  if (code === 'not_resettable') {
    return 'Reset to candidate is only possible on a blocked, rejected or inactive record.';
  }
  if (code === 'not_under_review') return 'This item is no longer under review — refresh the page.';
  if (code === 'not_awaiting_decision') return 'The interview is not marked complete yet.';
  if (code === 'not_a_candidate')
    return 'This person has signed their contract — use Block on the staff profile.';
  if (code === 'illegal_staff_transition')
    return `Not allowed by the onboarding state machine (${message}).`;
  // Verify and Reject are the Compliance queue's functions underneath
  // (20260923200000), so their refusals read the same on both screens.
  return reviewErrorMessage(message);
}

async function call(fn: string, args: RpcArguments, paths: string[]): Promise<ActionResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const supabase = createClient(await cookies()) as unknown as RpcClient;
  const { error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, message: explain(error.message) };
  for (const path of paths) revalidatePath(path);
  return { ok: true };
}

function paths(staffId: string): string[] {
  return ['/onboarding', `/onboarding/${staffId}`];
}

/**
 * Where E3's links point. The Staff App is a different deployment from
 * the Back Office, so its origin is configuration — the same variable the
 * Staff App's own password-reset link reads. Locally it is :3001.
 */
function staffOrigin(): string | null {
  const explicit = process.env['NEXT_PUBLIC_STAFF_URL'];
  if (explicit) return explicit.replace(/\/$/, '');
  if (process.env.NODE_ENV === 'production') return null;
  return 'http://127.0.0.1:3001';
}

// ---------------------------------------------------------------------
// The candidate (§2.3, §2.4)
// ---------------------------------------------------------------------

/**
 * Accept — move to Documents (§2.4, BO4 phase 2). The role type(s) are
 * mandatory at this point; E3 goes to the candidate with their personal
 * activation link, `/activate/:token` (§2.7, §2.8).
 *
 * The one write on this page that needs the service key: the candidate's
 * login is created (or reused) through the GoTrue Admin API before the
 * database is asked to accept, because E3 must carry that login's
 * one-time token. activation.ts has the order and the reasons. The
 * manager is checked here FIRST, and the database checks again inside
 * `onboarding_accept_with_account` — which also links `staff.user_id` in
 * the same transaction as E3, so neither exists without the other.
 */
export async function acceptCandidate(
  staffId: string,
  roleIds: string[],
  note: string,
): Promise<ActionResult> {
  if (roleIds.length === 0) return { ok: false, message: MESSAGES.roles_required! };
  const origin = staffOrigin();
  if (!origin) return { ok: false, message: MESSAGES.activation_link_required! };
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  if (!(await asAdmin())) return { ok: false, message: MESSAGES.not_authorised! };

  const supabase = createClient(await cookies());
  const { data: candidate, error: readError } = await supabase
    .from('staff')
    .select('id, email, user_id, status')
    .eq('id', staffId)
    .maybeSingle<{ id: string; email: string; user_id: string | null; status: string }>();
  if (readError) return { ok: false, message: readError.message };
  if (!candidate)
    return { ok: false, message: 'This candidate no longer exists — refresh the page.' };
  // Checked here as well as in the database so that a stale card does not
  // create a login for someone who is not being accepted.
  if (candidate.status !== 'interview_completed') {
    return { ok: false, message: explain(`not_awaiting_decision: ${candidate.status}`) };
  }

  let admin: AdminAuth;
  try {
    admin = createAdminClient().auth.admin as unknown as AdminAuth;
  } catch {
    return { ok: false, message: MESSAGES.account_service_key! };
  }

  const outcome = await acceptWithAccount(
    { admin, rpc: supabase as unknown as AcceptRpc },
    {
      staffId,
      email: candidate.email,
      linkedUserId: candidate.user_id,
      roleIds,
      note: note.trim() || null,
      staffOrigin: origin,
    },
  );
  if (!outcome.ok) return { ok: false, message: explain(outcome.error) };
  for (const path of paths(staffId)) revalidatePath(path);
  return { ok: true };
}

/**
 * Resend activation link (§2.7, E3; docs/14 §2 item 4). A fresh personal
 * link under a NEW E3 for someone accepted who has not activated yet —
 * the usual reason is that the first link expired (a day, §10.2). The
 * database refuses before anything is minted if it is too soon, the
 * person has already activated, or they are not an accepted candidate or
 * worker; activation.ts has the order. Service key for GoTrue only, after
 * the manager check; the database write is the session client's.
 */
export async function resendActivationLink(staffId: string): Promise<ActionResult> {
  const origin = staffOrigin();
  if (!origin) return { ok: false, message: MESSAGES.activation_link_required! };
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  if (!(await asAdmin())) return { ok: false, message: MESSAGES.not_authorised! };

  let admin: AdminAuth;
  try {
    admin = createAdminClient().auth.admin as unknown as AdminAuth;
  } catch {
    return { ok: false, message: MESSAGES.account_service_key! };
  }

  const supabase = createClient(await cookies());
  const outcome = await resendActivation(
    { admin, rpc: supabase as unknown as ResendRpc },
    { staffId, staffOrigin: origin },
  );
  if (!outcome.ok) return { ok: false, message: explain(outcome.error) };
  for (const path of [...paths(staffId), `/staff/${staffId}`]) revalidatePath(path);
  return { ok: true };
}

/** Reject candidate — final on this record (§2.3). E2 goes out; the reason stays in the office. */
export async function rejectCandidate(staffId: string, reason: string): Promise<ActionResult> {
  if (reason.trim() === '') return { ok: false, message: MESSAGES.reason_required! };
  return call('onboarding_reject', { p_staff: staffId, p_reason: reason.trim() }, paths(staffId));
}

/** §2.4 / §9.6: a role picked after Willo accepted the candidate by itself. */
export async function addQualifiedRole(staffId: string, roleId: string): Promise<ActionResult> {
  return call('add_staff_role', { p_staff: staffId, p_role: roleId }, paths(staffId));
}

// ---------------------------------------------------------------------
// Documents and the declaration (§2.3, §2.10)
// ---------------------------------------------------------------------
export interface VerifyInput {
  /**
   * The expiry — or, on a share code report, the right-to-work-until off the
   * gov.uk report (`NO_TIME_LIMIT` for EU settled status). Required by the
   * database for a visa document, status document or share code report.
   */
  expiry?: string | null;
  periods?: Period[] | null;
}

export async function verifyDocument(
  staffId: string,
  docId: string,
  input: VerifyInput = {},
): Promise<ActionResult> {
  const periods = input.periods ?? null;
  if (periods) {
    const problem = periodsProblem(periods);
    if (problem) return { ok: false, message: problem };
  }
  const args: RpcArguments = { p_doc: docId };
  if (input.expiry) args['p_expiry'] = input.expiry;
  // An empty list is a real answer — "zero periods" happens (§2.3) — so it
  // is sent as an empty array, not dropped.
  if (periods) args['p_term_dates'] = periods.map(periodToRange);
  // A completion letter is approved in Compliance (approve_completion_letter),
  // so there is no completion date to send from here.
  return call('verify_document', args, paths(staffId));
}

export async function rejectDocument(
  staffId: string,
  docId: string,
  reason: string,
): Promise<ActionResult> {
  if (reason.trim() === '') return { ok: false, message: MESSAGES.reason_required! };
  return call('reject_document', { p_doc: docId, p_reason: reason.trim() }, paths(staffId));
}

export async function verifyDeclaration(
  staffId: string,
  declarationId: string,
  note: string,
): Promise<ActionResult> {
  return call(
    'verify_declaration',
    { p_declaration: declarationId, p_note: note.trim() || null },
    paths(staffId),
  );
}

export async function rejectDeclaration(
  staffId: string,
  declarationId: string,
  reason: string,
): Promise<ActionResult> {
  if (reason.trim() === '') return { ok: false, message: MESSAGES.reason_required! };
  return call(
    'reject_declaration',
    { p_declaration: declarationId, p_reason: reason.trim() },
    paths(staffId),
  );
}

// ---------------------------------------------------------------------
// The returning applicant (§2.12)
// ---------------------------------------------------------------------
export async function resolveReturning(
  applicationId: string,
  staffId: string,
  action: 'reset' | 'reject',
  reason: string,
): Promise<ActionResult> {
  if (reason.trim() === '') return { ok: false, message: MESSAGES.reason_required! };
  return call(
    'onboarding_resolve_returning',
    { p_application: applicationId, p_action: action, p_reason: reason.trim() },
    [...paths(staffId), `/staff/${staffId}`],
  );
}

// ---------------------------------------------------------------------
// Opening a document (§2.3 Download, §2.6 gov.uk report)
// ---------------------------------------------------------------------
async function asAdmin(): Promise<boolean> {
  const supabase = createClient(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return false;
  // current_app_role(), not the profiles row: it also refuses a
  // switched-off login and a two-step login below aal2 (20260930210500).
  return sessionIsAdmin(supabase);
}

/**
 * A short-lived link to the file. The path is read through the SESSION
 * client first, so what gets signed is a document this manager can see —
 * never a path the browser supplied.
 */
export async function documentLink(
  docId: string,
  which: 'file' | 'report',
): Promise<ActionResult & { url?: string }> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  if (!(await asAdmin())) return { ok: false, message: MESSAGES.not_authorised! };

  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from('compliance_docs')
    .select('file_path, gov_report_path')
    .eq('id', docId)
    .maybeSingle<{ file_path: string | null; gov_report_path: string | null }>();
  if (error) return { ok: false, message: error.message };
  const path = which === 'file' ? data?.file_path : data?.gov_report_path;
  if (!path) return { ok: false, message: 'There is no file on this document.' };

  const { data: signed, error: signError } = await createAdminClient()
    .storage.from('documents')
    .createSignedUrl(path, 60);
  if (signError || !signed)
    return { ok: false, message: signError?.message ?? 'Could not open the file.' };
  return { ok: true, url: signed.signedUrl };
}
