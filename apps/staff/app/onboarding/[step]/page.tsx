import { notFound, redirect } from 'next/navigation';
import { Alert } from '@thc/ui';
import { BRANCH_HEADING, TOTAL_STEPS, canEditStep, stepAccess, ukToday } from '@thc/domain';
import { signOwnPhoto } from '../../profile/photos';
import { AddressStep } from '../_components/AddressStep';
import { BankStep } from '../_components/BankStep';
import { ContractStep } from '../_components/ContractStep';
import { DocumentsStep } from '../_components/DocumentsStep';
import { HmrcStep } from '../_components/HmrcStep';
import { InductionStep } from '../_components/InductionStep';
import { QuizStep } from '../_components/QuizStep';
import { ReferencesStep } from '../_components/ReferencesStep';
import { RtwStep } from '../_components/RtwStep';
import { SelfieStep } from '../_components/SelfieStep';
import { TutorialStep } from '../_components/TutorialStep';
import { WizardFrame, WizardTop, workerFor } from '../_components/Wizard';
import { loadHmrcGender, loadOnboarding, loadQuizQuestions, supabaseConfigured } from '../data';
import { requirementRows, wizardFacts } from '../state';
import type { OnboardingState } from '../state';
import '../onboarding.css';

export const dynamic = 'force-dynamic';

// The upload's document read runs in after() (ADR-0033) and counts against
// the function's duration: 45 s per model call plus one retry and the download.
export const maxDuration = 120;
export const metadata = { title: 'Onboarding · THC Staff' };

/**
 * /onboarding/1 … /onboarding/11 — §10.3, one route per step.
 *
 * A step opens only when `stepAccess` (packages/domain) says it is the
 * current one, or a finished one the worker may still change
 * (`canEditStep`: 1–4 until the documents are submitted, 7–10 until the
 * contract is signed). Anything else goes back to /onboarding, which knows
 * where they should be. The database refuses the same things on write;
 * this only keeps the screens from offering them.
 */
export default async function Page({ params }: { params: Promise<{ step: string }> }) {
  const { step: raw } = await params;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > TOTAL_STEPS) notFound();
  if (!supabaseConfigured()) redirect('/onboarding');

  const state = await loadOnboarding();
  if (!state) redirect('/onboarding');

  const facts = wizardFacts(state);
  const access = stepAccess(n, facts);
  // The induction stays open to re-read from a failed quiz result.
  const reread = n === 5 && facts.status === 'quiz' && facts.inductionDone;
  if (access !== 'current' && !(access === 'done' && (canEditStep(n, facts) || reread))) {
    redirect('/onboarding');
  }

  // Signed once: the header's avatar (§10.1, the selfie "across the whole
  // system") and step 3's preview read the same URL.
  const photoUrl = await signOwnPhoto(state.photoPath);
  const worker = workerFor(state.firstName, state.lastName, photoUrl);
  return <WizardFrame worker={worker}>{await render(n, state, photoUrl)}</WizardFrame>;
}

async function render(n: number, s: OnboardingState, photoUrl: string | null) {
  const today = ukToday();
  switch (n) {
    case 1:
      return (
        <RtwStep
          today={today}
          initial={{
            branch: s.rtwBranch,
            dob: s.dob ?? '',
            shareCode: s.shareCode ?? '',
            visaType: s.progress.visaType ?? '',
            visaExpiry: s.progress.visaExpiry ?? '',
            ukChoice: s.progress.ukDocChoice ?? (s.rtwBranch === 'uk_irish' ? 'passport' : null),
            wtrOptOut: s.wtrOptOut,
          }}
        />
      );
    case 2:
      return <AddressStep initial={splitAddress(s)} />;
    case 3:
      return (
        <SelfieStep
          name={`${s.firstName} ${s.lastName}`.trim()}
          locked={Boolean(s.photoPath)}
          existingUrl={photoUrl}
        />
      );
    case 4:
      return (
        <DocumentsStep
          branchTitle={s.rtwBranch ? BRANCH_HEADING[s.rtwBranch] : ''}
          rows={requirementRows(s)}
          shareCode={s.rtwBranch && s.rtwBranch !== 'uk_irish' ? s.shareCode : null}
          today={today}
        />
      );
    case 5:
      return <InductionStep alreadyDone={Boolean(s.progress.inductionAt)} />;
    case 6: {
      const questions = await loadQuizQuestions();
      if (!questions) {
        return (
          <>
            <WizardTop step={6} heading="Safety quiz" />
            <Alert tone="coral">The quiz isn’t open for you right now.</Alert>
          </>
        );
      }
      return <QuizStep firstName={s.firstName} questions={questions} previous={s.quiz} />;
    }
    case 7:
      return (
        <HmrcStep
          niMasked={s.niMasked}
          initial={{
            q1OtherJob: s.hmrc?.q1OtherJob ?? null,
            q2Pension: s.hmrc?.q2Pension ?? null,
            q3Since6April: s.hmrc?.q3Since6April ?? null,
            // The wireframe opens with "No" selected — an explicit answer the
            // worker can change, not a question left unanswered.
            studentLoan: s.hmrc?.studentLoan ?? 'none',
            postgraduateLoan: s.hmrc?.postgraduateLoan ?? false,
            niNumber: '',
            declared: false,
            gender: await loadHmrcGender(s.staffId),
          }}
        />
      );
    case 8:
      return <ReferencesStep initial={s.references} />;
    case 9:
      return (
        <BankStep
          initial={
            s.bank ?? {
              accountHolder: `${s.firstName} ${s.lastName}`.trim(),
              sortCode: '',
              accountNumber: '',
            }
          }
        />
      );
    case 10:
      if (!s.contract) {
        return (
          <>
            <WizardTop step={10} heading="Zero-hours agreement" />
            <Alert tone="coral">
              The agreement isn’t available yet. Please contact the office.
            </Alert>
          </>
        );
      }
      return (
        <ContractStep
          version={s.contract.version}
          title={s.contract.title}
          body={s.contract.body}
          isPlaceholder={s.contract.isPlaceholder}
          signedStamp={s.contractStamp}
        />
      );
    default:
      return <TutorialStep firstName={s.firstName} />;
  }
}

/**
 * The saved address is one line — "Flat 4, 22 Roman Road, London E2 0RY"
 * (onboarding_save_address). Splitting it back is best effort, for a
 * worker editing before they submit.
 */
function splitAddress(s: OnboardingState) {
  const base = { line: '', town: '', postcode: '', lat: s.homeLat, lng: s.homeLng };
  if (!s.homeAddress) return base;
  const m = /^(.*),\s*([^,]+?)\s+([A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})$/i.exec(s.homeAddress);
  if (!m) return { ...base, line: s.homeAddress };
  return { ...base, line: m[1]!, town: m[2]!, postcode: m[3]!.toUpperCase() };
}
