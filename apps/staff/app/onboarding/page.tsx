import { redirect } from 'next/navigation';
import { Alert, MobileList, MobileRow, Pill, StaticScreen } from '@thc/ui';
import { QUIZ_ATTEMPTS, currentStep, rtwCheckInFlight, wizardPhase } from '@thc/domain';
import { LockScreen } from '../profile/_components/LockScreen';
import { loadProfile } from '../profile/data';
import { appLock } from '../profile/lock';
import { HELP_EMAIL } from '../profile/types';
import { ReviewHub } from './_components/ReviewHub';
import { RefreshWhileChecking } from '../_components/RefreshWhileChecking';
import { loadMyRtwChecks } from '../_lib/rtwCheck';
import { WizardFrame, workerFor } from './_components/Wizard';
import { loadOnboarding, supabaseConfigured } from './data';
import { requirementRows, shareCodeDoc, wizardFacts } from './state';
import './onboarding.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Onboarding · THC Staff' };

/**
 * /onboarding — §10.3. Where a candidate lands, and where every step
 * returns to when it is unsure where the worker should be next.
 *
 * It decides nothing itself: the phase and the step come from
 * `wizardPhase` / `currentStep` (packages/domain) over what the database
 * recorded, and the terminal cases from `appLock` (profile/lock.ts), the
 * same rule the rest of the app locks on.
 *
 *   awaiting interview  — Willo has not decided yet (a returning worker
 *                         after Reset to candidate, §2.12)
 *   in progress         — straight to the step that is open
 *   awaiting review     — step 4 submitted; steps 5–11 wait for the
 *                         office to verify everything (§2.9)
 *   quiz failed         — §10.1 case 3, THC's wording, identical to E4
 *   complete / closed   — the working app, whose lock takes over
 */
export default async function Page() {
  if (!supabaseConfigured()) {
    return (
      <WizardFrame worker={null}>
        <Alert tone="coral">
          This environment has no Supabase project, so onboarding cannot load. See
          docs/04-setup-github-vercel-supabase.md.
        </Alert>
      </WizardFrame>
    );
  }

  const [state, profile] = await Promise.all([loadOnboarding(), loadProfile()]);
  if (!state || !profile) {
    return (
      <WizardFrame worker={null} center>
        <StaticScreen title="We couldn’t find your onboarding">
          Please contact the office at: <b className="cyan">{HELP_EMAIL}</b>
        </StaticScreen>
      </WizardFrame>
    );
  }

  const worker = workerFor(state.firstName, state.lastName);
  const lock = appLock(profile);

  if (
    lock === 'quiz_failed' ||
    lock === 'rejected' ||
    lock === 'hold' ||
    lock === 'leaver' ||
    lock === 'removed'
  ) {
    return (
      <WizardFrame worker={worker} title="The Hospitality Company" center>
        <LockScreen lock={lock} leftAt={profile.leftAt} />
        {lock === 'quiz_failed' && state.quiz.length > 0 ? (
          <MobileList>
            {state.quiz.map((a) => (
              <MobileRow
                key={a.attemptNo}
                right={
                  <span className="mono sm coral">
                    {a.correct} / {a.total}
                  </span>
                }
              >
                <span className="sm muted">
                  Attempt {a.attemptNo} of {QUIZ_ATTEMPTS}
                </span>
              </MobileRow>
            ))}
          </MobileList>
        ) : null}
      </WizardFrame>
    );
  }

  const facts = wizardFacts(state);
  const phase = wizardPhase(facts);

  if (phase === 'complete' || phase === 'closed') redirect('/shifts');

  if (phase === 'awaiting_interview') {
    return (
      <WizardFrame worker={worker} center>
        <StaticScreen
          title="Your video interview"
          actions={
            <Pill tone="cyan" large>
              {state.status === 'interview_completed'
                ? 'Interview received'
                : 'Interview requested'}
            </Pill>
          }
        >
          {state.status === 'interview_completed'
            ? 'Thanks — the office is reviewing your interview. If you are accepted you’ll get an email, and onboarding opens here.'
            : 'We’ve emailed you a link to a short video interview (from Willo). Once the office has reviewed it you’ll get an email, and onboarding opens here.'}
        </StaticScreen>
      </WizardFrame>
    );
  }

  if (phase === 'awaiting_review') {
    const shareDoc = shareCodeDoc(state);
    const checks = shareDoc ? await loadMyRtwChecks() : {};
    const shareCheck = shareDoc ? (checks[shareDoc.id] ?? null) : null;
    return (
      <WizardFrame worker={worker} title="Documents">
        <RefreshWhileChecking
          active={shareDoc?.status === 'pending' && rtwCheckInFlight(shareCheck?.status)}
        />
        <ReviewHub
          rows={requirementRows(state)}
          shareDoc={shareDoc}
          shareCheck={shareCheck}
          dob={state.dob}
          declaration={state.declaration}
        />
      </WizardFrame>
    );
  }

  redirect(`/onboarding/${currentStep(facts) ?? 1}`);
}
