'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * ADR-0003: one user-facing switch. Light mode renders the Warm look,
 * dark mode renders the Scope §1.6 look. The two token axes stay separate
 * underneath (`data-style`, `data-theme`) so the pairing can change without
 * touching a single screen.
 */
export type Mode = 'light' | 'dark';

export const MODE_STORAGE_KEY = 'thc-mode';

export function styleForMode(mode: Mode): 'warm' | 'scope' {
  return mode === 'dark' ? 'scope' : 'warm';
}

/**
 * Inline script for the document head. It runs before first paint so the
 * chosen mode never flashes the wrong palette.
 */
export const appearanceScript = `(function(){try{var r=document.documentElement;
var s=localStorage.getItem('${MODE_STORAGE_KEY}');
var m=s||(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
r.setAttribute('data-theme',m);r.setAttribute('data-style',m==='dark'?'scope':'warm');}catch(e){}})();`;

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
