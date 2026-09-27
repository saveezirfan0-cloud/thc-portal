import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Alert } from '@thc/ui';
import { CompletionLetterForm } from '../../documents/_components/CompletionLetterForm';
import { signOwnPhoto } from '../../profile/photos';
import { WizardFrame, workerFor } from '../_components/Wizard';
import { loadOnboarding, supabaseConfigured } from '../data';
import { completionLetterDoc } from '../state';
import '../onboarding.css';
import '../../documents/documents.css';

export const dynamic = 'force-dynamic';

// The upload's document read runs in after() (ADR-0033) and counts against
// the function's duration: 45 s per model call plus one retry and the download.
export const maxDuration = 120;
export const metadata = { title: 'Completion letter · Onboarding · THC Staff' };

/** The candidate stages the wizard runs in; a working worker uses Documents. */
const IN_WIZARD = new Set(['documents', 'quiz', 'contract']);

/**
 * /onboarding/completion-letter — the Official University Completion Letter
 * (completion letter requirement §2.1) for a Student-visa CANDIDATE who has
 * already finished their course, so they need not wait until they are staff
 * to have the 48-hour limit considered.
 *
 * The same form and the same `submit_completion_letter()` as
 * /documents/completion-letter; only the frame (the wizard's) and where it
 * returns to differ. Optional: it sits outside the documents the office
 * must verify, so it never holds a step or the quiz gate up. A static
 * segment, so it wins over `[step]`.
 */
export default async function Page() {
  if (!supabaseConfigured()) redirect('/onboarding');
  const state = await loadOnboarding();
  if (!state) redirect('/onboarding');
  if (state.status === 'compliant' || state.status === 'blocked') {
    redirect('/documents/completion-letter');
  }
  if (!IN_WIZARD.has(state.status)) redirect('/onboarding');

  const worker = workerFor(state.firstName, state.lastName, await signOwnPhoto(state.photoPath));
  const doc = completionLetterDoc(state);

  const back = (
    <Link className="back-link" href="/onboarding">
      ‹ Back to onboarding
    </Link>
  );

  let body;
  if (doc === undefined) {
    body = <Alert tone="amber">The completion letter is only for workers on a Student visa.</Alert>;
  } else if (doc?.status === 'pending') {
    body = (
      <Alert tone="cyan">
        Your completion letter is already with the office for review. Your weekly limit stays where
        it is until they approve it.
      </Alert>
    );
  } else if (doc?.status === 'verified') {
    body = (
      <Alert tone="green">
        Your completion letter is approved. Your limit is 48 h/week from your course completion
        date.
      </Alert>
    );
  } else {
    body = (
      <>
        {doc?.status === 'rejected' ? (
          <Alert tone="coral">
            <b>The office couldn’t accept your last upload.</b>
            <br />
            <span className="xs">{doc.rejectionReason ?? 'Please contact the office.'}</span>
          </Alert>
        ) : null}
        <p className="sm muted">
          Already finished your course? Upload one of these as evidence. It’s optional and doesn’t
          hold up your onboarding. Once the office approves it, your weekly limit rises from the
          Student visa’s term-time limit to 48 hours.
        </p>
        <CompletionLetterForm currentLimit="your current limit" doneHref="/onboarding" />
      </>
    );
  }

  return (
    <WizardFrame worker={worker}>
      <div className="wizard-top">
        {back}
        <h2>University completion letter</h2>
      </div>
      {body}
    </WizardFrame>
  );
}
