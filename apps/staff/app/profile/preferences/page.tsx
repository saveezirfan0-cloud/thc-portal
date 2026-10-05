import { redirect } from 'next/navigation';
import { Alert, TimeFormatProvider } from '@thc/ui';
import { ProfileShell } from '../_components/ProfileShell';
import { appLock, canReachProfileDetails } from '../lock';
import { loadProfile, supabaseConfigured } from '../data';
import { signOwnPhoto } from '../photos';
import { loadSavedTimeFormat } from './data';
import { PreferencesForm } from './PreferencesForm';
import '../profile.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Preferences · THC Staff' };

/**
 * /profile/preferences — Time format (ADR-0085).
 *
 * Reachable by the same workers as Security settings: anyone whose profile
 * is open to edits (`canReachProfileDetails`). A candidate in the wizard, a
 * hold and a leaver have nothing to arrange here and land back on /profile,
 * which draws whatever their lock is.
 *
 * The form starts on the PROFILE's value, not the device's: on a new phone
 * the cookie is missing, and on a phone another login used it is wrong. The
 * provider wrapped round the form writes the cookie back when the two
 * disagree, so the rest of the app catches up on the next screen.
 */
export default async function Page() {
  if (!supabaseConfigured()) {
    return (
      <ProfileShell
        title="Preferences"
        back={{ href: '/profile', label: 'Profile' }}
        lock="none"
        name="THC"
      >
        <Alert tone="coral">
          This environment has no Supabase project, so your preferences cannot be read. See
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
  const { format, cookie } = await loadSavedTimeFormat();

  return (
    <ProfileShell
      title="Preferences"
      back={{ href: '/profile', label: 'Profile' }}
      lock={lock}
      name={name}
      photoUrl={await signOwnPhoto(profile.photoPath)}
    >
      <TimeFormatProvider format={format} remember={cookie !== format}>
        <PreferencesForm saved={format} />
      </TimeFormatProvider>
    </ProfileShell>
  );
}
