import type { ReactNode } from 'react';
import { AppBody, AppFrame } from '@thc/ui';
import { BottomTabs } from './BottomTabs';
import { AppChrome } from './AppChrome';
import type { ChromeWorker } from './AppChrome';
import { LockScreen } from './LockScreens';
import { PushStatus } from './PushStatus';
import { lockFor, reachableTabs } from '../lock';
import type { Lock } from '../lock';
import { loadWorker } from '../worker';
import type { Worker } from '../worker';
import '../chrome.css';

/**
 * The Staff App chrome (§10.1): frosted header, body, frosted bottom nav,
 * profile sheet behind the avatar, and the app lock in front of all of it.
 *
 * Every working screen renders through here, which is the point: the lock
 * is not something each screen remembers to check. A screen that forgets
 * shows a blocked worker their shifts.
 *
 * The four tabs are the ones §10.4 names, in the wireframes' order. Counts
 * are passed in rather than fetched here so the nav badge and the list it
 * points at can never disagree.
 */
export type StaffTab = '/shifts' | '/invites' | '/radar' | '/documents';

export async function StaffShell({
  title,
  sub,
  active,
  shifts,
  invites,
  below,
  /**
   * Screens that are ABOUT the lock, or that must work before the worker
   * is compliant — /install and /notifications (§10.5) — render their own
   * content regardless. Everything else is gated.
   */
  ignoreLock,
  children,
}: {
  title: ReactNode;
  sub?: ReactNode;
  active?: StaffTab;
  shifts?: number;
  invites?: number;
  below?: ReactNode;
  ignoreLock?: boolean;
  children: ReactNode;
}) {
  const worker = await loadWorker();
  // No worker row (no database wired up, docs/04) means nothing to lock on.
  // Locking on an absent row would black out the whole app on the strength
  // of a failed query, which is a worse failure than the one it prevents.
  const lock: Lock = worker ? lockFor(worker) : { kind: 'none' };
  // The nav always reflects the real lock, even on a screen that renders
  // regardless of it: a blocked worker on /notifications must still see
  // Shifts, Invites and Radar closed (§10.1).
  const unlocked = reachableTabs(lock);

  const items = [
    // Documents is the compliance domain's screen (§10.4, §4.2). Until it
    // exists the tab renders as text rather than a link to a 404 — and it
    // is deliberately still shown, because it is the one tab an
    // auto-blocked worker keeps (§10.1).
    { href: '/documents', label: 'Documents', pending: true },
    { href: '/shifts', label: 'Shifts', ...(shifts ? { count: shifts } : {}) },
    { href: '/invites', label: 'Invites', ...(invites ? { count: invites } : {}) },
    { href: '/radar', label: 'Radar' },
  ].map((item) => ({ ...item, locked: !unlocked.includes(item.href) }));

  // Cases 2, 3 and 4 of §10.1 are terminal: there is no navigation to
  // offer, and the leaver's own wireframe keeps the bar only to show all
  // four closed. Case 1 keeps the bar, with three of the four locked.
  const terminal = lock.kind === 'hold' || lock.kind === 'rejected' || lock.kind === 'removed';
  const showNav = !terminal;

  const body =
    ignoreLock || lock.kind === 'none' || (lock.kind === 'documents' && active === '/documents') ? (
      <>
        <PushStatus />
        {children}
      </>
    ) : (
      <LockScreen lock={lock} />
    );

  return (
    <AppFrame>
      <AppChrome
        title={lock.kind === 'none' || ignoreLock ? title : 'The Hospitality Company'}
        {...(sub && (lock.kind === 'none' || ignoreLock) ? { sub } : {})}
        {...(below && (lock.kind === 'none' || ignoreLock) ? { below } : {})}
        worker={chromeWorker(worker, lock)}
      />
      <AppBody className={lock.kind === 'none' || ignoreLock ? undefined : 'center'}>
        {body}
      </AppBody>
      {showNav ? <BottomTabs tabs={items} {...(active ? { active } : {})} /> : null}
    </AppFrame>
  );
}

/**
 * What the profile sheet shows about the worker. Note what is NOT here:
 * `block_reason` is never loaded (see lock.ts), so no render path can
 * leak the manager's internal note (§9.6).
 */
function chromeWorker(worker: Worker | null, lock: Lock): ChromeWorker | null {
  if (!worker) return null;
  const name = `${worker.firstName} ${worker.lastName}`.trim() || 'Your profile';
  return {
    name,
    employeeId: worker.employeeId,
    // The selfie lives in Storage and is served through a signed URL the
    // onboarding session owns (§10.3 step 3). Initials until then.
    photoUrl: null,
    standing: standingFor(lock),
  };
}

function standingFor(lock: Lock): ChromeWorker['standing'] {
  switch (lock.kind) {
    case 'none':
      return { label: 'Compliant', tone: 'green' };
    case 'documents':
      return { label: 'Action needed', tone: 'coral' };
    case 'hold':
      return { label: 'On hold', tone: 'amber' };
    case 'leaver':
      return { label: 'Left', tone: 'neutral' };
    default:
      return { label: 'Closed', tone: 'neutral' };
  }
}
