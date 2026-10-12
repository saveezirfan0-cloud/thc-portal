import { cookies } from 'next/headers';
import Link from 'next/link';
import { Alert, AuthCard } from '@thc/ui';
import { readRecoverySession } from '@thc/db/recovery';
import type { RecoverySession } from '@thc/db/recovery';
import { createClient } from '@thc/db/server';
import { USE_ACCOUNT_SCREEN } from './copy';
import { ResetForm } from './ResetForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Set a new password · THC Back Office' };

/**
 * A3 Set new password — §10.2, `wireframes/public/activate.html` (reset,
 * and its "Link expired" variant).
 *
 * Reached from the emailed recovery link via /auth/confirm, which
 * exchanges the code for a session. If that left no session behind, the
 * link is spent — and this says so here, before a password is typed twice
 * for nothing. So is a session that is not a reset link opened in the last
 * 15 minutes (packages/db/src/recovery.ts): the action would refuse it.
 *
 * The form names the account it is for, from the verified session: a reset
 * link someone else opened in this browser (login CSRF) shows THEIR address.
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

  if (error || (configured && session.state !== 'recent')) {
    return (
      <AuthCard product="Back Office" heading="This link has expired">
        <Alert tone="coral">
          Reset links work once and for a limited time. Request a new one and use the newest email.
        </Alert>
        {!error && session.state === 'other' ? (
          <p className="sm muted">{USE_ACCOUNT_SCREEN}</p>
        ) : null}
        <Link href="/forgot" className="btn block">
          Request a new link
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard product="Back Office" heading="Set a new password">
      {session.email ? (
        <p className="sm muted">
          Setting a new password for <b className="mono">{session.email}</b>.
        </p>
      ) : null}
      <ResetForm />
    </AuthCard>
  );
}
