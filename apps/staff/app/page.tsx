import { redirect } from 'next/navigation';
import { HOME_PATH } from '@thc/db';
import { readProfile } from './profile/data';
import { appLock } from './profile/lock';

/**
 * The Staff App's root.
 *
 * `HOME_PATH.staff` is `/shifts` — the tab §10.4 opens on and the one the
 * role gate sends a worker to from the other two apps. Until that screen
 * existed this rendered a Phase 0 shell; now that it does, the root is a
 * redirect rather than a second front door that can drift from the first.
 *
 * A candidate still inside the §10.3 wizard goes to /onboarding instead:
 * "The onboarding wizard (post-login)" is what the app IS for them until
 * the contract is signed. `appLock` decides, as it does everywhere else.
 */
// Per request: which door depends on who is asking, so a build without
// Supabase configured must not bake the /shifts redirect in.
export const dynamic = 'force-dynamic';

export default async function Page() {
  // A failed read goes to /shifts, whose shell fails closed with a retry
  // (audit D16) — not to the wizard, and not to an error page with no way on.
  const read = await readProfile();
  if (read.kind === 'ok' && appLock(read.profile) === 'onboarding') redirect('/onboarding');
  redirect(HOME_PATH.staff);
}
