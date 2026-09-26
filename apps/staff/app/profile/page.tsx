import { Alert } from '@thc/ui';
import { LoadProblem } from '../_components/LoadProblem';
import { loadBookings } from '../data';
import { ProfileShell } from './_components/ProfileShell';
import { ProfileHub } from './_components/ProfileHub';
import { LockScreen } from './_components/LockScreen';
import { appLock, canReachProfileDetails } from './lock';
import { loadEarnings, loadEmergencyContact, readProfile } from './data';
import { signOwnPhoto } from './photos';
import { expiringDocument } from './document-expiry';
import { nextPay } from './payments/earnings';
import { loadDocuments } from '../documents/data';
import '../chrome.css';
import './profile.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Profile · THC Staff' };

/**
 * /profile — the Profile tab (§10.1's profile sheet, ADR-0042), and the
 * app lock that decides whether the worker sees it at all.
 *
 * It was a sheet over whatever screen the avatar was tapped on. Since
 * ADR-0042 it is the fourth tab and the home of Documents, so it is a
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
  const read = await readProfile();
  if (read.kind === 'unconfigured') return <NotConfigured />;
  // "Could not load" is not "not configured" (audit D18): the worker gets
  // their own words and a retry, never a pointer at a setup document. And no
  // sheet — the P45 action behind it must not be offered on a guess (D16).
  if (read.kind === 'problem') return <CouldNotLoad />;

  const profile = read.profile;

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
  // is read at once. The sub-lines (next pay, a document expiring, the
  // emergency-contact nudge) are only for a worker who has those rows at
  // all. A read that fails never costs the page — but it is not "nothing
  // owed" or "nothing expiring" either (audit D18): the row says it could
  // not load, and the hub offers the retry.
  const working = canReachProfileDetails(lock);
  const [photoUrl, { rows: bookings }, earnings, documents, contact] = await Promise.all([
    signOwnPhoto(profile.photoPath),
    // The real number the §10.6 sheet quotes: confirmed bookings whose
    // shift has not started, exactly the set `request_p45()` releases. A
    // failed read leaves the count at 0, which the sheet renders as the
    // plain "taken off every shift you're booked on" — still true, just
    // without a number it could not vouch for.
    loadBookings(),
    working
      ? loadEarnings().then(
          (rows) => ({ rows, problem: false }),
          () => ({ rows: [], problem: true }),
        )
      : Promise.resolve({ rows: [], problem: false }),
    // `staff_documents()` answers every signed-in worker, so null here is a
    // failed read (the unconfigured case returned above).
    working
      ? loadDocuments().then(
          (data) => ({ data, problem: data === null }),
          () => ({ data: null, problem: true }),
        )
      : Promise.resolve({ data: null, problem: false }),
    // ADR-0044: only to decide the "Emergency contact not set" nudge.
    working
      ? loadEmergencyContact().catch(() => ({ row: null, problem: 'my_emergency_contact threw' }))
      : Promise.resolve(null),
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
        nextPay={nextPay(earnings.rows)}
        expiring={documents.data ? expiringDocument(documents.data) : null}
        emergencyContactSet={!contact || contact.problem ? null : contact.row !== null}
        unread={{
          nextPay: earnings.problem,
          documents: documents.problem,
          emergencyContact: Boolean(contact?.problem),
        }}
      />
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
