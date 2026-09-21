'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * ADR-0007 supersedes ADR-0003's pairing: one user-facing switch still, but
 * light mode now renders the Scope §1.6 geometry on the warm ground (zero
 * radius, Space Grotesk, IBM Plex Mono labels) and dark mode renders the
 * Fluid look (round, Plus Jakarta Sans, frosted glass, accent glow).
 *
 * ADR-0003 promised the pairing could change "without touching a single
 * screen". This function is the whole of that change.
 */
export type Mode = 'light' | 'dark';

export const MODE_STORAGE_KEY = 'thc-mode';

export function styleForMode(mode: Mode): 'warm' | 'scope' {
  return mode === 'dark' ? 'warm' : 'scope';
}

/**
 * Inline script for the document head. It runs before first paint so the
 * chosen mode never flashes the wrong palette.
 */
export const appearanceScript = `(function(){try{var r=document.documentElement;
var s=localStorage.getItem('${MODE_STORAGE_KEY}');
var m=s||(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
r.setAttribute('data-theme',m);r.setAttribute('data-style',m==='dark'?'warm':'scope');}catch(e){}})();`;

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
