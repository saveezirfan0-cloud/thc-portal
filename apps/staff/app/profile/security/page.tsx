import { redirect } from 'next/navigation';
import { Alert } from '@thc/ui';
import { ProfileShell } from '../_components/ProfileShell';
import { appLock, canReachProfileDetails } from '../lock';
import { loadProfile, supabaseConfigured } from '../data';
import { signOwnPhoto } from '../photos';
import { SecurityForm } from './SecurityForm';
import '../profile.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Security settings · THC Staff' };

/** /profile/security — §10.1's Security settings screen. */
export default async function Page() {
  if (!supabaseConfigured()) {
    return (
      <ProfileShell
        title="Security settings"
        back={{ href: '/profile', label: 'Profile' }}
        lock="none"
        name="THC"
      >
        <Alert tone="coral">
          This environment has no Supabase project, so your account cannot be read. See
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

  return (
    <ProfileShell
      title="Security settings"
      back={{ href: '/profile', label: 'Profile' }}
      lock={lock}
      name={name}
      photoUrl={await signOwnPhoto(profile.photoPath)}
    >
      <SecurityForm email={profile.email} />
    </ProfileShell>
  );
}
