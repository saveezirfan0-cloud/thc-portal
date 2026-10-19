import { redirect } from 'next/navigation';
import { Alert, MobileList, MobileRow, Pill, StaticScreen } from '@thc/ui';
import { currentStep, rtwCheckInFlight, wizardPhase } from '@thc/domain';
import { LockScreen } from '../profile/_components/LockScreen';
import { loadProfile } from '../profile/data';
import { appLock } from '../profile/lock';
import { signOwnPhoto } from '../profile/photos';
import { HELP_EMAIL } from '../profile/types';
import { ReviewHub } from './_components/ReviewHub';
import { RefreshWhileChecking } from '../_components/RefreshWhileChecking';
import { loadMyRtwChecks } from '../_lib/rtwCheck';
import type { MyRtwChecks } from '../_lib/rtwCheck';
import { WizardFrame, workerFor } from './_components/Wizard';
import { loadOnboarding, supabaseConfigured } from './data';
import { completionLetterDoc, requirementRows, shareCodeDoc, wizardFacts } from './state';
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

  const lock = appLock(profile);
  const terminal =
    lock === 'quiz_failed' ||
    lock === 'rejected' ||
    lock === 'hold' ||
    lock === 'leaver' ||
    lock === 'removed';
  const facts = wizardFacts(state);
  const phase = wizardPhase(facts);

  // Where the worker goes on is decided from the two reads above, so a
  // worker passing through (the usual visit: on to their step, or out to
  // the app) waits for nothing more (go-live audit M5). The lock comes
  // first, as before: a terminal lock is shown whatever the phase says.
  if (!terminal) {
    if (phase === 'complete' || phase === 'closed') redirect('/shifts');
    if (phase !== 'awaiting_interview' && phase !== 'awaiting_review') {
      redirect(`/onboarding/${currentStep(facts) ?? 1}`);
    }
  }

  // A screen is drawn: sign the header photo and, while the documents are
  // with the office, read the share-code check alongside it rather than
  // after it. Never for a locked worker, whose screen shows no documents.
  const shareDoc = !terminal && phase === 'awaiting_review' ? shareCodeDoc(state) : null;
  const [photoUrl, checks] = await Promise.all([
    signOwnPhoto(state.photoPath),
    shareDoc ? loadMyRtwChecks() : Promise.resolve<MyRtwChecks>({}),
  ]);
  const worker = workerFor(state.firstName, state.lastName, photoUrl);

  if (terminal) {
    return (
      <WizardFrame worker={worker} title="The Hospitality Company" center>
        <LockScreen
          lock={lock}
          leftAt={profile.leftAt}
          detail={
            // The wireframe's terminal screen: "Attempt 1 · 7 / 10" rows
            // between the contact line and Sign out (onboarding-2.html).
            lock === 'quiz_failed' && state.quiz.length > 0 ? (
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
                    <span className="sm muted">Attempt {a.attemptNo}</span>
                  </MobileRow>
                ))}
              </MobileList>
            ) : null
          }
        />
      </WizardFrame>
    );
  }

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
          completionLetter={completionLetterDoc(state)}
        />
      </WizardFrame>
    );
  }

  redirect(`/onboarding/${currentStep(facts) ?? 1}`);
}
