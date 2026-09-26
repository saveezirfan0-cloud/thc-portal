import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Alert } from '@thc/ui';
import { isChangeKind } from '@thc/domain';
import { ProfileShell } from '../../_components/ProfileShell';
import { appLock, canReachProfileDetails } from '../../lock';
import { loadChangeRequests, loadProfile, supabaseConfigured } from '../../data';
import { signOwnPhoto } from '../../photos';
import { canRequest, statusLine } from '../../change-requests';
import { ChangeStatus } from '../ChangeStatus';
import { NameRequestForm } from './NameRequestForm';
import { PhotoRequestForm } from './PhotoRequestForm';
import '../../profile.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Request a change · THC Staff' };

/**
 * /profile/details/request?kind=name|photo — Request a change (ADR-0044,
 * docs/19 §3, `wireframes/staff/request-change.html`).
 *
 * The in-app route for what §10.1 locks. The name and the photo stay
 * locked; this asks the office, which decides on /staff/requests.
 *
 * Reached from the locked name row and the locked photo on Profile
 * details, with the same lock rule as that screen: a leaver or a worker on
 * a hold is sent back to /profile. A photo request needs a photo to
 * replace — a worker without one sets it directly on Profile details. And
 * while a request of this kind is pending, the page shows it (with
 * Withdraw) instead of a second form the database would refuse.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string | string[] }>;
}) {
  const raw = (await searchParams).kind;
  const kind = typeof raw === 'string' && isChangeKind(raw) ? raw : null;
  const title = kind === 'photo' ? 'New profile photo' : 'Change your name';
  const back = { href: '/profile/details', label: 'Profile details' };

  if (!supabaseConfigured()) {
    return (
      <ProfileShell title={title} back={back} lock="none" name="THC">
        <Alert tone="coral">
          This environment has no Supabase project, so nothing can be requested. See
          docs/04-setup-github-vercel-supabase.md.
        </Alert>
      </ProfileShell>
    );
  }
  if (!kind) redirect('/profile/details');

  const profile = await loadProfile();
  if (!profile) redirect('/profile');
  const lock = appLock(profile);
  if (!canReachProfileDetails(lock)) redirect('/profile');
  if (kind === 'photo' && !profile.photoLocked) redirect('/profile/details');

  const name = `${profile.firstName} ${profile.lastName}`.trim();
  const [photoUrl, requests] = await Promise.all([
    signOwnPhoto(profile.photoPath),
    loadChangeRequests(),
  ]);

  return (
    <ProfileShell title={title} back={back} lock={lock} name={name} photoUrl={photoUrl}>
      {canRequest(requests, kind) ? (
        kind === 'name' ? (
          <NameRequestForm firstName={profile.firstName} lastName={profile.lastName} />
        ) : (
          <PhotoRequestForm name={name} currentUrl={photoUrl} />
        )
      ) : (
        <>
          <ChangeStatus kind={kind} line={statusLine(requests, kind)} />
          <Link className="btn outline block" href="/profile/details">
            Back to Profile details
          </Link>
        </>
      )}
    </ProfileShell>
  );
}
