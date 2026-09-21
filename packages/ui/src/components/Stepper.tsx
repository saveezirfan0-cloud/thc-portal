import { clsx } from 'clsx';

export interface Step {
  /** Short label above the title, e.g. "Step 3" or "3/11". */
  key?: string;
  label: string;
}

export interface StepperProps {
  steps: Step[];
  /** Zero-based index of the step in progress. */
  current: number;
}

/**
 * Wizard progress (§10.3). Matches `.stepper` in the design system: each step
 * is a `.st` carrying a `.k` key line and a `.t` title, with `.done` behind and
 * `.now` for the step in progress.
 */
export function Stepper({ steps, current }: StepperProps) {
  return (
    <ol className="stepper">
      {steps.map((step, index) => (
        <li
          key={step.label}
          className={clsx('st', index < current && 'done', index === current && 'now')}
          aria-current={index === current ? 'step' : undefined}
        >
          <span className="k">{step.key ?? `Step ${index + 1}`}</span>
          <span className="t">{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

export function Progress({
  value,
  max = 100,
  tone,
}: {
  value: number;
  max?: number;
  tone?: string;
}) {
  const pct = max === 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div className={clsx('fill', tone)} style={{ width: `${pct}%` }} />
    </div>
  );
}
