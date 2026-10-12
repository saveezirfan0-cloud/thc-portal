import { cookies } from 'next/headers';
import Link from 'next/link';
import { Alert, AuthCard } from '@thc/ui';
import { createClient } from '@thc/db/server';
import { RESET_LINK_VALIDITY } from '../forgot/copy';
import { ResetForm } from './ResetForm';
import { NOT_A_RESET_SESSION, isRecoverySession } from './recovery';
import '../login/auth-tap.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Set a new password · THC Staff' };

/**
 * A3 Set new password — §10.2, wireframes/staff/auth.html.
 *
 * Reached from the emailed recovery link (via /auth/confirm, which
 * exchanges the code for a session); activation has its own /activate. If
 * no session was left behind, the link is spent — and this says so here,
 * before the worker types a password twice for nothing. A session that was
 * NOT made by a reset link (./recovery.ts) gets a pointer to Security
 * settings instead of the form.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const configured =
    !!process.env['NEXT_PUBLIC_SUPABASE_URL'] && !!process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

  let signedIn = false;
  let recovery = false;
  if (configured) {
    const supabase = createClient(await cookies());
    const { data } = await supabase.auth.getClaims();
    signedIn = !!data?.claims?.sub;
    recovery = isRecoverySession(data?.claims);
  }

  // One message per state, as the wireframe shows it. A callback failure
  // (`?error=`) and "no session" are the same event seen twice — the
  // callback redirects here with `error` exactly when it made no session —
  // so they must not stack two coral alerts that say the same thing.
  const spent = Boolean(error) || (configured && !signedIn);

  if (spent) {
    // The expired-link variant, as the Back Office and Client Portal draw
    // it: its own heading, one line of why, and the way on.
    return (
      <AuthCard product="Staff app" heading="This link has expired">
        <Alert tone="coral">
          {error
            ? 'That link could not be opened. Reset links work once and for a limited time.'
            : `This link has expired or has already been used. Reset links are valid for ${RESET_LINK_VALIDITY}.`}
        </Alert>
        <Link href="/forgot" className="btn block">
          Request a new link
        </Link>
      </AuthCard>
    );
  }

  // Signed in, but not by a reset link (./recovery.ts): no form. setPassword
  // refuses the same session; this says so before anything is typed.
  if (configured && !recovery) {
    return (
      <AuthCard product="Staff app" heading="You’re already signed in">
        <Alert tone="amber">{NOT_A_RESET_SESSION}</Alert>
        <Link href="/profile/security" className="btn block">
          Go to Security settings
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard product="Staff app" heading="Set a new password">
      <ResetForm />
    </AuthCard>
  );
}
