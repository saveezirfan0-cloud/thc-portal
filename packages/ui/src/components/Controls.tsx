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

/**
 * A real `<input type="checkbox">` under the drawn box (§1.2). It used to be
 * `display: none`, which took it out of the tab order and out of the
 * accessibility tree; `.check-input` hides it visually only, so Tab reaches
 * it, Space toggles it, a screen reader announces its state, and the drawn
 * box next to it takes the focus ring (components.css).
 */
export function Checkbox({ checked, onChange, children, error, disabled }: CheckProps) {
  return (
    <label className="check">
      <input
        type="checkbox"
        className="check-input"
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

const PREV_KEYS = new Set(['ArrowUp', 'ArrowLeft']);
const NEXT_KEYS = new Set(['ArrowDown', 'ArrowRight']);

/**
 * The radios that belong with this one: those inside the same enclosing
 * `role="radiogroup"` (every caller wraps its set in one), else those among
 * the label's siblings. Disabled ones are skipped, as a native group does.
 */
function groupOf(input: HTMLInputElement): HTMLInputElement[] {
  const group = input.closest('[role="radiogroup"]');
  const scope = group ?? input.closest('label')?.parentElement;
  if (!scope) return [input];
  return Array.from(
    scope.querySelectorAll<HTMLInputElement>('input.check-input[type="radio"]'),
  ).filter((el) => !el.disabled && el.closest('[role="radiogroup"]') === group);
}

/**
 * A real `<input type="radio">` under the drawn marker (§1.2): Tab reaches
 * it and Space selects it natively. The props carry no `name`, so the
 * browser does not know which radios form a set; the arrow keys are handled
 * here instead, over the enclosing `role="radiogroup"`: Up/Left and
 * Down/Right move to the previous/next radio (wrapping) and select it, as a
 * native group does.
 */
export function Radio({ checked, onChange, children, disabled }: CheckProps) {
  return (
    <label className="check radio">
      <input
        type="radio"
        className="check-input"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        onKeyDown={(event) => {
          const back = PREV_KEYS.has(event.key);
          if (!back && !NEXT_KEYS.has(event.key)) return;
          event.preventDefault();
          const group = groupOf(event.currentTarget);
          const at = group.indexOf(event.currentTarget);
          if (group.length < 2 || at < 0) return;
          const next = group[(at + (back ? -1 : 1) + group.length) % group.length]!;
          next.focus();
          if (!next.checked) next.click();
        }}
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
