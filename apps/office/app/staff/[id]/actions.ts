'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@thc/db/server';
import { createAdminClient } from '@thc/db/admin';
import { validateEmergencyContact } from '@thc/domain';
import type { EmergencyContactInput } from '@thc/domain';
import { supabaseConfigured } from '../data';
import type { ActionResult } from './types';

/**
 * Writes for /staff/:id (§9.6).
 *
 * Two different routes, and the difference matters.
 *
 * The qualification writes are `security invoker` RPCs, so RLS is the
 * gate: a caller who is not an admin is refused by the policy, not by a
 * check written here.
 *
 * Block, Unblock, Reset to candidate and Remove are `security definer`
 * and revoked from `authenticated` (docs/14 O7) — they cascade across
 * bookings and, in one case, are irreversible, so only the service role
 * may execute them. That key BYPASSES RLS, which means every call that
 * uses it has to establish for itself that the caller is an admin. That
 * is what `asAdmin()` below is: without it, this file would be a public
 * endpoint for anonymising any worker in the system by id.
 *
 * The same key carries no `sub`, so inside the database `auth.uid()` is
 * NULL and the audit row each of the four writes would name nobody.
 * Each takes `p_actor` for exactly this (20260927160400 §4), and it is
 * the manager's id `asAdmin()` read from the SESSION — never a value the
 * browser sent — that `callPrivilegedRpc()` passes.
 */

const NOT_CONFIGURED =
  'This environment has no Supabase project, so this cannot be saved. See docs/04-setup-github-vercel-supabase.md.';

/** See the note in the roles actions: the generated types are a placeholder. */
type RpcArguments = Record<string, string | number | boolean | null>;

interface RpcClient {
  rpc(fn: string, args: RpcArguments): PromiseLike<{ error: { message: string } | null }>;
}

function done(id: string): ActionResult {
  revalidatePath(`/staff/${id}`);
  revalidatePath('/staff');
  return { ok: true };
}

/** The session's own client: RLS applies, so the policy is the gate. */
async function callRpc(fn: string, args: RpcArguments, staffId: string): Promise<ActionResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  const supabase = createClient(await cookies()) as unknown as RpcClient;
  const { error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, message: error.message };
  return done(staffId);
}

/**
 * Establish that the caller is a signed-in admin before reaching for the
 * service role. The check runs through the SESSION client, so it is the
 * caller's own identity being read and `profiles`' own policy that
 * answers — never a claim the browser sent.
 */
async function asAdmin(): Promise<{ ok: true; userId: string } | { ok: false; message: string }> {
  const supabase = createClient(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, message: 'Sign in to do this.' };

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', auth.user.id)
    .maybeSingle<{ role: string }>();

  if (profile?.role !== 'admin') {
    return { ok: false, message: 'Only the office can do this.' };
  }
  return { ok: true, userId: auth.user.id };
}

/**
 * The service-role client: RLS is bypassed, so `asAdmin()` is the gate —
 * and the session's user id it returns is the `p_actor` the audit row
 * (staff_block_audit_v, §1.7's removal record) names as the manager.
 */
async function callPrivilegedRpc(
  fn: string,
  args: RpcArguments,
  staffId: string,
): Promise<ActionResult> {
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  const gate = await asAdmin();
  if (!gate.ok) return gate;

  const admin = createAdminClient() as unknown as RpcClient;
  const { error } = await admin.rpc(fn, { ...args, p_actor: gate.userId });
  if (error) return { ok: false, message: error.message };
  return done(staffId);
}

// ---------------------------------------------------------------------
// Role qualification (§9.6)
// ---------------------------------------------------------------------
export async function addRole(staffId: string, roleId: string): Promise<ActionResult> {
  return callRpc('add_staff_role', { p_staff: staffId, p_role: roleId }, staffId);
}

/**
 * Removing a role also removes the client qualifications that named it —
 * except any carrying Do not return, which the database keeps. The screen
 * says so before the manager presses it, because a control whose real
 * effect is wider than its label is how a bar gets deleted by accident.
 */
export async function removeRole(staffId: string, roleId: string): Promise<ActionResult> {
  return callRpc('remove_staff_role', { p_staff: staffId, p_role: roleId }, staffId);
}

// ---------------------------------------------------------------------
// Client qualification (§9.6)
// ---------------------------------------------------------------------
export async function grantQualification(
  staffId: string,
  clientId: string,
  roleId: string,
  note: string,
): Promise<ActionResult> {
  return callRpc(
    'grant_client_qualification',
    { p_staff: staffId, p_client: clientId, p_role: roleId, p_note: note.trim() || null },
    staffId,
  );
}

