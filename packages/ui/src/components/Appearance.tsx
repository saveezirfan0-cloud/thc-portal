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

/**
 * Inline script for the document head. It runs before first paint so the
 * chosen mode never flashes the wrong palette.
 */
export const appearanceScript = `(function(){try{var r=document.documentElement;
var s=localStorage.getItem('${MODE_STORAGE_KEY}');
var m=s||(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
r.setAttribute('data-theme',m);r.setAttribute('data-style','warm');}catch(e){}})();`;

export function AppearanceScript() {
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
    const current = document.documentElement.getAttribute('data-theme');
    if (current === 'dark' || current === 'light') setModeState(current);
  }, []);

  const setMode = useCallback((next: Mode) => {
    applyMode(next);
    setModeState(next);
  }, []);

  return { mode, setMode };
}
