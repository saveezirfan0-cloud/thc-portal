/**
 * After Request my P45 succeeds, the whole app is the leaver screen
 * (§10.6 step 7): every tab, the shell and every screen the router has
 * cached. A full page load is the only navigation that drops all of them
 * at once. The client-side `router.replace('/profile')` + `router.refresh()`
 * it replaces raced the server action's own `revalidatePath('/', 'layout')`
 * render, and sometimes left the old hub on screen (the §10.6 e2e test
 * failed on main that way). `replace`, so Back does not return to the hub.
 *
 * Its own module so the flow's test can see the call; jsdom cannot.
 */
export function closeToLeaverScreen(): void {
  window.location.replace('/profile');
}
