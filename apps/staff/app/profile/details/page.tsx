import { redirect } from 'next/navigation';
import { Alert } from '@thc/ui';
import { LoadProblem } from '../../_components/LoadProblem';
import { ProfileShell } from '../_components/ProfileShell';
import { appLock, canReachProfileDetails } from '../lock';
import { loadChangeRequests, loadEmergencyContact, loadProfile, supabaseConfigured } from '../data';
import { signOwnPhoto } from '../photos';
import { DetailsForm } from './DetailsForm';
import { EmergencyContactSection } from './EmergencyContactSection';
import '../profile.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Profile details · THC Staff' };

/**
 * /profile/details — §10.1.
 *
 * The app lock is checked here, not only in the nav. A leaver's details are
 * frozen (§10.6 leaves only Payment information reachable) and a worker on
 * a manual hold has no screens at all, so both are sent back to /profile,
 * which renders their lock screen. A URL typed by hand must land in the
 * same place a tap would.
 */
export default async function Page() {
  if (!supabaseConfigured()) {
    return (
      <ProfileShell
        title="Profile details"
        back={{ href: '/profile', label: 'Profile' }}
        lock="none"
        name="THC"
      >
        <Alert tone="coral">
          This environment has no Supabase project, so your profile cannot be read. See
          docs/04-setup-github-vercel-supabase.md.
        </Alert>
      </ProfileShell>
    );
  }

  const profile = await loadProfile();
  if (!profile) redirect('/profile');

  const lock = appLock(profile);
  if (!canReachProfileDetails(lock)) redirect('/profile');

  const name = `${profile.firstName} ${profile.lastName}`.trim();
  const [photoUrl, contact, requests] = await Promise.all([
    signOwnPhoto(profile.photoPath),
    loadEmergencyContact(),
    loadChangeRequests(),
  ]);

  return (
    <ProfileShell
      title="Profile details"
      back={{ href: '/profile', label: 'Profile' }}
      lock={lock}
      name={name}
      photoUrl={photoUrl}
    >
      <DetailsForm
        profile={profile}
        photoUrl={photoUrl}
        requests={requests.rows}
        requestsProblem={requests.problem !== null}
      />
      {/* ADR-0043. A failed read says so (audit D18) rather than offering an
          empty form that would overwrite a contact we could not see. */}
      {contact.problem ? (
        <LoadProblem what="your emergency contact" />
      ) : (
        <EmergencyContactSection contact={contact.row} />
      )}
    </ProfileShell>
  );
}
