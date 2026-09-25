import Link from 'next/link';
import { Alert } from '@thc/ui';
import { RESET_SENDER } from '../copy';

/**
 * A2's card body — wireframes/backoffice/login.html:77-79.
 *
 * "If an account exists for …" is load-bearing: this screen is shown
 * whether or not the address is registered, so it must not claim an email
 * was sent to an account that is not there (§1.7, no account enumeration).
 * The wording is identical either way.
 */
export function SentBody({ to }: { to?: string }) {
  return (
    <>
      <Alert tone="green">
        <b>Check your inbox.</b> If an account exists for{' '}
        {to ? <span className="mono">{to}</span> : 'that address'}, a reset link is on its way. It
        is valid for 60 minutes.
      </Alert>
      <p className="sm muted" style={{ textAlign: 'center' }}>
        The email comes from <span className="mono">{RESET_SENDER}</span>. Replies go to a monitored
        THC mailbox.
      </p>
      <Link href="/login" className="btn block">
        Back to sign in
      </Link>
    </>
  );
}
