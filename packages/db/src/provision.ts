/**
 * The candidate's login and their personal activation link — §1.4, §2.4,
 * §2.7, §2.8 (E3), ADR-0021.
 *
 * Three callers, one body, so they cannot drift:
 *
 *   - the office's Accept          apps/office/app/onboarding/activation.ts
 *   - the office's Resend link     apps/office/app/onboarding/activation.ts
 *   - a Willo Accept               supabase/functions/willo-webhook
 *
 * The last runs on Deno, which is why this file imports with the `.ts`
 * extension and touches nothing but its arguments (ADR-0006): no
 * `process.env`, no Supabase client, no Next.
 *
 * What it does, and why in this order: create or reuse the GoTrue login,
 * make sure `app_metadata.role` is `staff`, and mint a one-time token with
 * `generateLink`. generateLink sends nothing — E3 through
 * `notification_outbox` stays the only email (§8). The database write
 * that links the login and queues E3 comes AFTER, in one transaction, in
 * the caller: E3 must carry the token, and the token exists only once
 * GoTrue has a user to hang it on.
 *
 * Minting a token REPLACES the previous one on that login. A caller must
 * therefore only mint when it is about to queue an E3 with the result —
 * never "just in case" — or the link already in the candidate's inbox
 * dies. Every caller asks the database first whether a send is due.
 *
 * What a mint leaves behind when the database then refuses: an
 * unconfirmed login with no password, linked to nothing (or to the same
 * candidate), and a token that was never sent. It cannot be signed in to,
 * and the next attempt reuses it. Nothing is deleted on the way out:
 * deleting a login on an error path is how the wrong one goes.
 */
import { activationLink } from './activation.ts';
import type { ActivationTokenType } from './activation.ts';

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

export type ProvisionFailure =
  'account_missing' | 'account_not_staff' | 'account_link_failed' | 'account_role_failed';

export type Provisioned =
  | { ok: true; userId: string; tokenHash: string; type: ActivationTokenType }
  | { ok: false; code: ProvisionFailure; detail?: string };

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
 * Never touches an office or client login: a role other than `staff`
 * stops here, before app_metadata is written, and the token that was
 * minted for it is dropped unsent.
 */
export async function provisionStaffLogin(
  admin: AdminAuth,
  candidate: { email: string; userId: string | null },
): Promise<Provisioned> {
  let type: ActivationTokenType;
  let result: Awaited<ReturnType<AdminAuth['generateLink']>>;

  if (candidate.userId) {
    // Already linked (a returning applicant, §2.12, or a resend): the same
    // login, never a second one. The database refuses a relink anyway.
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

export type IssuedLink =
  | { ok: true; userId: string; link: string; installLink: string; type: ActivationTokenType }
  | { ok: false; code: ProvisionFailure | 'activation_link_required'; detail?: string };

/** `{staffOrigin}/install` — E3's second link (§2.7 "download the app"). */
export function installLink(staffOrigin: string): string {
  return `${staffOrigin.trim().replace(/\/+$/, '')}/install`;
}

/**
 * provisionStaffLogin + the personal `/activate/{token}` link built from
 * it. The origin is checked BEFORE anything is minted, so a configuration
 * mistake never kills a link already in somebody's inbox.
 */
export async function issueActivationLink(
  admin: AdminAuth,
  candidate: { email: string; userId: string | null },
  staffOrigin: string,
): Promise<IssuedLink> {
  const base = staffOrigin.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/?#\s]+$/.test(base)) {
    return { ok: false, code: 'activation_link_required' };
  }
  const login = await provisionStaffLogin(admin, candidate);
  if (!login.ok) return login;
  let link: string;
  try {
    link = activationLink(base, login.tokenHash, login.type);
  } catch {
    return { ok: false, code: 'activation_link_required' };
  }
  return { ok: true, userId: login.userId, link, installLink: installLink(base), type: login.type };
}
