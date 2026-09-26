import Link from 'next/link';
import { Alert, AuthCard } from '@thc/ui';
import { isActivationToken } from '@thc/db/activation';
import { InviteForm } from './InviteForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Set up your login · THC Client Portal' };

/**
 * Where a Client Portal invitation from /users lands (ADR-0049). Opening the
 * page changes nothing; the token is spent when the password is saved.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; type?: string }>;
}) {
  const { token = '', type = 'invite' } = await searchParams;

  if (!isActivationToken(token)) {
    return (
      <AuthCard product="Client Portal" heading="This link is incomplete">
        <Alert tone="coral">
          Open the link again from the message you were sent, or ask the THC office for a new one.
        </Alert>
        <Link href="/login" className="btn block">
          Go to sign in
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard product="Client Portal" heading="Set up your login">
      <p className="sm muted">
        You have been given a login to the THC Client Portal. Choose a password to finish.
      </p>
      <InviteForm token={token} type={type === 'magiclink' ? 'magiclink' : 'invite'} />
    </AuthCard>
  );
}
