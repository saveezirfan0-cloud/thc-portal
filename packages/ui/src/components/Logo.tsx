import { clsx } from 'clsx';

/* The mark is `brand/thc-mark.svg` inlined: two paths, the glasses and the
   cork, on the tight viewBox `brand/README.md` records. It is inlined rather
   than loaded as a file so it needs no SVG loader, works in a server
   component, and — because neither path names a colour — takes `currentColor`
   from whatever it sits in. Regenerate from `brand/thc-mark.svg` if THC ever
   supply a new logo; do not hand-edit the path data. */
const VIEW_BOX = '273.6 26.4 326.7 522.0';
const GLASSES =
  'M514.7,544.2h-225.9c-2.8,0-5.5-.6-8.2-1.3-1.5-.3-3.3-1.3-2.9-3.1.3-1.2,1.7-2.7,2.9-3.1,2.9-.9,6-1.5,9.1-1.6,16.3-.4,32.6-1.5,48.7-4.3,3-.5,6-1.5,9-2.1,4.9-1,7.3-4.1,7.3-9,.2-11.4.5-22.7.5-34.1s-.3-17.1-.5-25.7c-.5-16.7-1.1-33.4-1.6-50-.1-4.6-.3-9.2,0-13.7.6-15.7-2.8-30.7-8.3-45.2-6.6-17.6-13.8-35.1-20.7-52.6-7.3-18.5-13.6-37.2-17.4-56.7-2.1-11-3.4-22-3.5-33.2-.1-14.6-.2-29.3-.3-43.9,0-7.8-.3-15.7-.3-23.5s.4-6.2.9-9.2c.2-.9,1.4-2,2.3-2.2,4.8-.9,9.7-1.8,14.6-2.3,19.5-2.1,39.1-1.7,58.7-1.2,10.7.3,21.5,1.8,32.2,3,4.2.5,4.4.8,4.8,4.9.6,6.8,1.2,13.5,1.3,20.3.2,18.3.3,36.5,0,54.8-.3,19.5-4.2,38.5-9.9,57.1-6.1,19.9-14.3,39-22.3,58.1-6.3,15-12.6,30-16.3,45.9-1.6,6.9-2.4,13.9-2.6,21-.4,21.3-1.2,42.7-1.6,64-.4,18.1-.7,36.2-.8,54.3,0,4.3.8,8.7,1.1,13,.2,2.8,1.8,4.6,4.3,5.2,5.6,1.4,11.2,3,17,4,15.3,2.5,30.7,3.1,46.1,3.6,11.1.4,22.1-.4,33-1.2,9.3-.7,18.6-2,27.9-3.3,4-.6,7.8-1.9,11.7-3.1,2.5-.7,4-2.4,4.2-5.1.4-5.3,1.3-10.6,1.2-15.9-.2-19.1-.6-38.3-1.1-57.4-.3-13.8-.8-27.6-1.1-41.4-.2-8.3-.2-16.7-.8-25-.8-11-3.9-21.6-7.8-31.9-6.7-17.3-13.9-34.4-20.8-51.6-6.8-16.7-12.8-33.7-16.9-51.4-3.2-13.9-5.1-27.9-5.1-42.1v-56.3c0-5.6.8-11.2,1.2-16.8.2-2.1,1.1-3.4,3.3-3.6,6.4-.8,12.7-1.9,19.1-2.5,17.8-1.6,35.6-1.3,53.4-.8,10.8.3,21.6,1.8,32.4,3,3.9.4,4.2.7,4.6,4.6.6,5,1.1,10,1.1,15,.2,19.3.3,38.6.2,57.9,0,25-5.6,49-14.2,72.3-6.9,18.6-14.7,36.9-22.1,55.4-5.1,12.7-10,25.5-12.8,39-1.8,8.3-1.8,16.7-2,25.1-.5,21-1.2,41.9-1.7,62.9-.3,13.1-.8,26.3-.8,39.4s.8,14.1,1.2,21.2c.2,3.4,2,5.6,5.2,6.3,6.4,1.5,12.9,3.1,19.4,4.1,14.2,2.2,28.6,2.7,43,3.2,2.3,0,4.6.8,6.8,1.7,1,.4,2.2,1.9,2.2,2.9s-1.3,2.4-2.3,2.8c-2.6.8-5.4,1.4-8.2,1.5-11.1.2-22.2,0-33.3,0h-37.9,0Z';
const CORK =
  'M451.3,30.4c9.8.2,17.2,3.7,23.6,9.4.4.3.8.8.8,1.3-.2,3.8-.2,7.6-.7,11.4-.3,1.8-1.4,3.5-2.2,5.2-1,1.9-2.4,3.1-4.8,3.3-2.5,0-2.8.9-2.3,3.3,1.2,5,.2,10-.7,14.9-.5,2.8-1.1,5.6-1.6,8.5-.5,3.5-1.8,4.6-5.3,3.8-5.1-1.1-10.2-2.2-15.3-3.5-4.7-1.3-9.3-2.9-13.9-4.3-1.8-.6-2.3-1.6-1.6-3.3,2.6-6.3,5.1-12.6,7.9-18.7.8-1.8,2.5-3.2,4-4.6,1.6-1.5,1.7-2.4,0-3.6-3.9-2.8-4.4-4.1-3.2-8.8.9-3.6,1.7-7.3,4.1-10.3,1.3-1.6,2.5-2.9,4.9-2.9s5-.6,6.4-.8v-.3Z';

export interface LogoMarkProps {
  className?: string;
  /**
   * Names the mark for a screen reader. Leave unset wherever the company
   * name is already written next to it, which is every place in the product
   * today — a second "The Hospitality Company" in the accessibility tree is
   * noise, not help.
   */
  label?: string;
}

/** The mark alone, no tile: inherits `color`, sizes to its box. */
export function LogoMark({ className, label }: LogoMarkProps) {
  return (
    <svg
      className={clsx('logo-mark', className)}
      viewBox={VIEW_BOX}
      fill="currentColor"
      focusable="false"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      <path d={GLASSES} />
      <path d={CORK} />
    </svg>
  );
}

export interface LogoProps extends LogoMarkProps {
  /** Tile size. `sm` for a collapsed header, `lg` for the sign-in card. */
  size?: 'sm' | 'md' | 'lg';
}

/**
 * The brand tile: the mark on the accent, in the one circle the design
 * system allows (§1.6 — the logo is the single exception to zero radius, and
 * it stays circular in the ADR-0007 rounded look too).
 */
export function Logo({ size = 'md', className, label }: LogoProps) {
  return (
    <span className={clsx('logo', size !== 'md' && size, className)}>
      <LogoMark label={label} />
    </span>
  );
}
