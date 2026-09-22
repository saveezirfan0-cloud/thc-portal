import { redirect } from 'next/navigation';
import { HOME_PATH } from '@thc/db';

/**
 * The Staff App's root.
 *
 * `HOME_PATH.staff` is `/shifts` — the tab §10.4 opens on and the one the
 * role gate sends a worker to from the other two apps. Until that screen
 * existed this rendered a Phase 0 shell; now that it does, the root is a
 * redirect rather than a second front door that can drift from the first.
 */
export default function Page() {
  redirect(HOME_PATH.staff);
}
