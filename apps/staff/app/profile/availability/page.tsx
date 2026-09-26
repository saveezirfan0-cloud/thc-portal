import { redirect } from 'next/navigation';
import { Alert } from '@thc/ui';
import { LoadProblem } from '../../_components/LoadProblem';
import { ProfileShell } from '../_components/ProfileShell';
import { appLock } from '../lock';
import { loadProfile, supabaseConfigured } from '../data';
import { signOwnPhoto } from '../photos';
import { loadUnavailability } from './data';
import { AvailabilityScreen } from './AvailabilityScreen';
import '../profile.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Availability · THC Staff' };

/**
 * /profile/availability — days and times the worker can't work (ADR-0043,
 * docs/19 §1, `wireframes/staff/availability.html`).
 *
 * Only when `appLock() === 'none'`. Availability steers auto-assign's
 * invitations, and a worker in any lock case is not being invited: the
 * documents-blocked worker has one thing to do (Documents), and every other
 * lock is a static screen. A URL typed by hand lands where a tap would —
 * back on /profile, which draws whatever the lock is.
 */
export default async function Page() {
  if (!supabaseConfigured()) {
    return (
      <ProfileShell
        title="Availability"
        back={{ href: '/profile', label: 'Profile' }}
        lock="none"
        name="THC"
      >
        <Alert tone="coral">
          This environment has no Supabase project, so your availability cannot be read. See
          docs/04-setup-github-vercel-supabase.md.
        </Alert>
      </ProfileShell>
    );
  }

  const profile = await loadProfile();
  if (!profile) redirect('/profile');
  const lock = appLock(profile);
  if (lock !== 'none') redirect('/profile');

  const name = `${profile.firstName} ${profile.lastName}`.trim();
  const [photoUrl, entries] = await Promise.all([
    signOwnPhoto(profile.photoPath),
    loadUnavailability(),
  ]);

  return (
    <ProfileShell
      title="Availability"
      back={{ href: '/profile', label: 'Profile' }}
      lock={lock}
      name={name}
      photoUrl={photoUrl}
    >
      {entries.problem ? (
        // Audit D18: a failed read is not an empty calendar.
        <LoadProblem what="your availability" />
      ) : (
        <AvailabilityScreen
          entries={entries.rows.map((e) => ({
            ...e,
            startsAt: e.startsAt.toISOString(),
            endsAt: e.endsAt.toISOString(),
          }))}
        />
      )}
    </ProfileShell>
  );
}
