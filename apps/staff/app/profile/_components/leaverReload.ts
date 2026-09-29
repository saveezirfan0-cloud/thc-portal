/**
 * A full page load of /profile once the worker has left (§10.6 step 7).
 *
 * Not router.replace + router.refresh: every cached shell in the app is now
 * wrong, and a client transition waiting on the RSC refresh after the
 * server action was the step staff.profile-requests kept stalling on — the
 * RPC had gone through, the leaver screen never drew. A fresh document
 * cannot be half-refreshed. Its own module so tests can stand it in.
 */
export function reloadToLeaverScreen(): void {
  window.location.replace('/profile');
}
