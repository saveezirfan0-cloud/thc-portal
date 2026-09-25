import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Alert } from '@thc/ui';
import { isReferralCode, referralLink } from '@thc/domain';
import { ProfileShell } from '../_components/ProfileShell';
import { appLock } from '../lock';
import { loadProfile, supabaseConfigured } from '../data';
import { signOwnPhoto } from '../photos';
import { staffDb } from '../../db';
import { publicOrigin } from './model';
import { ReferScreen } from './ReferScreen';
import '../profile.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Refer a friend · THC Staff' };

/**
 * /profile/refer — Refer a friend (ADR-0040, docs/18 §5,
 * `wireframes/staff/refer.html`).
 *
 * Compliant workers only, with nothing locking the app: a worker who is not
 * working for THC right now has no link to share. The code is minted the
 * first time this screen opens (`my_referral_code()`) and never changes;
 * the count is `my_referral_summary()`'s — a number, never names.
 */
export default async function Page() {
  if (!supabaseConfigured()) {
    return (
      <ProfileShell
        title="Refer a friend"
        back={{ href: '/profile', label: 'Profile' }}
        lock="none"
        name="THC"
      >
        <Alert tone="coral">
          This environment has no Supabase project, so there is no link to share. See
          docs/04-setup-github-vercel-supabase.md.
        </Alert>
      </ProfileShell>
    );
  }

  const profile = await loadProfile();
  if (!profile) redirect('/profile');
  const lock = appLock(profile);
  if (lock !== 'none' || profile.status !== 'compliant') redirect('/profile');

  const supabase = staffDb(await cookies());
  const [photoUrl, minted, summary, head] = await Promise.all([
    signOwnPhoto(profile.photoPath),
    supabase.rpc('my_referral_code', {}),
    supabase.rpc('my_referral_summary', {}),
    headers(),
  ]);
  const name = `${profile.firstName} ${profile.lastName}`.trim();
  const code = typeof minted.data === 'string' ? minted.data : null;
  const applied = Number((summary.data as { applied?: number } | null)?.applied ?? 0);
  const origin = publicOrigin(
    {
      NEXT_PUBLIC_STAFF_URL: process.env['NEXT_PUBLIC_STAFF_URL'],
      VERCEL_URL: process.env['VERCEL_URL'],
      VERCEL_ENV: process.env['VERCEL_ENV'],
      NODE_ENV: process.env.NODE_ENV,
    },
    {
      host: head.get('x-forwarded-host') ?? head.get('host'),
      proto: head.get('x-forwarded-proto'),
    },
  );

  return (
    <ProfileShell
      title="Refer a friend"
      back={{ href: '/profile', label: 'Profile' }}
      lock={lock}
      name={name}
      photoUrl={photoUrl}
    >
      {origin && code && isReferralCode(code) ? (
        <ReferScreen link={referralLink(origin, code)} applied={applied} />
      ) : (
        <Alert tone="coral">We couldn’t load your link. Please try again.</Alert>
      )}
    </ProfileShell>
  );
}
