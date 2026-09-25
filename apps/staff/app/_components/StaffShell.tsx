import type { ReactNode } from 'react';
import { AppBody, AppFrame } from '@thc/ui';
import { AppChrome } from './AppChrome';
import { BottomTabs } from './BottomTabs';
import { TabLockedScreen } from './DocumentsLock';
import { PushStatus } from './PushStatus';
import { LoadProblem } from './LoadProblem';
import { LockScreen } from '../profile/_components/LockScreen';
import { appLock, reachableTabs, showsBottomNav } from '../profile/lock';
import { readProfile } from '../profile/data';
import { signOwnPhoto } from '../profile/photos';
import type { StaffProfile } from '../profile/types';
import '../chrome.css';

/**
 * The Staff App chrome (§10.1): frosted header, body, frosted bottom nav,
 * the profile behind the avatar, and the app lock in front of all of it.
 *
 * Every working screen renders through here, which is the point: the lock
 * is not something each screen remembers to check. A screen that forgets
 * shows a blocked worker their shifts.
 *
 * The RULE is `appLock()` from `profile/lock.ts` (#42) and is not restated
 * here — this file applies it. That split matters: #42 computed the lock
 * on the profile screen only, so an auto-blocked worker could still open
 * /shifts, and §10.1 says "ONLY the Documents tab is available". The rule
 * is theirs; the app-wide gate is this.
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
   * Screens that must work before the worker is compliant — /install and
   * /notifications (§10.5) — render their own content whatever the lock
   * says. The NAVIGATION still reflects it.
   */
  ignoreLock,
  /**
   * The push-health banner above the content. /notifications turns it off:
   * its whole body IS that message, and a banner saying "Show me how" would
   * point at the page it is on (wireframes/staff/auth.html, pre-prompt).
   */
  pushStatus = true,
  children,
}: {
  title: ReactNode;
  sub?: ReactNode;
  active?: StaffTab;
  shifts?: number;
  invites?: number;
  below?: ReactNode;
  ignoreLock?: boolean;
  pushStatus?: boolean;
  children: ReactNode;
}) {
  const read = await readProfile();

  // The lock is computed from this row, so a read that FAILED cannot be
  // treated as "nothing to lock on" (audit D16): that would show a held or
  // auto-blocked worker their shifts whenever `staff_me()` timed out. It
  // fails closed — no tabs, no content, a retry. Only an environment with
  // no project at all (docs/04, a developer's machine) runs unlocked.
  //
  // A screen that renders whatever the lock says (`ignoreLock`: /install,
  // /notifications) keeps its content, since no lock would have hidden it;
  // it still loses the tabs, which a failed read cannot vouch for.
  if (read.kind === 'problem') {
    return (
      <AppFrame>
        <AppChrome title={ignoreLock ? title : 'The Hospitality Company'} worker={null} />
        <AppBody className={ignoreLock ? undefined : 'center'}>
          {ignoreLock ? children : <LoadProblem what="your account" />}
        </AppBody>
      </AppFrame>
    );
  }

  const profile = read.kind === 'ok' ? read.profile : null;
  const lock = profile ? appLock(profile) : 'none';
  const unlocked = reachableTabs(lock);

  const items = [
    // Documents is the compliance domain's screen (§10.4, §4.2) — and the
    // one tab an auto-blocked worker keeps (§10.1).
    { href: '/documents', label: 'Documents' },
    { href: '/shifts', label: 'Shifts', ...(shifts ? { count: shifts } : {}) },
    { href: '/invites', label: 'Invites', ...(invites ? { count: invites } : {}) },
    { href: '/radar', label: 'Radar' },
  ].map((item) => ({ ...item, locked: !unlocked.includes(item.href) }));

  // `showsBottomNav` (#42): the leaver keeps the bar with all four closed,
  // because the wireframe does; a hold, a rejection and a removal get no
  // bar at all, because §10.1 says the Documents tab "is not shown as an
  // action either" and a row of dead tabs reads as one.
  const open = ignoreLock || lock === 'none';
  const showNav = showsBottomNav(lock);
  const worker = await chromeWorker(profile);

  return (
    <AppFrame>
      <AppChrome
        title={open ? title : 'The Hospitality Company'}
        {...(sub && open ? { sub } : {})}
        {...(below && open ? { below } : {})}
        worker={worker}
      />
      <AppBody className={open ? undefined : 'center'}>
        {open ? (
          <>
            {pushStatus ? <PushStatus /> : null}
            {children}
          </>
        ) : (
          <Locked lock={lock} profile={profile} />
        )}
      </AppBody>
      {showNav ? <BottomTabs tabs={items} {...(active ? { active } : {})} /> : null}
    </AppFrame>
  );
}

/**
 * Which screen a lock puts in place of the tab.
 *
 * The four terminal cases are #42's `LockScreen` — one implementation of
 * THC's E4 copy, of §10.6's leaver wording and of the hold sentence, used
 * both here and at /profile. `documents` and `onboarding` are NOT passed
 * to it: it falls through to the hold screen for anything it does not
 * recognise, and telling an auto-blocked worker their account is on hold
 * would be wrong in the one case where they can actually fix something.
 */
function Locked({
  lock,
  profile,
}: {
  lock: ReturnType<typeof appLock>;
  profile: StaffProfile | null;
}) {
  if (lock === 'documents' || lock === 'onboarding') {
    return (
      <TabLockedScreen
        blockers={profile?.blockers ?? []}
        blockKind={profile?.blockKind ?? null}
        onboarding={lock === 'onboarding'}
      />
    );
  }
  return <LockScreen lock={lock} leftAt={profile?.leftAt ?? null} />;
}

/**
 * What the header shows about the worker. Note what is NOT here:
 * `staff_me()` does not return `block_reason` and `StaffProfile` has no
 * field for it (#42, types.ts), so there is no path from a manager's
 * internal note (§9.6) to this app's markup.
 */
async function chromeWorker(profile: StaffProfile | null) {
  if (!profile) return null;
  return {
    name: `${profile.firstName} ${profile.lastName}`.trim() || 'Your profile',
    // §10.1: the square selfie is the header avatar. It is signed with the
    // worker's OWN session — `photos_worker_read_own` lets a worker read
    // `<staff_id>/…` — so no service key is involved, and the path comes
    // from `staff_me()`, never from the browser. A Storage failure falls
    // back to initials rather than failing the screen.
    photoUrl: await signOwnPhoto(profile.photoPath),
  };
}
