'use client';

import { clsx } from 'clsx';
import type { KeyboardEvent } from 'react';

export interface SegOption<T extends string> {
  value: T;
  label: string;
  /** Count badge; `alert` paints it coral. */
  count?: number;
  alert?: boolean;
}

export interface SegToggleProps<T extends string> {
  options: SegOption<T>[];
  value: T;
  onChange: (value: T) => void;
  small?: boolean;
  /** Full-width track, as used in the Staff App header. */
  block?: boolean;
  'aria-label'?: string;
}

export function SegToggle<T extends string>({
  options,
  value,
  onChange,
  small,
  block,
  ...rest
}: SegToggleProps<T>) {
  return (
    <div className={clsx('seg', small && 'sm', block && 'block')} role="group" {...rest}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          className={clsx(option.value === value && 'on')}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count !== undefined ? (
            <span className={clsx('n', option.alert && 'alert')}>{option.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/**
 * A WAI-ARIA tab list with a roving tab index: the selected tab is the one
 * Tab stop, and the arrow keys (Home / End too) move between tabs and open
 * the one they land on (automatic activation — every panel here is already
 * loaded). Seven tabs used to be seven Tab stops before the panel (release
 * audit 14.10.2026, the staff profile).
 */
export function Tabs<T extends string>({
  options,
  value,
  onChange,
  small: _small,
  block: _block,
  ...rest
}: SegToggleProps<T>) {
  // A value no option carries (a stale address) still leaves one Tab stop.
  const selected = options.some((option) => option.value === value) ? value : options[0]?.value;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = options.findIndex((option) => option.value === selected);
    if (index < 0 || options.length === 0) return;
    const last = options.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    const target = options[next]!;
    onChange(target.value);
    const tabs = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs[next]?.focus();
  };

  return (
    <div className="tabs" role="tablist" onKeyDown={onKeyDown} {...rest}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          tabIndex={option.value === selected ? 0 : -1}
          className={clsx(option.value === value && 'active')}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count !== undefined ? (
            <span className={clsx('n', option.alert && 'alert')}>{option.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
