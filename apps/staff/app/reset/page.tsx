import { cookies } from 'next/headers';
import Link from 'next/link';
import { Alert, AuthCard } from '@thc/ui';
import { createClient } from '@thc/db/server';
import { ResetForm } from './ResetForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Set a new password · THC Staff' };

/**
 * A3 Set new password — §10.2, wireframes/staff/auth.html.
 *
 * Reached two ways: from the emailed recovery link (via /auth/callback,
 * which exchanges the code for a session) and from an activation link. If
 * neither left a session behind, the link is spent — and this says so
 * here, before the worker types a password twice for nothing.
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

  return (
    <AuthCard product="Staff" heading="Set a new password">
      {error ? (
        <Alert tone="coral">
          That link could not be opened. Ask for a new one from the sign-in screen.
        </Alert>
      ) : null}
      {configured && !signedIn ? (
        <>
          <Alert tone="coral">
            This link has expired or has already been used. Reset links are valid for 60 minutes.
          </Alert>
          <p className="sm muted">
            <Link href="/forgot">Send me a new link</Link>
          </p>
        </>
      ) : (
        <ResetForm />
      )}
    </AuthCard>
  );
}
