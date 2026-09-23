import Link from 'next/link';
import { AuthCard } from '@thc/ui';

export const metadata = { title: 'Check your inbox · THC Staff' };

/**
 * A2 Reset link sent — §10.2, wireframes/staff/auth.html.
 *
 * "If … is registered" is load-bearing: this screen is shown whether or
 * not the address exists, so it must not claim an email was sent to an
 * account that is not there (§1.7, no account enumeration).
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  const { to } = await searchParams;

  return (
    <AuthCard product="Staff" heading="Check your inbox">
      <p className="sm muted">
        If {to ? <b className="cyan">{to}</b> : 'that address'} is registered, we’ve sent a link to
        set a new password. It expires in 60 minutes.
      </p>
      <p className="xs muted">
        The email comes from admin@thehospitalitycompany.co.uk. Open the link on this phone so you
        land back in the app.
      </p>
      <div className="row" style={{ justifyContent: 'center', gap: 'var(--sp-10)' }}>
        <Link href="/forgot" className="sm">
          Didn’t get it? Send it again
        </Link>
        <Link href="/login" className="sm">
          Back to sign in
        </Link>
      </div>
    </AuthCard>
  );
}
