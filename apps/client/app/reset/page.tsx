import { cookies } from 'next/headers';
import Link from 'next/link';
import { Alert, AuthCard } from '@thc/ui';
import { createClient } from '@thc/db/server';
import { ResetForm } from './ResetForm';
import { NOT_A_RESET_SESSION, accountEmail, isRecoverySession } from './recovery';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Set a new password · THC Client Portal' };

/**
 * A3 Set new password — §10.2, `wireframes/public/activate.html` (reset,
 * and its "Link expired" variant).
 *
 * Reached from the emailed recovery link via /auth/confirm, which
 * exchanges the code for a session. If that left no session behind, the
 * link is spent — and this says so here, before a password is typed twice
 * for nothing. A session that was NOT made by a reset link (./recovery.ts)
 * gets a pointer to Your account → Change password instead of the form.
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
  let email: string | null = null;
  if (configured) {
    const supabase = createClient(await cookies());
    const { data } = await supabase.auth.getClaims();
    signedIn = !!data?.claims?.sub;
    recovery = isRecoverySession(data?.claims);
    email = accountEmail(data?.claims);
  }

  // A link that arrived without its token (/auth/confirm or /auth/callback
  // sent `?error=missing`): nothing expired — the address was cut short,
  // usually by an email client wrapping it. Say so, so the customer tries
  // the whole link before asking for another.
  if (error === 'missing') {
    return (
      <AuthCard product="Client Portal" heading="This link is incomplete">
        <Alert tone="amber">
          This link is incomplete — copy the whole link from the email, or ask for a new one.
        </Alert>
        <Link href="/forgot" className="btn block">
          Request a new link
        </Link>
      </AuthCard>
    );
  }

  if (error || (configured && !signedIn)) {
    return (
      <AuthCard product="Client Portal" heading="This link has expired">
        <Alert tone="coral">
          Reset links work once and for a limited time. Request a new one and use the newest email.
        </Alert>
        <Link href="/forgot" className="btn block">
          Request a new link
        </Link>
      </AuthCard>
    );
  }

  // Signed in, but not by a reset link: a password session must not be
  // able to set a new password without the current one (setPassword
  // refuses it too). Said here, before anything is typed.
  if (configured && !recovery) {
    return (
      <AuthCard product="Client Portal" heading="You’re already signed in">
        <Alert tone="amber">{NOT_A_RESET_SESSION}</Alert>
        <Link href="/client/account" className="btn block">
          Go to Your account
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard product="Client Portal" heading="Set a new password">
      {/* "For hannah.brooks@…" (activate.html, A3): whose password this
          is, from the reset session itself — said only when it has one. */}
      <ResetForm email={email} />
    </AuthCard>
  );
}
