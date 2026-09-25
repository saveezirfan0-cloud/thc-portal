import { clsx } from 'clsx';
import type { ButtonHTMLAttributes } from 'react';

export interface MenuButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'type'
> {
  /** Whether the menu it controls is showing; drives the glyph and `aria-expanded`. */
  open: boolean;
  /** The id of the menu it opens. */
  controls: string;
  label?: string;
}

/**
 * The phone menu button: three bars closed, a cross open.
 *
 * Only the phone draws it (`.menu-btn` is `display: none` above 760px); the
 * desktop layouts keep their sidebar and top bar in view. A real button
 * with `aria-expanded` and `aria-controls`, so a screen reader hears
 * "Menu, collapsed" rather than an unlabelled icon. Glyphs are
 * `currentColor` strokes, so no colour is decided here.
 */
export function MenuButton({
  open,
  controls,
  label = 'Menu',
  className,
  ...rest
}: MenuButtonProps) {
  return (
    <button
      type="button"
      className={clsx('menu-btn', className)}
      aria-expanded={open}
      aria-controls={controls}
      aria-label={label}
      {...rest}
    >
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        aria-hidden="true"
        focusable="false"
      >
        {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
      </svg>
    </button>
  );
}
