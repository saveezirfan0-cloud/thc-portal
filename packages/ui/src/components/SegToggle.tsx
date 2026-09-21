'use client';

import { clsx } from 'clsx';

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

export function Tabs<T extends string>({
  options,
  value,
  onChange,
  small: _small,
  block: _block,
  ...rest
}: SegToggleProps<T>) {
  return (
    <div className="tabs" role="tablist" {...rest}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
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
