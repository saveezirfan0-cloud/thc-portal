import { clsx } from 'clsx';

export interface Step {
  label: string;
}

export interface StepperProps {
  steps: Step[];
  /** Zero-based index of the step in progress. */
  current: number;
}

export function Stepper({ steps, current }: StepperProps) {
  return (
    <ol className="stepper">
      {steps.map((step, index) => (
        <li
          key={step.label}
          className={clsx('st', index < current && 'done', index === current && 'on')}
          aria-current={index === current ? 'step' : undefined}
        >
          {step.label}
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
