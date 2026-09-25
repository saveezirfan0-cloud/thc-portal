import type { ReactNode } from 'react';
import { AppBody, AppFrame, Progress } from '@thc/ui';
import { TOTAL_STEPS, stepByNumber, stepPercent } from '@thc/domain';
import { AppChrome } from '../../_components/AppChrome';
import type { ChromeWorker } from '../../_components/AppChrome';

/**
 * The wizard's chrome — §10.3, wireframes/staff/onboarding-1.html.
 *
 * The frosted header titled "Onboarding" with the avatar on the right, no
 * bottom navigation (nothing else is open to a candidate, §10.1 case 1),
 * then the step's own header: "N/11 · Step", the progress track, the
 * heading. The footer with Continue is the step's, because only the step
 * knows whether it is complete — "Continue is disabled until the step is
 * complete" (§10.3).
 */
export function WizardFrame({
  worker,
  title = 'Onboarding',
  center,
  children,
}: {
  worker: ChromeWorker | null;
  title?: string;
  center?: boolean;
  children: ReactNode;
}) {
  return (
    <AppFrame className="wizard">
      <AppChrome title={title} worker={worker} />
      <AppBody {...(center ? { className: 'center' } : {})}>{children}</AppBody>
    </AppFrame>
  );
}

export function WizardTop({
  step,
  heading,
  sub,
  aside,
}: {
  step: number;
  heading?: ReactNode;
  sub?: ReactNode;
  /** Right of the heading — "Change" on step 1, "Attempt 1 of 3" on the quiz. */
  aside?: ReactNode;
}) {
  const meta = stepByNumber(step);
  return (
    <div className="wizard-top">
      <div className="n">
        {step}/{TOTAL_STEPS} · {meta?.title}
      </div>
      <Progress value={stepPercent(step)} thin />
      {heading ? (
        aside ? (
          <div className="row">
            <h2>{heading}</h2>
            {aside}
          </div>
        ) : (
          <h2>{heading}</h2>
        )
      ) : null}
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

/** The frosted footer: the step's primary action and, when disabled, why. */
export function WizardFoot({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="wiz-foot">
      {children}
      {hint ? <div className="xs muted">{hint}</div> : null}
    </div>
  );
}

/**
 * The chrome's worker. §10.1: the selfie "becomes their photo across the
 * whole system (falling back to initials)" — so from step 4 on, the header
 * shows the photo that is on file, signed once by the page.
 */
export function workerFor(
  first: string,
  last: string,
  photoUrl: string | null = null,
): ChromeWorker {
  return { name: `${first} ${last}`.trim() || 'Your profile', photoUrl };
}
