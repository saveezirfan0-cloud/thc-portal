'use client';

import { clsx } from 'clsx';
import { SegToggle } from './SegToggle';
import { useAppearance } from './Appearance';
import type { Mode } from './Appearance';

/**
 * ADR-0007: one user-facing switch, and it changes the ground only — both
 * grounds render the same rounded look.
 *
 * It lived on `/design-system` alone until now, which made ADR-0007's "the
 * appearance control is just Light / Dark" true of the reference sheet and
 * of nothing a customer ever opens. It belongs in the chrome of all three
 * apps and on the sign-in cards, because a viewer whose device prefers dark
 * otherwise gets a light login followed by a dark app.
 *
 * Two forms, same control:
 *   - the labelled pair (`.seg`), for the Back Office and Client Portal top
 *     bars, where there is room for two words;
 *   - `compact`, a single icon toggle, for the Staff App header. At 390px
 *     the title has to keep its line, and §10.1 fixes what the header may
 *     spend width on: logo left, profile right.
 *
 * Both are real buttons, so both are in the tab order and both take the
 * cyan focus ring from base.css. The compact form is a toggle button: its
 * name is the thing it controls and `aria-pressed` carries the state, which
 * is what a screen reader announces rather than a bare icon.
 */
const OPTIONS = [
  { value: 'light' as const, label: 'Light' },
  { value: 'dark' as const, label: 'Dark' },
];

export interface ModeSwitchProps {
  /** Icon-only single toggle, for narrow chrome like the Staff App header. */
  compact?: boolean;
  /** Shorter track (`.seg.sm`). Used in both web top bars. */
  small?: boolean;
  /** Accessible name for the labelled pair. */
  'aria-label'?: string;
  className?: string;
}

export function ModeSwitch({
  compact,
  small,
  'aria-label': ariaLabel = 'Appearance',
  className,
}: ModeSwitchProps) {
  const { mode, setMode } = useAppearance();

  if (compact) {
    const dark = mode === 'dark';
    return (
      <button
        type="button"
        className={clsx('btn', 'ghost', 'sm', 'icon', 'mode-switch', className)}
        aria-pressed={dark}
        aria-label="Dark appearance"
        title="Dark appearance"
        onClick={() => setMode(dark ? 'light' : 'dark')}
      >
        <ModeIcon dark={dark} />
      </button>
    );
  }

  return (
    <SegToggle<Mode>
      options={OPTIONS}
      value={mode}
      onChange={setMode}
      small={small}
      aria-label={ariaLabel}
    />
  );
}

/** Moon when dark is on, sun when it is off. `currentColor` only — no token
 *  is hard-coded here and the glyph inherits whatever the chrome is using. */
function ModeIcon({ dark }: { dark: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {dark ? (
        <path d="M20 14.5A8.2 8.2 0 0 1 9.5 4 8.2 8.2 0 1 0 20 14.5Z" />
      ) : (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" />
        </>
      )}
    </svg>
  );
}
