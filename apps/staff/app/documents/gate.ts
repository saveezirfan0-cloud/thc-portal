import { appLock } from '../profile/lock';
import { loadProfile } from '../profile/data';
import type { AppLock } from '../profile/lock';
import type { StaffProfile } from '../profile/types';

/**
 * Whether the Documents screens are open to this worker — §10.1.
 *
 * `appLock()` is the rule (#42) and is not restated here. What this adds is
 * the one decision `StaffShell` leaves to the screen: Documents is the
 * screen lock case 1 KEEPS (under the Profile tab, ADR-0042), so these screens render their own content under that
 * lock (`ignoreLock`) while every terminal case — the manual hold (case 2),
 * the failed quiz (case 3), the leaver, a removal — falls through to the
 * shell's lock screen, which is how case 2's "the Documents tab is not
 * shown as an action either" holds on a typed URL too.
 *
 * No profile (no database wired up, docs/04) is treated as unlocked, the
 * same call StaffShell makes.
 */
export interface DocumentsGate {
  profile: StaffProfile | null;
  lock: AppLock;
  /** Render this screen's own content. */
  open: boolean;
  /** Pass to StaffShell as `ignoreLock`. */
  ignoreLock: boolean;
}

export function gateFor(lock: AppLock): Omit<DocumentsGate, 'profile'> {
  const open = lock === 'none' || lock === 'documents';
  return { lock, open, ignoreLock: lock === 'documents' };
}

export async function documentsGate(): Promise<DocumentsGate> {
  const profile = await loadProfile();
  return { profile, ...gateFor(profile ? appLock(profile) : 'none') };
}
