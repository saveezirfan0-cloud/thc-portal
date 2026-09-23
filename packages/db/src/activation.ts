/**
 * The personal activation link — §1.4, §2.7, §2.8 (E3), §10.2,
 * wireframes/public/activate.html (`/activate/:token`).
 *
 * Shared because two apps must agree on it: the Back Office builds the
 * link when a manager presses Accept, and the Staff App reads it when the
 * candidate opens E3. A drift between the two is a link that 404s or a
 * token that is verified as the wrong type, which to the candidate is the
 * same thing: "this link has expired".
 *
 * The token is the `hashed_token` GoTrue returns from
 * `auth.admin.generateLink` — a hex digest, never the raw OTP — and it is
 * spent by `auth.verifyOtp({ token_hash, type })` on submit, never on load.
 */

/**
 * GoTrue's hashed token is 56 hex characters today (sha224). The pattern
 * is wider on purpose — a GoTrue upgrade that lengthens it must not turn
 * every E3 into a dead link — but it never admits `/`, `?`, `.` or an
 * empty string, so a token cannot reshape the URL it sits in.
 */
export const ACTIVATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,200}$/;

/**
 * `invite` for a login created by Accept (the usual case); `magiclink` for
 * one that already existed and was confirmed — a returning applicant
 * (§2.12) whose account survived their earlier period. GoTrue refuses an
 * invite for a confirmed address, and verifies each kind only as itself.
 */
export type ActivationTokenType = 'invite' | 'magiclink';

export function isActivationToken(value: unknown): value is string {
  return typeof value === 'string' && ACTIVATION_TOKEN_PATTERN.test(value);
}

/**
 * The type carried on the link. Anything but the exact string `magiclink`
 * is an invite: the default link has no query at all, which keeps the
 * common E3 exactly the wireframe's `/activate/:token`.
 */
export function parseActivationType(value: unknown): ActivationTokenType {
  return value === 'magiclink' ? 'magiclink' : 'invite';
}

/**
 * `{staffOrigin}/activate/{token}`, plus `?type=magiclink` when that is
 * what the token is. Throws on a malformed origin or token rather than
 * returning a link that cannot work — E3 must never go out with a dead one.
 */
export function activationLink(origin: string, token: string, type: ActivationTokenType): string {
  const base = origin.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/?#\s]+$/.test(base)) {
    throw new Error(`activationLink: "${origin}" is not an origin`);
  }
  if (!isActivationToken(token)) {
    throw new Error('activationLink: the token is not a GoTrue hashed token');
  }
  return `${base}/activate/${token}${type === 'magiclink' ? '?type=magiclink' : ''}`;
}
