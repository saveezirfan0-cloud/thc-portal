import Link from 'next/link';
import { Alert, AuthCard } from '@thc/ui';

export const metadata = { title: 'Check your inbox · THC Back Office' };

/**
 * A2 Reset link sent — §10.2, `wireframes/backoffice/login.html` (sent).
 *
 * "If an account exists" is load-bearing: this screen is shown whether or
 * not the address exists, so it must not claim an email went to an account
 * that is not there (§1.7, no account enumeration).
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  const { to } = await searchParams;

  return (
    // The wireframe's A2 carries its headline in the green alert; the card
    // keeps A1's heading so the two read as one flow.
    <AuthCard product="Back Office" heading="Reset your password">
      <Alert tone="green">
        <b>Check your inbox.</b> If an account exists for{' '}
        {to ? <span className="mono">{to}</span> : 'that address'}, a reset link is on its way. It
        is valid for 60 minutes.
      </Alert>
      <p className="sm muted" style={{ textAlign: 'center' }}>
        The email comes from <span className="mono">admin@thehospitalitycompany.co.uk</span>. Didn’t
        get it? <Link href="/forgot">Send it again</Link>.
      </p>
      <Link href="/login" className="btn block">
        Back to sign in
      </Link>
    </AuthCard>
  );
}
