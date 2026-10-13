/**
 * The browser chrome colour (`<meta name="theme-color">`) for each mode: the
 * warm grounds' `--bg` in tokens.css, light cream and dark navy. A meta tag
 * or a web app manifest cannot read a CSS variable, so these two strings
 * mirror the tokens, and appearance.test.ts fails if either drifts.
 *
 * Kept out of Appearance.tsx on purpose: that module is 'use client', and a
 * server file (an app's root layout `viewport`, its `manifest.ts`) that
 * imported a constant from it would get a client reference, not the string.
 */
export const THEME_COLOR = { light: '#FAF7F4', dark: '#0A0E18' } as const satisfies Record<
  'light' | 'dark',
  string
>;
