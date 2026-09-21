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
  children?: ReactNode;
}

export function Chip({
  tone = 'neutral',
  outline,
  onRemove,
  className,
  children,
  ...rest
}: ChipProps) {
  return (
    <span
      className={clsx('chip', tone !== 'neutral' && tone, outline && 'outline', className)}
      {...rest}
    >
      {children}
      {onRemove ? (
        <button type="button" className="x" aria-label="Remove" onClick={onRemove}>
          ×
        </button>
      ) : null}
    </span>
  );
}
