import type { ReactNode } from 'react';
import { AppBody, AppFrame } from '@thc/ui';
import { AppChrome } from './AppChrome';
import { BottomTabs } from './BottomTabs';
import { TabLockedScreen } from './DocumentsLock';
import { PushStatus } from './PushStatus';
import { LockScreen } from '../profile/_components/LockScreen';
import { appLock, reachableTabs, showsBottomNav, STAFF_TABS } from '../profile/lock';
import type { StaffTab } from '../profile/lock';
import { loadProfile } from '../profile/data';
import { signOwnPhoto } from '../profile/photos';
import type { StaffProfile } from '../profile/types';

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
 * The four tabs are `STAFF_TABS` — Shifts · Invites · Radar · Profile, with
 * Documents inside Profile (ADR-0035). Counts are passed in rather than
 * fetched here so the nav badge and the list it points at can never
 * disagree.
 */
export type { StaffTab };

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
  const profile = await loadProfile();
  // No profile (no database wired up, docs/04) means nothing to lock on.
  // Locking on an absent row would black out the whole app on the strength
  // of a failed query, which is a worse failure than the one it prevents.
  const lock = profile ? appLock(profile) : 'none';
  // §10.1: the selfie "becomes their photo across the whole system (falling
  // back to initials)" — the header included. `signOwnPhoto` is memoised
  // per request, so a screen that renders the shell and /profile's own
  // avatar in one pass signs once.
  const photoUrl = await signOwnPhoto(profile?.photoPath ?? null);
  const unlocked = reachableTabs(lock);

  // Profile is the one tab an auto-blocked worker keeps (§10.1 case 1):
  // Documents lives inside it now (ADR-0035).
  const counts: Partial<Record<StaffTab, number | undefined>> = {
    '/shifts': shifts,
    '/invites': invites,
  };
  const items = STAFF_TABS.map((tab) => {
    const count = counts[tab.href];
    return {
      href: tab.href,
      label: tab.label,
      ...(count ? { count } : {}),
      locked: !unlocked.includes(tab.href),
    };
  });

  // `showsBottomNav` (#42): the leaver keeps the bar with all four closed,
  // because the wireframe does; a hold, a rejection and a removal get no
  // bar at all, because §10.1 says the Documents tab "is not shown as an
  // action either" and a row of dead tabs reads as one.
  const open = ignoreLock || lock === 'none';
  const showNav = showsBottomNav(lock);

  return (
    <AppFrame>
      <AppChrome
        title={open ? title : 'The Hospitality Company'}
        {...(sub && open ? { sub } : {})}
        {...(below && open ? { below } : {})}
        worker={chromeWorker(profile, photoUrl)}
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
 *
 * The photo is the signed selfie URL (`profile/photos.ts`, the worker's own
 * session, ten minutes) or null, in which case `Avatar` draws initials.
 */
function chromeWorker(profile: StaffProfile | null, photoUrl: string | null) {
  if (!profile) return null;
  return {
    name: `${profile.firstName} ${profile.lastName}`.trim() || 'Your profile',
    photoUrl,
  };
}
