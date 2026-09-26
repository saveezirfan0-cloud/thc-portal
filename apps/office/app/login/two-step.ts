/**
 * Two-step sign-in (TOTP) for the Back Office — the pure pieces (ADR-0057).
 *
 * No Supabase client here, no Next: the middleware, the sign-in action, the
 * code step and /account all ask the same questions through these functions,
 * so they cannot disagree about who must type a code. A page that decided
 * "pass" while the middleware decided "verify" would be a redirect loop.
 */

export type AssuranceLevel = 'aal1' | 'aal2';

/** The shape of a GoTrue factor as far as this module needs it. */
export interface FactorLike {
  id: string;
  factor_type: string;
  status: string;
  friendly_name?: string | null;
  created_at?: string | null;
}

/** Where a session at aal1 with a verified factor is sent (a public path). */
export const VERIFY_PATH = '/login/verify';

/** Where sign-in lands when no `next` was asked for. */
export const DEFAULT_LANDING = '/dashboard';

export const CODE_LENGTH = 6;

function isVerified(factor: FactorLike | null | undefined): factor is FactorLike {
  return !!factor && factor.status === 'verified';
}

/**
 * The level this user can reach. Any verified factor makes it aal2 — the
 * same rule GoTrue applies — so a factor type the app cannot yet challenge
 * still locks the door rather than opening it.
 */
export function nextLevelFor(factors: readonly FactorLike[] | null | undefined): AssuranceLevel {
  return (factors ?? []).some(isVerified) ? 'aal2' : 'aal1';
}

/** The verified authenticator-app factor, if there is one. */
export function verifiedTotp(factors: readonly FactorLike[] | null | undefined): FactorLike | null {
  return (factors ?? []).find((f) => isVerified(f) && f.factor_type === 'totp') ?? null;
}

/** Set-ups that were started and never finished: safe to clear at aal1. */
export function unverifiedTotp(factors: readonly FactorLike[] | null | undefined): FactorLike[] {
  return (factors ?? []).filter((f) => f.factor_type === 'totp' && f.status !== 'verified');
}

/**
 * The `aal` claim of an access token, read without verifying it.
 *
 * Only ever call this on a token GoTrue has just accepted (the middleware
 * reads it after `getUser()` succeeded with the same session): the claim is
 * then as trustworthy as the signature GoTrue checked. Anything unreadable is
 * `null`, which the decision below treats as "not aal2" — fail closed.
 */
export function aalFromAccessToken(token: string | null | undefined): AssuranceLevel | null {
  if (!token) return null;
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const claims = JSON.parse(atob(padded)) as { aal?: unknown };
    return claims.aal === 'aal1' || claims.aal === 'aal2' ? claims.aal : null;
  } catch {
    return null;
  }
}

export type TwoStepDecision = 'pass' | 'verify';

/**
 * The one rule: a user who CAN reach aal2 and has not yet, types a code.
 * A user with no verified factor passes at aal1 (two-step is opt-in today,
 * ADR-0057). An unknown current level is never taken as aal2.
 */
export function twoStepDecision(levels: {
  currentLevel: AssuranceLevel | null | undefined;
  nextLevel: AssuranceLevel | null | undefined;
}): TwoStepDecision {
  return levels.nextLevel === 'aal2' && levels.currentLevel !== 'aal2' ? 'verify' : 'pass';
}

/**
 * The code as typed, made comparable: authenticator apps show "123 456",
 * and people copy it with the space or a dash. Anything else is kept, so
 * the format check below can refuse it.
 */
export function normaliseCode(raw: unknown): string {
  return String(raw ?? '').replace(/[\s-]/g, '');
}

/** Checked before GoTrue is asked, so a typo costs no attempt. */
export function codeError(code: string): string | null {
  if (code === '') return 'Enter the 6-digit code from your authenticator app.';
  if (!/^\d+$/.test(code)) return 'The code is numbers only — 6 digits, no letters.';
  if (code.length !== CODE_LENGTH) return 'The code is 6 digits long. Check you have all of them.';
  return null;
}

/**
 * Where the code step may send someone afterwards: the caller has already
 * run `next` through `safeNextPath`. The sign-in pages themselves are
 * refused, so the code step can never be told to redirect to itself.
 */
export function landingAfterVerify(next: string): string {
  const path = next.split(/[?#]/)[0] ?? '';
  const underSignIn = ['/login', '/auth'].some((p) => path === p || path.startsWith(`${p}/`));
  return underSignIn ? DEFAULT_LANDING : next;
}

/** The code step's URL, carrying `next` only when it is not the default. */
export function verifyStepPath(next: string): string {
  const landing = landingAfterVerify(next);
  return landing === DEFAULT_LANDING
    ? VERIFY_PATH
    : `${VERIFY_PATH}?next=${encodeURIComponent(landing)}`;
}

/** GoTrue's refusal, in words for a manager. The real reason goes to the log. */
export function explainCodeError(error: { code?: string | null; status?: number | null }): string {
  switch (error.code) {
    case 'mfa_verification_failed':
    case 'mfa_verification_rejected':
      return 'That code did not match. Codes change every 30 seconds — type the one showing now.';
    case 'mfa_challenge_expired':
      return 'That took a little too long. Type the code showing now.';
    case 'mfa_factor_not_found':
      return 'This authenticator is no longer set up on your login. Reload the page.';
    case 'over_request_rate_limit':
      return 'Too many attempts. Wait a minute, then try again.';
    case 'mfa_totp_enroll_not_enabled':
    case 'mfa_totp_verify_not_enabled':
      return 'Two-step sign-in is switched off for this project. Ask whoever looks after THC’s system.';
    default:
      return error.status === 429
        ? 'Too many attempts. Wait a minute, then try again.'
        : 'That did not work. Try again in a moment.';
  }
}

/** The name a manager gives the phone, shown back on /account. */
export const DEVICE_NAME_MAX = 40;

export function deviceNameError(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Give the phone a name, for example “My iPhone”.';
  if (trimmed.length > DEVICE_NAME_MAX) {
    return `Keep the name under ${DEVICE_NAME_MAX} characters.`;
  }
  return null;
}

/** "ABCD EFGH …" — the manual-entry key, readable aloud and in groups of four. */
export function groupSecret(secret: string): string {
  return (secret.match(/.{1,4}/g) ?? []).join(' ');
}
