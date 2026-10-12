import { cookies } from 'next/headers';
import Link from 'next/link';
import { Alert, AuthCard } from '@thc/ui';
import { readRecoverySession } from '@thc/db/recovery';
import type { RecoverySession } from '@thc/db/recovery';
import { createClient } from '@thc/db/server';
import { RESET_LINK_VALIDITY } from '../forgot/copy';
import { USE_SECURITY_SETTINGS } from './copy';
import { ResetForm } from './ResetForm';
import '../login/auth-tap.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Set a new password · THC Staff' };

/**
 * A3 Set new password — §10.2, wireframes/staff/auth.html.
 *
 * Reached two ways: from the emailed recovery link (via /auth/confirm,
 * which exchanges the code for a session) and from an activation link. If
 * neither left a session behind, the link is spent — and this says so
 * here, before the worker types a password twice for nothing. So is a
 * session that is not a reset link opened in the last 15 minutes
 * (packages/db/src/recovery.ts): the action would refuse it.
 *
 * The form names the account it is for, from the verified session: a reset
 * link someone else opened on this phone (login CSRF) shows THEIR address.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const configured =
    !!process.env['NEXT_PUBLIC_SUPABASE_URL'] && !!process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

  let session: RecoverySession = { state: 'none', email: null };
  if (configured) session = await readRecoverySession(createClient(await cookies()));

  // One message per state, as the wireframe shows it. A callback failure
  // (`?error=`) and "no session" are the same event seen twice — the
  // callback redirects here with `error` exactly when it made no session —
  // so they must not stack two coral alerts that say the same thing.
  const spent = Boolean(error) || (configured && session.state !== 'recent');

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
        {!error && session.state === 'other' ? (
          <p className="sm muted">{USE_SECURITY_SETTINGS}</p>
        ) : null}
        <Link href="/forgot" className="btn block">
          Request a new link
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard product="Staff app" heading="Set a new password">
      {session.email ? (
        <p className="sm muted">
          You are signing in as <b className="cyan">{session.email}</b>.
        </p>
      ) : null}
      <ResetForm />
    </AuthCard>
  );
}
