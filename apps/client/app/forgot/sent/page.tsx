import Link from 'next/link';
import { AuthCard } from '@thc/ui';
import { shownEmail } from '@thc/db/recovery';

export const metadata = { title: 'Check your inbox · THC Client Portal' };

const OFFICE = 'admin@thehospitalitycompany.co.uk';

/**
 * A2 Reset link sent — §10.2, `wireframes/client/login.html` (forgot → sent).
 *
 * "If … has an account" is load-bearing: this screen is shown whether or
 * not the address exists (§1.7, no account enumeration).
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  // Only ever an address: `?to=` is anybody's to write (shownEmail).
  const to = shownEmail((await searchParams).to);

  return (
    <AuthCard product="Client Portal" heading="Check your inbox">
      {/* The wireframe's envelope tile over the heading (login.html, A2);
          auth-main.css lifts it above the h2 the card draws first. */}
      <span className="logo auth-mail-ico" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <rect x="3" y="5.5" width="18" height="13" rx="2" />
          <path d="M3.8 7l8.2 6 8.2-6" />
        </svg>
      </span>
      <p className="sm muted" style={{ textAlign: 'center' }}>
        If {to ? <b className="mono">{to}</b> : 'that address'} has an account, a reset link is on
        its way from <a href={`mailto:${OFFICE}`}>{OFFICE}</a>. The link works once.
      </p>
      <div className="row" style={{ justifyContent: 'center', gap: 'var(--sp-10)' }}>
        <Link href="/forgot" className="xs auth-link">
          Didn’t get it? Send it again
        </Link>
        <Link href="/login" className="xs auth-link">
          ← Back to sign in
        </Link>
      </div>
    </AuthCard>
  );
}
