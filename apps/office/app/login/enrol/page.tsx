import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { safeNextPath } from '@thc/db';
import { createClient } from '@thc/db/server';
import { Alert, AuthCard, SignOut } from '@thc/ui';
import { readOfficePolicy } from '../office-policy';
import { DEFAULT_LANDING, landingAfterVerify, nextLevelFor, verifyStepPath } from '../two-step';
import { EnrolStep } from './EnrolStep';
import { ENROL_HEADING, ENROL_HELP } from './copy';
import '../two-step.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Set up two-step sign-in · THC Back Office' };

/**
 * /login/enrol — the only page an office login without an authenticator
 * reaches while two-step is compulsory (ADR-0164, audit H1). Sign-out is
 * the only other way out.
 *
 * A public path (under /login), so the middleware never sends it to
 * itself; it gates itself instead, the way /login/verify does. No session →
 * the sign-in form. Not an office login → the sign-in form, where the
 * refusal lives. An authenticator already set up → the code step. Two-step
 * not compulsory after all → straight on to `next`. The set-up talks to
 * GoTrue only, never to our tables, which refuse this session until it is
 * at aal2.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next: raw } = await searchParams;
  const next = landingAfterVerify(safeNextPath(raw, DEFAULT_LANDING));

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return (
      <AuthCard product="Back Office" heading={ENROL_HEADING}>
        <Alert tone="amber">
          Sign-in is not available yet — this environment has no Supabase project.
        </Alert>
      </AuthCard>
    );
  }

  const supabase = createClient(await cookies()) as unknown as SupabaseClient;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(next === DEFAULT_LANDING ? '/login' : `/login?next=${encodeURIComponent(next)}`);
  }
  if (user.app_metadata?.['role'] !== 'admin') redirect('/login');
  if (nextLevelFor(user.factors) === 'aal2') redirect(verifyStepPath(next));
  const policy = await readOfficePolicy(supabase);
  // Could not ask: setting it up is what is wanted either way, so the step stays.
  if (policy.ok && !policy.policy.twoStepRequired) redirect(next);

  return (
    <AuthCard
      product="Back Office"
      heading={ENROL_HEADING}
      footer={
        <>
          {ENROL_HELP}
          <div className="twostep-leave">
            <SignOut tone="link" size="md">
              Not you? Sign out
            </SignOut>
          </div>
        </>
      }
    >
      <EnrolStep next={next} />
    </AuthCard>
  );
}
