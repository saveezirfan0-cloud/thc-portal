import { Alert } from '@thc/ui';
import { LoadProblem } from '../_components/LoadProblem';
import { loadBookings } from '../data';
import { ProfileShell } from './_components/ProfileShell';
import { ProfileSheet } from './_components/ProfileSheet';
import { LockScreen } from './_components/LockScreen';
import { appLock } from './lock';
import { readProfile } from './data';
import { signOwnPhoto } from './photos';
import '../chrome.css';
import './profile.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Profile · THC Staff' };

/**
 * /profile — the profile sheet (§10.1), and the app lock that decides
 * whether the worker sees it at all.
 *
 * The sheet is a sheet, not a page: §10.1 opens it from the avatar over
 * whatever screen the worker was on, and tapping the dimmed backdrop
 * returns them there. Giving it a URL as well is what makes it linkable
 * from a push, from the leaver screen and from the three screens beneath
 * it, without a second implementation.
 *
 * Three of §10.1's four lock cases replace it entirely — and the fourth,
 * the documents auto-block, does not: a worker with an expired passport
 * still has a profile, still has bank details to correct and still has
 * earnings to look at. Only Shifts, Invites and Radar close for them
 * (§4.3), which is what `reachableTabs()` says and what the nav shows.
 */
export default async function Page() {
  const read = await readProfile();
  if (read.kind === 'unconfigured') return <NotConfigured />;
  // "Could not load" is not "not configured" (audit D18): the worker gets
  // their own words and a retry, never a pointer at a setup document. And no
  // sheet — the P45 action behind it must not be offered on a guess (D16).
  if (read.kind === 'problem') return <CouldNotLoad />;

  const profile = read.profile;

  const lock = appLock(profile);
  const name = `${profile.firstName} ${profile.lastName}`.trim();
  const photoUrl = await signOwnPhoto(profile.photoPath);

  if (lock !== 'none' && lock !== 'documents' && lock !== 'onboarding') {
    return (
      <ProfileShell title="The Hospitality Company" lock={lock} name={name} photoUrl={photoUrl}>
        <LockScreen lock={lock} leftAt={profile.leftAt} />
      </ProfileShell>
    );
  }

  // The real number the §10.6 sheet quotes: confirmed bookings whose shift
  // has not started, which is exactly the set `request_p45()` releases.
  // A failed read leaves the count at 0, which the sheet renders as the
  // plain "taken off every shift you're booked on" — still true, just
  // without a number it could not vouch for.
  const { rows: bookings } = await loadBookings();
  const now = Date.now();
  const futureShifts = bookings.filter(
    (booking) => booking.status === 'confirmed' && booking.startsAt.getTime() > now,
  ).length;

  return (
    <ProfileShell title="Profile" lock={lock} name={name} photoUrl={photoUrl}>
      <ProfileSheet profile={profile} photoUrl={photoUrl} futureShifts={futureShifts} />
    </ProfileShell>
  );
}

function CouldNotLoad() {
  return (
    <ProfileShell title="Profile" lock="none" name="THC" nav={false}>
      <LoadProblem what="your profile" />
    </ProfileShell>
  );
}

function NotConfigured() {
  return (
    <ProfileShell title="Profile" lock="none" name="THC">
      <Alert tone="coral">
        This environment has no Supabase project, so your profile cannot be read. See
        docs/04-setup-github-vercel-supabase.md.
      </Alert>
    </ProfileShell>
  );
}
