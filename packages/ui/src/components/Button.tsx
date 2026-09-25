import { clsx } from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonTone =
  | 'default'
  | 'primary'
  | 'purple'
  | 'green'
  | 'amber'
  | 'danger'
  | 'ghost'
  | 'outline'
  /**
   * Text, not a control: no border, no height, no padding, inherits its
   * size. For the places the wireframes write an anchor but the action
   * must be a button — the Back Office sidebar foot's sign-out is one, an
   * `ml-auto xs` link there and a form POST underneath (ADR-0012).
   *
   * Reach for it only when the wireframe draws a link. It is not a quieter
   * `ghost`: `ghost` is still a control and keeps a control's hit area.
   */
  | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone;
  size?: ButtonSize;
  /** Fills the container width (`.btn.block`). */
  block?: boolean;
  /** Square icon-only button (`.btn.icon`). */
  icon?: boolean;
  /** Filled variant of the danger tone (`.btn.danger.solid`). */
  solid?: boolean;
  children?: ReactNode;
}

export function Button({
  tone = 'default',
  size = 'md',
  block,
  icon,
  solid,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={clsx(
        'btn',
        tone !== 'default' && tone,
        solid && 'solid',
        size !== 'md' && size,
        block && 'block',
        icon && 'icon',
        className,
      )}
      {...rest}
    />
  );
}
