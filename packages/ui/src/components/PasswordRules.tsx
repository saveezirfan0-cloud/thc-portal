import { clsx } from 'clsx';
import { PASSWORD_MIN_LENGTH, checkPassword } from '@thc/domain';
import type { ReactNode } from 'react';

export type PasswordRuleState = 'pending' | 'ok' | 'bad';

export interface PasswordRulesProps {
  /** What is in the new-password field now. */
  value: string;
  /**
   * What is in the confirmation field. Pass it (even as '') to add "Both
   * fields match"; leave it out for a form with a single password field.
   */
  confirm?: string;
  /**
   * The password field has been left at least once (blur), or the form was
   * submitted. Until then an unmet rule is neutral (○), not a failure — a
   * list of red crosses before anyone has typed reads as a telling-off.
   */
  touched?: boolean;
  /** The same for the confirmation field; drives "Both fields match". */
  confirmTouched?: boolean;
  /** For `aria-describedby` on the password field. */
  id?: string;
  className?: string;
}

const MARK: Record<PasswordRuleState, string> = { pending: '○', ok: '✓', bad: '✕' };
// Read after the rule's own text: "Contains a number, met".
const SPOKEN: Record<PasswordRuleState, string> = {
  pending: ', not met yet',
  ok: ', met',
  bad: ', not met',
};

function state(met: boolean, touched: boolean | undefined): PasswordRuleState {
  if (met) return 'ok';
  return touched ? 'bad' : 'pending';
}

/**
 * The live password checklist (wireframes/public/activate.html:15-18, the
 * compact `.rules`). It is help, not the gate: the rules are
 * `checkPassword()` from @thc/domain, the function every server action
 * runs, so a password ticked here is never refused there.
 *
 * Each rule is ○ before the field is used, ✓ in green once met, and ✕ in
 * coral only if it is still unmet after the field has been left. The marks
 * are decoration (aria-hidden); the state is spoken from visually hidden
 * text, so a screen reader hears "At least 10 characters, met".
 */
export function PasswordRules({
  value,
  confirm,
  touched,
  confirmTouched,
  id,
  className,
}: PasswordRulesProps) {
  const checks = checkPassword(value, confirm ?? '');
  const rules: { key: string; label: ReactNode; state: PasswordRuleState }[] = [
    {
      key: 'long',
      label: `At least ${PASSWORD_MIN_LENGTH} characters`,
      state: state(checks.long, touched),
    },
    { key: 'number', label: 'Contains a number', state: state(checks.hasNumber, touched) },
  ];
  if (confirm !== undefined) {
    rules.push({
      key: 'match',
      label: 'Both fields match',
      state: state(checks.matches, confirmTouched),
    });
  }

  return (
    <ul className={clsx('rules', className)} id={id} aria-label="Password rules">
      {rules.map((rule) => (
        <li key={rule.key} className={rule.state === 'pending' ? undefined : rule.state}>
          <span className="mark" aria-hidden="true">
            {MARK[rule.state]}
          </span>
          <span>
            {rule.label}
            <span className="state">{SPOKEN[rule.state]}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
