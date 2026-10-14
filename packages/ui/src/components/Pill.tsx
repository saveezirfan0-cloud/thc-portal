import { clsx } from 'clsx';
import type { HTMLAttributes, ReactNode } from 'react';

export type Tone = 'neutral' | 'cyan' | 'green' | 'amber' | 'coral' | 'purple';

export interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  /** Filled rather than tinted. */
  solid?: boolean;
  large?: boolean;
  /** Leading status dot. */
  dot?: boolean;
  children?: ReactNode;
}

export function Pill({
  tone = 'neutral',
  solid,
  large,
  dot,
  className,
  children,
  ...rest
}: PillProps) {
  return (
    <span
      className={clsx(
        'pill',
        tone !== 'neutral' && tone,
        solid && 'solid',
        large && 'lg',
        className,
      )}
      {...rest}
    >
      {dot ? <i className="dot" /> : null}
      {children}
    </span>
  );
}

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Extract<Tone, 'neutral' | 'cyan' | 'purple'>;
  /** Hairline chip on the page ground, e.g. "Wave 2 — not qualified here". */
  outline?: boolean;
  onRemove?: () => void;
  /**
   * The × button's accessible name. Defaults to "Remove <the chip's text>"
   * when the chip is plain text — a row of chips that were all "Remove"
   * told a screen reader nothing about which one it was on.
   */
  removeLabel?: string;
  children?: ReactNode;
}

export function Chip({
  tone = 'neutral',
  outline,
  onRemove,
  removeLabel,
  className,
  children,
  ...rest
}: ChipProps) {
  const name =
    removeLabel ??
    (typeof children === 'string' || typeof children === 'number'
      ? `Remove ${children}`
      : 'Remove');
  return (
    <span
      className={clsx('chip', tone !== 'neutral' && tone, outline && 'outline', className)}
      {...rest}
    >
      {children}
      {onRemove ? (
        <button type="button" className="x" aria-label={name} onClick={onRemove}>
          ×
        </button>
      ) : null}
    </span>
  );
}
