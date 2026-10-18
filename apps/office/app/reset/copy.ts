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
 */
export function otherApp(staffUrl?: string): string {
  const where = staffUrl ? ` at ${staffUrl.replace(/\/$/, '')}` : '';
  return `This is the Back Office, for THC office staff. Your login is for the Staff App — open it${where} and sign in there. Nothing was changed here.`;
}

/** Supabase's `same_password`: the new password is the one already set. */
export const SAME_PASSWORD = 'Choose a new password that is different from your current one.';
