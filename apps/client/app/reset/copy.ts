/**
 * A3's words, in a plain module so the page, the action and the tests read
 * one string ('use server' files export async functions only).
 */

/** Signed in, but not by a reset link in the last 15 minutes (packages/db/src/recovery.ts). */
export const USE_ACCOUNT_SCREEN =
  'To change your password while signed in, use Your account → Change password, which asks for your current one. Or request a new reset link and open it straight away.';

/** A recovery session for a login that is not a client's (§1.4): nothing is changed. */
export const OTHER_APP =
  'This reset link is for a different THC app. Open the link you were sent for that app.';
