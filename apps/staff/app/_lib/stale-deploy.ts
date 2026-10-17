import { unstable_isUnrecognizedActionError } from 'next/navigation';

/**
 * A server action that rejected because the phone is running an older
 * build than the server (go-live audit B5).
 *
 * Next gives every server action a new id on each build. A phone kept awake
 * on the shift screen since before a deploy calls the old ids, and the
 * server answers "not found" — every press and every ping fails until the
 * page is loaded again. The only cure on the phone is that reload.
 *
 * The class name is checked as well as Next's helper: the helper is marked
 * unstable, and the error sets `name` explicitly, so it survives
 * minification.
 */
export function isStaleDeploy(error: unknown): boolean {
  try {
    if (
      typeof unstable_isUnrecognizedActionError === 'function' &&
      unstable_isUnrecognizedActionError(error)
    ) {
      return true;
    }
  } catch {
    // An older or mocked `next/navigation` without the helper.
  }
  return error instanceof Error && error.name === 'UnrecognizedActionError';
}

const RELOADED_AT = 'thc:stale-deploy-reload';
/** Never more than one automatic reload in this long, so a broken deploy cannot loop. */
export const RELOAD_GUARD_MS = 60_000;

/**
 * Reload onto the current build, at most once a minute. Answers whether it
 * did, so the caller can show its "press again" message when it did not.
 */
export function reloadForNewBuild(
  win: Pick<Window, 'location' | 'sessionStorage'> | undefined = typeof window === 'undefined'
    ? undefined
    : window,
  now: number = Date.now(),
): boolean {
  if (!win) return false;
  try {
    const last = Number(win.sessionStorage.getItem(RELOADED_AT) ?? 0);
    if (Number.isFinite(last) && now - last < RELOAD_GUARD_MS) return false;
    win.sessionStorage.setItem(RELOADED_AT, String(now));
  } catch {
    // Storage off (private mode): reload anyway; the new build has the ids.
  }
  win.location.reload();
  return true;
}
