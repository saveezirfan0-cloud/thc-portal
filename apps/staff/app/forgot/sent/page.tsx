import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AuthCard } from '@thc/ui';
import { RESET_LINK_VALIDITY, SENT_TO_COOKIE } from '../copy';
import { ResendButton } from './ResendButton';
import { mailAppHref } from './resend';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Check your inbox · THC Staff' };

/**
 * A2 Reset link sent — §10.2, wireframes/staff/auth.html.
 *
 * "If … is registered" is load-bearing: this screen is shown whether or
 * not the address exists, so it must not claim an email was sent to an
 * account that is not there (§1.7, no account enumeration).
 *
 * The address comes from the cookie the action set, never from the URL
 * (§1.7): a worker who lands here without one — a stale link, or the cookie
 * expired — has nothing to be shown and nothing to resend, so they go back
 * to A1 rather than to a screen that would say "that address".
 *
 * Under the copy, exactly the wireframe's two controls: "Open mail app" and
 * a throttled "Didn't get it? Resend in 0:48". No link back to sign in — A2
 * does not draw one.
 */
export default async function Page() {
  const to = (await cookies()).get(SENT_TO_COOKIE)?.value;
  if (!to) redirect('/forgot');

  const mailApp = mailAppHref((await headers()).get('user-agent'));

  return (
    <AuthCard product="Staff" heading="Check your inbox">
      <p className="sm muted">
        If <b className="cyan">{to}</b> is registered, we’ve sent a link to set a new password. It
        expires in {RESET_LINK_VALIDITY}.
      </p>
      {mailApp ? (
        <a className="btn outline block" href={mailApp}>
          Open mail app
        </a>
      ) : null}
      <ResendButton to={to} />
    </AuthCard>
  );
}
