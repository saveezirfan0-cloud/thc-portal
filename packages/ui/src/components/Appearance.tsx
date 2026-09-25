'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * ADR-0007: one user-facing switch, and it is a *theme* switch only. Every
 * board the product owner supplied — the warm light set and the dark set —
 * is the same rounded, gradient-accented language; only the ground changes.
 * So the style axis stays on `warm` in both, and light/dark picks the
 * palette: cream with soft card shadows, or navy with an accent glow.
 *
 * `scope` is still reachable by setting data-style by hand. It is the §1.6
 * literal rendering, kept because the Scope of Work marks §1.6 STRICT and
 * the approved design pack has to stay reproducible.
 *
 * ADR-0003 promised the pairing could change "without touching a single
 * screen". This function is the whole of that change, twice over now.
 */
export type Mode = 'light' | 'dark';

export const MODE_STORAGE_KEY = 'thc-mode';

export function styleForMode(_mode: Mode): 'warm' | 'scope' {
  return 'warm';
}

/** The stored choice, else the device's preference, else light. */
export function resolveMode(): Mode {
  try {
    const stored = localStorage.getItem(MODE_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* storage blocked (Safari with cookies off) — fall through to the device */
  }
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

/**
 * Inline script for the document head. It runs before first paint so the
 * chosen mode never flashes the wrong palette.
 *
 * The storage read has its own try: Safari throws on `localStorage` when
 * site data is blocked, and when the read and the two setAttribute calls
 * shared one try that throw left `<html>` with neither attribute — the
 * square §1.6 "scope" dark ground, which is what a phone then showed.
 */
export const appearanceScript = `(function(){var r=document.documentElement,m=null;
try{m=localStorage.getItem('${MODE_STORAGE_KEY}');}catch(e){}
if(m!=='light'&&m!=='dark'){m=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}
r.setAttribute('data-theme',m);r.setAttribute('data-style','warm');})();`;

/**
 * The head script, plus a repair after mount.
 *
 * React 19 strips every attribute from `<html>` when it has to client-render
 * the root — any hydration mismatch below it, or a browser extension editing
 * the DOM, is enough. The attributes the head script set are then gone and
 * the page falls back to the base tokens: square corners, mono UPPERCASE
 * labels, a dark ground, and a switch reading "Light". This effect runs after
 * that render and puts them back. It never writes storage: the viewer has
 * not chosen anything.
 */
export function AppearanceScript() {
  useEffect(() => {
    const root = document.documentElement;
    const theme = root.getAttribute('data-theme');
    if (theme !== 'light' && theme !== 'dark') root.setAttribute('data-theme', resolveMode());
    if (!root.getAttribute('data-style')) root.setAttribute('data-style', 'warm');
  }, []);
  return <script dangerouslySetInnerHTML={{ __html: appearanceScript }} />;
}

export function applyMode(mode: Mode): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', mode);
  root.setAttribute('data-style', styleForMode(mode));
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    /* private mode — the choice simply does not persist */
  }
}

export function useAppearance(): { mode: Mode; setMode: (mode: Mode) => void } {
  const [mode, setModeState] = useState<Mode>('light');

  useEffect(() => {
    const root = document.documentElement;
    const read = () => {
      const current = root.getAttribute('data-theme');
      setModeState(current === 'dark' || current === 'light' ? current : resolveMode());
    };
    read();
    // Every switch on the page follows <html>, not its own copy: the Back
    // Office draws a labelled pair on a desktop and an icon on a phone, and
    // flipping one has to flip the other.
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  const setMode = useCallback((next: Mode) => {
    applyMode(next);
    setModeState(next);
  }, []);

  return { mode, setMode };
}
