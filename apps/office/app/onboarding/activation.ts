/**
 * Accept with the candidate's login — §1.4, §2.4, §2.7, §2.8 (E3).
 *
 * Kept out of actions.ts so it can be tested without Next: everything it
 * touches comes in as an argument. actions.ts is the only caller and is
 * where the manager is checked BEFORE the service key is used at all.
 *
 * The order, and why:
 *
 *   1. GoTrue Admin API (service key): create or reuse the candidate's
 *      login, make sure app_metadata.role is `staff`, and mint a one-time
 *      token with generateLink. generateLink sends nothing — E3 through
 *      notification_outbox stays the only email (§8).
 *   2. ONE database transaction (session client, office-only RPC):
 *      link staff.user_id, move the candidate to Documents, queue E3 with
 *      the personal link.
 *
 * The account has to exist before the transaction because E3's payload
 * must carry the token, and the token only exists once GoTrue has a user
 * to hang it on. The reverse order — queue E3, then create the account —
 * leaves a window where the outbox drain can send a link that does not
 * work yet, and a failure after the send that nobody can take back.
 *
 * What step 1 leaves behind when step 2 refuses: an unconfirmed login
 * with no password, linked to nothing, and a token that was never sent.
 * It cannot be signed in to, and the next Accept reuses it (an invite for
 * an unconfirmed address re-issues the token). Nothing is deleted on the
 * way out: deleting a login on an error path is how the wrong one goes.
 */
import { activationLink } from '@thc/db/activation';
import type { ActivationTokenType } from '@thc/db/activation';

export interface AuthUserLike {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  app_metadata?: Record<string, unknown> | null;
}

export interface AuthErrorLike {
  message: string;
  status?: number;
  code?: string;
}

/** The slice of `supabase.auth.admin` this needs. */
export interface AdminAuth {
  generateLink(params: { type: ActivationTokenType; email: string }): PromiseLike<{
    data: {
      user: AuthUserLike | null;
      properties: { hashed_token?: string | null } | null;
    } | null;
    error: AuthErrorLike | null;
  }>;
  getUserById(id: string): PromiseLike<{
    data: { user: AuthUserLike | null } | null;
    error: AuthErrorLike | null;
  }>;
  updateUserById(
    id: string,
    attributes: { app_metadata: Record<string, unknown> },
  ): PromiseLike<{ error: AuthErrorLike | null }>;
}

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

export type Provisioned =
  | { ok: true; userId: string; tokenHash: string; type: ActivationTokenType }
  | { ok: false; code: ProvisionFailure; detail?: string };

export type ProvisionFailure =
  'account_missing' | 'account_not_staff' | 'account_link_failed' | 'account_role_failed';

function roleOf(user: AuthUserLike): unknown {
  return user.app_metadata?.['role'];
}

/** GoTrue's answer to an invite for an address that is already confirmed. */
export function isEmailTaken(error: AuthErrorLike): boolean {
  return (
    error.code === 'email_exists' ||
    error.code === 'user_already_exists' ||
    /already (been )?registered|already exists/i.test(error.message)
  );
}

/**
 * Step 1. Never touches an office or client login: a role other than
 * `staff` stops here, before app_metadata is written, and the token that
 * was minted for it is dropped unsent.
 */
export async function provisionStaffLogin(
  admin: AdminAuth,
  candidate: { email: string; userId: string | null },
): Promise<Provisioned> {
  let type: ActivationTokenType;
  let result: Awaited<ReturnType<AdminAuth['generateLink']>>;

  if (candidate.userId) {
    // Already linked (a returning applicant, §2.12): the same login, never
    // a second one. The database refuses a relink anyway.
    const existing = await admin.getUserById(candidate.userId);
    const user = existing.data?.user;
    if (existing.error || !user) return { ok: false, code: 'account_missing' };
    const role = roleOf(user);
    if (role !== undefined && role !== null && role !== 'staff') {
      return { ok: false, code: 'account_not_staff' };
    }
    type = user.email_confirmed_at ? 'magiclink' : 'invite';
    result = await admin.generateLink({ type, email: user.email ?? candidate.email });
  } else {
    type = 'invite';
    result = await admin.generateLink({ type, email: candidate.email });
    if (result.error && isEmailTaken(result.error)) {
      type = 'magiclink';
      result = await admin.generateLink({ type, email: candidate.email });
    }
  }

  const user = result.data?.user;
  const tokenHash = result.data?.properties?.hashed_token ?? '';
  if (result.error || !user || !tokenHash) {
    return { ok: false, code: 'account_link_failed', detail: result.error?.message };
  }

  const role = roleOf(user);
  if (role !== undefined && role !== null && role !== 'staff') {
    return { ok: false, code: 'account_not_staff' };
  }
  if (role !== 'staff') {
    // app_metadata, never user_metadata: the user can write the latter
    // from the browser, and every app's middleware reads the former.
    const { error } = await admin.updateUserById(user.id, { app_metadata: { role: 'staff' } });
    if (error) return { ok: false, code: 'account_role_failed', detail: error.message };
  }

  return { ok: true, userId: user.id, tokenHash, type };
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

/**
 * Steps 1 and 2. `error` is either a code from step 1 or the database's
 * own message from step 2; actions.ts turns either into words.
 */
export async function acceptWithAccount(
  deps: { admin: AdminAuth; rpc: AcceptRpc },
  input: AcceptInput,
): Promise<AcceptOutcome> {
  const login = await provisionStaffLogin(deps.admin, {
    email: input.email,
    userId: input.linkedUserId,
  });
  if (!login.ok) {
    if (login.detail) {
      console.error('[onboarding] account provisioning failed', {
        staffId: input.staffId,
        code: login.code,
        detail: login.detail,
      });
    }
    return { ok: false, error: login.code };
  }

  let link: string;
  try {
    link = activationLink(input.staffOrigin, login.tokenHash, login.type);
  } catch {
    return { ok: false, error: 'activation_link_required' };
  }

  const { error } = await deps.rpc.rpc('onboarding_accept_with_account', {
    p_staff: input.staffId,
    p_roles: input.roleIds,
    p_note: input.note,
    p_user: login.userId,
    p_activation_link: link,
    p_install_link: `${input.staffOrigin.replace(/\/+$/, '')}/install`,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, userId: login.userId };
}
