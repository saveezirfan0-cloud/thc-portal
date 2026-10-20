/**
 * A3's words, in a plain module so the page, the action and the tests read
 * one string ('use server' files export async functions only).
 */

/** Signed in, but not by a reset link in the last 15 minutes (packages/db/src/recovery.ts). */
export const USE_ACCOUNT_SCREEN =
  'To change your password while signed in, use My profile → Password, which asks for your current one. Or request a new reset link and open it straight away.';

/**
 * A recovery session for a login that is not an admin's (§1.4): nothing is
 * changed. A worker who reset here would otherwise be signed out and dropped
 * on the sign-in screen, whose refusal reads "password incorrect" for a
 * password that is right.
 *
 * Only a worker is told which app is theirs, and only with an address that is
 * not the Back Office's own. Any other role (a client, a login with no role)
 * gets the Client Portal's neutral line, which names no app (§1.4).
 */
export function otherApp(role: unknown, staffUrl?: string): string {
  if (role !== 'staff') {
    return 'This reset link is for a different THC app. Open the link you were sent for that app. Nothing was changed here.';
  }
  const where = staffUrl ? ` at ${staffUrl.trim().replace(/\/+$/, '')}` : '';
  return `This is the Back Office, for THC office staff. Your login is for the Staff App — open it${where} and sign in there. Nothing was changed here.`;
}

/** Supabase's `same_password`: the new password is the one already set. */
export const SAME_PASSWORD = 'Choose a new password that is different from your current one.';

/**
 * Under the code field, for a login with two-step (ADR-0057): GoTrue sets a
 * new password only once the code is given, and a lost phone is reset on
 * /users first (ADR-0060), as the code step says.
 */
export const RESET_CODE_HINT =
  'Your login has two-step sign-in, so type the code your authenticator app shows for THC Back Office. Lost or replaced your phone? Ask whoever looks after THC’s system to reset two-step sign-in for your login first.';
