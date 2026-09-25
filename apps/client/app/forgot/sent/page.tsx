import Link from 'next/link';
import { AuthCard } from '@thc/ui';

export const metadata = { title: 'Check your inbox · THC Client Portal' };

/**
 * A2 Reset link sent — §10.2, `wireframes/client/login.html` (forgot → sent).
 *
 * "If … has an account" is load-bearing: this screen is shown whether or
 * not the address exists (§1.7, no account enumeration).
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  const { to } = await searchParams;

  return (
    <AuthCard product="Client Portal" heading="Check your inbox">
      <p className="sm muted" style={{ textAlign: 'center' }}>
        If {to ? <b className="mono">{to}</b> : 'that address'} has an account, a reset link is on
        its way from admin@thehospitalitycompany.co.uk. The link works once.
      </p>
      <div className="row" style={{ justifyContent: 'center', gap: 'var(--sp-10)' }}>
        <Link href="/forgot" className="xs">
          Didn’t get it? Send it again
        </Link>
        <Link href="/login" className="xs">
          ← Back to sign in
        </Link>
      </div>
    </AuthCard>
  );
}
