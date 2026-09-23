/**
 * Accept and Resend activation link, with the candidate's login — §1.4,
 * §2.4, §2.7, §2.8 (E3), ADR-0021.
 *
 * Kept out of actions.ts so it can be tested without Next: everything it
 * touches comes in as an argument. actions.ts is the only caller and is
 * where the manager is checked BEFORE the service key is used at all.
 *
 * The login itself — create or reuse, app_metadata.role = staff, mint the
 * one-time token — is `@thc/db/provision`, the same code the Willo
 * receiver runs, so a Willo Accept and an office Accept provision alike.
 * Why the login comes before the database, and what a refusal leaves
 * behind, is written there.
 */
import { issueActivationLink } from '@thc/db/provision';
import type { AdminAuth } from '@thc/db/provision';

export { isEmailTaken, provisionStaffLogin } from '@thc/db/provision';
export type {
  AdminAuth,
  AuthErrorLike,
  AuthUserLike,
  ProvisionFailure,
  Provisioned,
} from '@thc/db/provision';

export interface AcceptRpc {
  rpc(
    fn: 'onboarding_accept_with_account',
    args: {
      p_staff: string;
      p_roles: string[];
      p_note: string | null;
      p_user: string;
      p_activation_link: string;
      p_install_link: string;
    },
  ): PromiseLike<{ error: { message: string } | null }>;
}

export interface AcceptInput {
  staffId: string;
  email: string;
  linkedUserId: string | null;
  roleIds: string[];
  note: string | null;
  staffOrigin: string;
}

export type AcceptOutcome = { ok: true; userId: string } | { ok: false; error: string };

function logProvisionFailure(staffId: string, code: string, detail?: string) {
  if (detail) {
    console.error('[onboarding] account provisioning failed', { staffId, code, detail });
  }
}

/**
 * The login, then ONE database transaction: link staff.user_id, move the
 * candidate to Documents, queue E3 with the personal link. `error` is
 * either a code from the login step or the database's own message;
 * actions.ts turns either into words.
 */
export async function acceptWithAccount(
  deps: { admin: AdminAuth; rpc: AcceptRpc },
  input: AcceptInput,
): Promise<AcceptOutcome> {
  const issued = await issueActivationLink(
    deps.admin,
    { email: input.email, userId: input.linkedUserId },
    input.staffOrigin,
  );
  if (!issued.ok) {
    logProvisionFailure(input.staffId, issued.code, issued.detail);
    return { ok: false, error: issued.code };
  }

  const { error } = await deps.rpc.rpc('onboarding_accept_with_account', {
    p_staff: input.staffId,
    p_roles: input.roleIds,
    p_note: input.note,
    p_user: issued.userId,
    p_activation_link: issued.link,
    p_install_link: issued.installLink,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, userId: issued.userId };
}

// ---------------------------------------------------------------------
// Resend activation link (docs/14 §2 item 4)
// ---------------------------------------------------------------------

export interface ResendRpc {
  rpc(
    fn: 'onboarding_resend_activation_check',
    args: { p_staff: string },
  ): PromiseLike<{
    data: { staffId?: string; email?: string; userId?: string | null } | null;
    error: { message: string } | null;
  }>;
  rpc(
    fn: 'onboarding_resend_activation',
    args: {
      p_staff: string;
      p_user: string;
      p_activation_link: string;
      p_install_link: string;
    },
  ): PromiseLike<{
    data: { queued?: boolean; n?: number; outboxKey?: string } | null;
    error: { message: string } | null;
  }>;
}

export type ResendOutcome =
  { ok: true; queued: boolean; n: number | null } | { ok: false; error: string };

/**
 * Three steps, and the first is the point: the database says whether a
 * resend is allowed BEFORE a token is minted, because minting replaces the
 * token in the link the candidate already has. A refused resend (too soon,
 * already activated, rejected) therefore changes nothing anywhere.
 *
 *   1. onboarding_resend_activation_check — allowed? for which login?
 *   2. the login and a fresh token (@thc/db/provision)
 *   3. onboarding_resend_activation — link if needed, NEW E3 under
 *      `E3:resend:<staff>:<n>`, audited; re-checks everything under a lock
 */
export async function resendActivation(
  deps: { admin: AdminAuth; rpc: ResendRpc },
  input: { staffId: string; staffOrigin: string },
): Promise<ResendOutcome> {
  const check = await deps.rpc.rpc('onboarding_resend_activation_check', {
    p_staff: input.staffId,
  });
  if (check.error) return { ok: false, error: check.error.message };
  const email = check.data?.email;
  if (!email) return { ok: false, error: 'unknown_staff' };

  const issued = await issueActivationLink(
    deps.admin,
    { email, userId: check.data?.userId ?? null },
    input.staffOrigin,
  );
  if (!issued.ok) {
    logProvisionFailure(input.staffId, issued.code, issued.detail);
    return { ok: false, error: issued.code };
  }

  const { data, error } = await deps.rpc.rpc('onboarding_resend_activation', {
    p_staff: input.staffId,
    p_user: issued.userId,
    p_activation_link: issued.link,
    p_install_link: issued.installLink,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, queued: data?.queued !== false, n: data?.n ?? null };
}
