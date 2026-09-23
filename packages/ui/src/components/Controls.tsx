'use client';

import { clsx } from 'clsx';
import { createContext, useContext, useId, type ReactNode } from 'react';

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
  /** Submitted name, when the control lives in an uncontrolled `<form>`. */
  name?: string;
  value?: string;
}

/**
 * Checkbox and radio are a native input with the design system's square drawn
 * beside it. The input is *visually* hidden (`.check-input`: transparent and
 * out of flow, laid over the square) and never `display: none` — D1/§1.2. A
 * `display: none` input is not focusable, not in the tab order and not in the
 * accessibility tree, which is how these controls ended up mouse-only. Keeping
 * the real input means Tab, Space, the arrow keys inside a radio group, the
 * checked state and the accessible name are all the browser's, not ours.
 */
export function Checkbox({
  checked,
  onChange,
  children,
  error,
  disabled,
  name,
  value,
}: CheckProps) {
  return (
    <label className="check">
      <input
        type="checkbox"
        className="check-input"
        name={name}
        value={value}
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

/**
 * The shared `name` for the radios inside one `RadioGroup`. Radios that do not
 * share a name are not a group to the browser: each is its own tab stop and
 * the arrow keys do nothing.
 */
const RadioGroupContext = createContext<string | null>(null);

export interface RadioGroupProps {
  children: ReactNode;
  /** Shared `name` for the radios. Generated when omitted. */
  name?: string;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}

/**
 * A group of `Radio`s: the `radiogroup` role plus the one `name` that makes
 * the arrow keys walk the options and gives the group a single tab stop.
 */
export function RadioGroup({ children, name, className, ...aria }: RadioGroupProps) {
  const auto = useId();
  return (
    <RadioGroupContext.Provider value={name ?? auto}>
      <div className={className} role="radiogroup" {...aria}>
        {children}
      </div>
    </RadioGroupContext.Provider>
  );
}

export function Radio({ checked, onChange, children, disabled, name, value }: CheckProps) {
  const group = useContext(RadioGroupContext);
  return (
    <label className="check radio">
      <input
        type="radio"
        className="check-input"
        name={name ?? group ?? undefined}
        value={value}
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
