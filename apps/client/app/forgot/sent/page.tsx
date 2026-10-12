import { cookies } from 'next/headers';
import Link from 'next/link';
import { AuthCard } from '@thc/ui';
import { RESET_SENT_COOKIE, sentAddress } from './flash';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Check your inbox · THC Client Portal' };

const OFFICE = 'admin@thehospitalitycompany.co.uk';

/**
 * A2 Reset link sent — §10.2, `wireframes/client/login.html` (forgot → sent).
 *
 * "If … has an account" is load-bearing: this screen is shown whether or
 * not the address exists (§1.7, no account enumeration).
 *
 * The address comes from A1's flash cookie (./flash.ts), never the URL, and
 * is shown only if it parses as an email; otherwise "that address".
 */
export default async function Page() {
  const to = sentAddress((await cookies()).get(RESET_SENT_COOKIE)?.value);

  return (
    <AuthCard product="Client Portal" heading="Check your inbox">
      <p className="sm muted" style={{ textAlign: 'center' }}>
        If {to ? <b className="mono">{to}</b> : 'that address'} has an account, a reset link is on
        its way from <a href={`mailto:${OFFICE}`}>{OFFICE}</a>. The link works once.
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
