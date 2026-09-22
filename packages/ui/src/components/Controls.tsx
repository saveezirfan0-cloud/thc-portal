'use client';

import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  /**
   * The accessible name where there is no visible `label` — a switch in a
   * table column, whose heading names it once for sighted readers and not
   * at all for a screen reader.
   */
  'aria-label'?: string;
  /** Auto-Assign is the only purple control in the product (§3.4). */
  purple?: boolean;
  disabled?: boolean;
}

export function Switch({
  checked,
  onChange,
  label,
  purple,
  disabled,
  'aria-label': ariaLabel,
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx('switch', checked && 'on', purple && 'purple')}
    >
      <span className="track" />
      {label}
    </button>
  );
}

export interface CheckProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  error?: ReactNode;
  disabled?: boolean;
}

export function Checkbox({ checked, onChange, children, error, disabled }: CheckProps) {
  return (
    <label className="check">
      <input
        type="checkbox"
        className="hide"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={clsx('box', checked && 'on')} aria-hidden="true" />
      <span>
        {children}
        {error ? <span className="error">{error}</span> : null}
      </span>
    </label>
  );
}

export function Radio({ checked, onChange, children, disabled }: CheckProps) {
  return (
    <label className="check radio">
      <input
        type="radio"
        className="hide"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={clsx('box', checked && 'on')} aria-hidden="true" />
      <span>{children}</span>
    </label>
  );
}

export interface OptionRowProps {
  title: ReactNode;
  /** Plain-language explanation under the title. */
  description?: ReactNode;
  selected?: boolean;
  onSelect?: () => void;
}

/**
 * The selectable option row in the onboarding wizard (§10.3): marker, title,
 * explanation. The selected row takes an accent border and a faint accent fill.
 */
export function OptionRow({ title, description, selected, onSelect }: OptionRowProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={!!selected}
      onClick={onSelect}
      className={clsx('optrow', selected && 'sel')}
    >
      <span className={clsx('box', selected && 'on')} aria-hidden="true" />
      <span>
        <span className="t">{title}</span>
        {description ? <span className="d">{description}</span> : null}
      </span>
    </button>
  );
}
