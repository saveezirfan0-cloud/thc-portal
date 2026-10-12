import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthCard, Button } from '@thc/ui';
import { safeNextPath } from '@thc/db';
import { continueReset } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Reset your password · THC Client Portal',
  // The token is in this page's URL: no Referer carries it anywhere.
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

/**
 * Between the emailed reset link and A3 (§10.2, ADR-0039).
 *
 * Opening the link spends nothing: mail scanners and link previews open it
 * first, and a GET that verified the token burned it before the person
 * clicked. The token is spent by the button, a POST from this page
 * (./actions.ts), exactly as the Staff App's /activate does it.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; next?: string }>;
}) {
  const { token_hash: tokenHash, next } = await searchParams;
  if (!tokenHash) redirect('/reset?error=missing');

  return (
    <AuthCard product="Client Portal" heading="Reset your password">
      <form action={continueReset} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <input type="hidden" name="token_hash" value={tokenHash} />
        <input type="hidden" name="next" value={safeNextPath(next, '/reset')} />
        <Button type="submit" tone="primary" size="lg" block>
          Continue
        </Button>
      </form>
    </AuthCard>
  );
}
