import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { safeNextPath } from '@thc/db';
import { createClient } from '@thc/db/server';
import { Alert, AuthCard, SignOut } from '@thc/ui';
import { DEFAULT_LANDING, landingAfterVerify } from '../two-step';
import { readTwoStep } from '../two-step-session';
import { VerifyForm } from './VerifyForm';
import '../two-step.css';
import { NO_AUTHENTICATOR, VERIFY_HEADING, VERIFY_INTRO, VERIFY_LOST_PHONE } from './copy';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Enter your code · THC Back Office' };

/**
 * /login/verify — the code step of two-step sign-in (ADR-0057).
 *
 * A public path, so the middleware never redirects it to itself; it gates
 * itself instead. No session → the sign-in form. Nothing left to check (no
 * verified factor, or already aal2) → straight on to `next`, decided by the
 * same function the middleware uses, so the two cannot bounce a request
 * between them. Sign out stays on the card: someone at a shared computer
 * who is not the owner of this login must be able to leave.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next: raw } = await searchParams;
  const next = landingAfterVerify(safeNextPath(raw, DEFAULT_LANDING));

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return (
      <AuthCard product="Back Office" heading={VERIFY_HEADING}>
        <Alert tone="amber">
          Sign-in is not available yet — this environment has no Supabase project.
        </Alert>
      </AuthCard>
    );
  }

  const supabase = createClient(await cookies()) as unknown as SupabaseClient;
  const { user, decision, totp } = await readTwoStep(supabase);
  if (!user) {
    redirect(next === DEFAULT_LANDING ? '/login' : `/login?next=${encodeURIComponent(next)}`);
  }
  if (user.app_metadata?.['role'] !== 'admin') redirect('/login');
  if (decision === 'pass') redirect(next);

  return (
    <AuthCard
      product="Back Office"
      heading={VERIFY_HEADING}
      footer={
        <>
          {VERIFY_LOST_PHONE}
          <div className="twostep-leave">
            <SignOut tone="link" size="md">
              Not you? Sign out
            </SignOut>
          </div>
        </>
      }
    >
      {totp ? (
        <VerifyForm next={next === DEFAULT_LANDING ? undefined : next} intro={VERIFY_INTRO} />
      ) : (
        <Alert tone="coral">{NO_AUTHENTICATOR}</Alert>
      )}
    </AuthCard>
  );
}
