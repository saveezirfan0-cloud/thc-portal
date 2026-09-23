import { notFound, redirect } from 'next/navigation';
import { BRANCH_HEADING, TOTAL_STEPS, canEditStep, stepAccess, ukToday } from '@thc/domain';
import { signOwnPhoto } from '../../profile/photos';
import { AddressStep } from '../_components/AddressStep';
import { DocumentsStep } from '../_components/DocumentsStep';
import { RtwStep } from '../_components/RtwStep';
import { SelfieStep } from '../_components/SelfieStep';
import { WizardFrame, workerFor } from '../_components/Wizard';
import { loadOnboarding, supabaseConfigured } from '../data';
import { requirementRows, wizardFacts } from '../state';
import type { OnboardingState } from '../state';
import '../onboarding.css';

export const dynamic = 'force-dynamic';
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

  const worker = workerFor(state.firstName, state.lastName);
  return <WizardFrame worker={worker}>{await render(n, state)}</WizardFrame>;
}

async function render(n: number, s: OnboardingState) {
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
          existingUrl={await signOwnPhoto(s.photoPath)}
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
    default:
      // Steps 5–11 arrive in the next commits of this branch.
      redirect('/onboarding');
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
