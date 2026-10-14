import { cookies } from 'next/headers';
import { AuthCard } from '@thc/ui';
import { createClient } from '@thc/db/server';
import { ForgotForm } from './ForgotForm';
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

async function signedInEmail(): Promise<string | null> {
  if (!process.env['NEXT_PUBLIC_SUPABASE_URL'] || !process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
    return null;
  }
  const {
    data: { user },
  } = await createClient(await cookies()).auth.getUser();
  return user?.email ?? null;
}
