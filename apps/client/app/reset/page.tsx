import { cookies } from 'next/headers';
import Link from 'next/link';
import { Alert, AuthCard } from '@thc/ui';
import { createClient } from '@thc/db/server';
import { ResetForm } from './ResetForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Set a new password · THC Client Portal' };

/**
 * A3 Set new password — §10.2, `wireframes/public/activate.html` (reset,
 * and its "Link expired" variant).
 *
 * Reached from the emailed recovery link via /auth/confirm, which
 * exchanges the code for a session. If that left no session behind, the
 * link is spent — and this says so here, before a password is typed twice
 * for nothing.
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
  if (configured) {
    const supabase = createClient(await cookies());
    const {
      data: { user },
    } = await supabase.auth.getUser();
    signedIn = !!user;
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

  return (
    <AuthCard product="Client Portal" heading="Set a new password">
      <ResetForm />
    </AuthCard>
  );
}
