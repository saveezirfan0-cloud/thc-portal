import { AuthCard } from '@thc/ui';
import { ForgotForm } from './ForgotForm';
import { signedInEmail } from './signed-in';
import '../login/auth-tap.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Forgot password · THC Staff' };

/**
 * A1 Forgot password — §10.2, wireframes/staff/auth.html.
 *
 * Also reached signed in, from "Forgot password?" beside every Current
 * password field (the wizard's step 9, Bank & payroll, email change, P45,
 * Security). The address is then the session's own, filled in so the worker
 * does not type it on a phone — and the way back is to the app, not to a
 * sign-in screen they are already past. Signed out, nothing is filled in:
 * the address is whatever the worker types (§1.7).
 */
export default async function Page() {
  return (
    <AuthCard product="Staff app" heading="Forgot your password?">
      <ForgotForm signedInAs={await signedInEmail()} />
    </AuthCard>
  );
}