export async function revokeQualification(staffId: string, id: string): Promise<ActionResult> {
  return callRpc('revoke_client_qualification', { p_id: id }, staffId);
}

/**
 * §9.6's only hard gate. Switching it on needs a reason — it is shown to
 * whoever reads that client's events under "Unavailable → Do not return",
 * and an unexplained bar is one nobody can ever decide to lift.
 */
export async function setDoNotReturn(
  staffId: string,
  id: string,
  on: boolean,
  reason: string,
): Promise<ActionResult> {
  if (on && reason.trim() === '') {
    return { ok: false, message: 'Do not return needs a reason.' };
  }
  return callRpc(
    'set_do_not_return',
    { p_id: id, p_on: on, p_reason: reason.trim() || null },
    staffId,
  );
}

// ---------------------------------------------------------------------
// The three manager buttons, and the fourth that cannot be undone
// ---------------------------------------------------------------------
export async function blockWorker(staffId: string, reason: string): Promise<ActionResult> {
  if (reason.trim() === '') {
    // §4.3 distinguishes the two kinds of block by exactly this: an
    // auto-block needs no reason, a manual one always means something
    // went wrong. A manual block with an empty reason is an auto-block
    // wearing the wrong label.
    return { ok: false, message: 'A manual block needs a reason.' };
  }
  return callPrivilegedRpc(
    'block_worker_manually',
    { p_staff: staffId, p_reason: reason.trim() },
    staffId,
  );
}

/**
 * Unblock is not "set status = compliant": the RPC runs §4.3's full
 * compliance check first and refuses with the reasons when something is
 * still outstanding. Those reasons are the answer the manager needs, so
 * they are surfaced rather than swallowed.
 */
export async function unblockWorker(staffId: string): Promise<ActionResult> {
  return callPrivilegedRpc('unblock_worker', { p_staff: staffId }, staffId);
}

export async function resetToCandidate(staffId: string, reason: string): Promise<ActionResult> {
  if (reason.trim() === '') return { ok: false, message: 'A reset needs a reason.' };
  return callPrivilegedRpc(
    'reset_to_candidate',
    { p_staff: staffId, p_reason: reason.trim() },
    staffId,
  );
}

/**
 * §1.7. Irreversible, and confirmed twice in the UI before it reaches
 * here; the typed word is checked again on the server, because a
 * confirmation that only exists in the browser is not one.
 */
export async function removeWorker(staffId: string, confirmation: string): Promise<ActionResult> {
  if (confirmation.trim().toUpperCase() !== 'REMOVE') {
    return { ok: false, message: 'Type REMOVE to confirm.' };
  }
  return callPrivilegedRpc('remove_worker', { p_staff: staffId }, staffId);
}

// ---------------------------------------------------------------------
// Emergency contact (ADR-0037) — office-only, audited
//
// Both are definers with the admin check in their own body and auth.uid()
// as the actor (20260930130000), so they go through the SESSION: the audit
// row names the manager without anything being passed in, and there is no
// service-role door to guard.
// ---------------------------------------------------------------------
const EMERGENCY_MESSAGES: Record<string, string> = {
  bad_phone: 'Enter the number with its country code, for example +44 7700 900123.',
  bad_name: 'Enter their name (up to 100 characters).',
  bad_relationship: 'Say who they are to the worker, for example Parent (up to 40 characters).',
  staff_removed: 'This worker was removed under §1.7; nothing personal can be added back.',
  not_authorised: 'Only the office can do this.',
};

function emergencyMessage(result: ActionResult): ActionResult {
  if (result.ok) return result;
  const key = Object.keys(EMERGENCY_MESSAGES).find((code) => result.message.includes(code));
  return key ? { ok: false, message: EMERGENCY_MESSAGES[key] as string } : result;
}

export async function saveEmergencyContact(
  staffId: string,
  input: EmergencyContactInput,
): Promise<ActionResult> {
  // The domain's own check (validateEmergencyContact), so the manager sees
  // the same words the worker's form shows; the database checks again.
  const checked = validateEmergencyContact(input);
  if (!checked.ok) {
    return { ok: false, message: Object.values(checked.errors).join(' ') };
  }
  return emergencyMessage(
    await callRpc(
      'office_save_emergency_contact',
      {
        p_staff: staffId,
        p_name: checked.value.name,
        p_relationship: checked.value.relationship,
        p_phone: checked.value.phone,
      },
      staffId,
    ),
  );
}

export async function clearEmergencyContact(staffId: string): Promise<ActionResult> {
  return emergencyMessage(
    await callRpc('office_clear_emergency_contact', { p_staff: staffId }, staffId),
  );
}
