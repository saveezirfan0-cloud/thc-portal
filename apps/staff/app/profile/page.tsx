import { Alert } from '@thc/ui';
import { loadBookings } from '../data';
import { ProfileShell } from './_components/ProfileShell';
import { ProfileHub } from './_components/ProfileHub';
import { LockScreen } from './_components/LockScreen';
import { appLock, canReachProfileDetails } from './lock';
import { loadEarnings, loadProfile, supabaseConfigured } from './data';
import { signOwnPhoto } from './photos';
import { expiringDocument } from './document-expiry';
import { nextPay } from './payments/earnings';
import { loadDocuments } from '../documents/data';
import './profile.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Profile · THC Staff' };

/**
 * /profile — the Profile tab (§10.1's profile sheet, ADR-0035), and the
 * app lock that decides whether the worker sees it at all.
 *
 * It was a sheet over whatever screen the avatar was tapped on. Since
 * ADR-0035 it is the fourth tab and the home of Documents, so it is a
 * screen: the avatar still opens it, and so does the nav.
 *
 * Three of §10.1's four lock cases replace it entirely — and the fourth,
 * the documents auto-block, does not: a worker with an expired passport
 * still has a profile, still has bank details to correct, still has
 * earnings to look at — and reaches Documents from here to fix the
 * passport. Only Shifts, Invites and Radar close for them (§4.3), which is
 * what `reachableTabs()` says and what the nav shows.
 */
export default async function Page() {
  if (!supabaseConfigured()) return <NotConfigured />;

  const profile = await loadProfile();
  if (!profile) return <NotConfigured />;

  const lock = appLock(profile);
  const name = `${profile.firstName} ${profile.lastName}`.trim();

  if (lock !== 'none' && lock !== 'documents' && lock !== 'onboarding') {
    const photoUrl = await signOwnPhoto(profile.photoPath);
    return (
      <ProfileShell title="The Hospitality Company" lock={lock} name={name} photoUrl={photoUrl}>
        <LockScreen lock={lock} leftAt={profile.leftAt} />
      </ProfileShell>
    );
  }

  // Everything after the profile is independent of everything else, so it
  // is read at once. The two sub-lines (next pay, a document expiring) are
  // only for a worker who has the Documents and Payment rows at all, and
  // either read failing costs its line, never the page.
  const working = canReachProfileDetails(lock);
  const [photoUrl, bookings, earnings, documents] = await Promise.all([
    signOwnPhoto(profile.photoPath),
    // The real number the §10.6 sheet quotes: confirmed bookings whose
    // shift has not started, exactly the set `request_p45()` releases.
    loadBookings(),
    working ? loadEarnings().catch(() => []) : Promise.resolve([]),
    working ? loadDocuments().catch(() => null) : Promise.resolve(null),
  ]);
  const now = Date.now();
  const futureShifts = bookings.filter(
    (booking) => booking.status === 'confirmed' && booking.startsAt.getTime() > now,
  ).length;

  return (
    <ProfileShell title="Profile" lock={lock} name={name} photoUrl={photoUrl}>
      <ProfileHub
        profile={profile}
        photoUrl={photoUrl}
        futureShifts={futureShifts}
        nextPay={nextPay(earnings)}
        expiring={documents ? expiringDocument(documents) : null}
      />
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
