/**
 * Minting a Back Office or Client Portal login and its one-time set-up
 * link — /users Invite (ADR-0055).
 *
 * The shape is `@thc/db/provision`'s for a worker (ADR-0021): GoTrue's
 * `generateLink` creates the login (or finds it) and returns a hashed
 * token WITHOUT sending anything, and the link is built on the app the
 * person will use. What differs is who decides the role: here the service
 * key only mints; `admin_register_account` then writes the role and the
 * profile as the signed-in manager, under the database's own admin check.
 *
 * Kept free of Next and of `process.env` so it can be tested with a fake
 * `auth.admin`.
 */
import { isActivationToken } from '@thc/db/activation';
import type { ActivationTokenType } from '@thc/db/activation';
import { isEmailTaken } from '@thc/db/provision';
import type { AuthErrorLike, AuthUserLike } from '@thc/db/provision';

export type InviteRole = 'admin' | 'client';

/** The slice of `supabase.auth.admin` this needs. */
export interface InviteAdmin {
  generateLink(params: { type: ActivationTokenType; email: string }): PromiseLike<{
    data: {
      user: AuthUserLike | null;
      properties: { hashed_token?: string | null } | null;
    } | null;
    error: AuthErrorLike | null;
  }>;
}

export type Minted =
  | { ok: true; userId: string; tokenHash: string; type: ActivationTokenType }
  | { ok: false; code: 'account_has_other_role' | 'account_link_failed'; detail?: string };

/**
 * `invite` for an address GoTrue has not seen (it creates the login), and
 * `magiclink` for one it has — a re-sent invite, or someone who lost their
 * password before ever using it. A login already of another kind stops
 * here: the token minted for it is dropped unsent, and nothing about the
 * login is changed.
 */
export async function mintLogin(
  admin: InviteAdmin,
  email: string,
  role: InviteRole,
): Promise<Minted> {
  let type: ActivationTokenType = 'invite';
  let result = await admin.generateLink({ type, email });
  if (result.error && isEmailTaken(result.error)) {
    type = 'magiclink';
    result = await admin.generateLink({ type, email });
  }
  const user = result.data?.user;
  const tokenHash = result.data?.properties?.hashed_token ?? '';
  if (result.error || !user || !tokenHash) {
    return { ok: false, code: 'account_link_failed', detail: result.error?.message };
  }
  const existing = user.app_metadata?.['role'];
  if (existing !== undefined && existing !== null && existing !== role) {
    return { ok: false, code: 'account_has_other_role' };
  }
  return { ok: true, userId: user.id, tokenHash, type };
}

/**
 * `{origin}/auth/invite?token=…` on the app the login is for. The page
 * there asks for a password and only then spends the token, so a link
 * preview or a mail scanner opening it does not use it up.
 */
export function inviteLink(origin: string, tokenHash: string, type: ActivationTokenType): string {
  const base = origin.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/?#\s]+$/.test(base)) {
    throw new Error(`inviteLink: "${origin}" is not an origin`);
  }
  if (!isActivationToken(tokenHash)) {
    throw new Error('inviteLink: the token is not a GoTrue hashed token');
  }
  const query = new URLSearchParams({ token: tokenHash });
  if (type === 'magiclink') query.set('type', 'magiclink');
  return `${base}/auth/invite?${query.toString()}`;
}

/** A ready-to-send email in the manager's own mail app. */
export function inviteMailto(input: {
  email: string;
  name: string;
  role: InviteRole;
  link: string;
}): string {
  const app = input.role === 'admin' ? 'THC Back Office' : 'THC Client Portal';
  const first = input.name.trim().split(/\s+/)[0] ?? '';
  const subject = `Your ${app} login`;
  const body = [
    `Hi ${first},`,
    '',
    `You have been given a login to the ${app}. Open this link to choose your password:`,
    '',
    input.link,
    '',
    'The link works once. If it has expired, ask us for a new one.',
    '',
    'The Hospitality Company',
  ].join('\n');
  return `mailto:${encodeURIComponent(input.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** What `admin_login_lookup` says about an address (20261001200000). */
export interface LoginLookup {
  exists: boolean;
  role?: string | null;
  clientId?: string | null;
  isStaff?: boolean;
  signedIn?: boolean;
}

export type MintRefusal =
  'account_has_other_role' | 'account_has_other_client' | 'already_signed_in';

/**
 * Asked BEFORE a token is minted, because minting replaces the token in
 * any link already sent (a worker's pending activation, say) and a link
 * for a login someone already uses would let whoever holds it sign in as
 * them. A login that has been used gets no link: its owner resets their
 * own password from the sign-in screen.
 */
export function refuseBeforeMint(
  lookup: LoginLookup,
  role: InviteRole,
  clientId: string | null,
): MintRefusal | null {
  if (!lookup.exists) return null;
  if (lookup.isStaff || (lookup.role && lookup.role !== role)) return 'account_has_other_role';
  if (role === 'client' && lookup.role === 'client' && (lookup.clientId ?? null) !== clientId) {
    return 'account_has_other_client';
  }
  if (lookup.signedIn) return 'already_signed_in';
  return null;
}
