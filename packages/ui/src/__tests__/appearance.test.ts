import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  appearanceScript,
  MODE_STORAGE_KEY,
  styleForMode,
  THEME_COLOR,
} from '../components/Appearance';

/**
 * ADR-0007 is one function and one line of inline script. There is nothing
 * else to change when the pairing changes, which is the property ADR-0003
 * set out to buy — so both are worth pinning.
 */
describe('the appearance pairing (ADR-0007)', () => {
  // Every supplied board, warm light and dark alike, is the same rounded
  // language. So the switch changes the ground and nothing else.
  it('renders the rounded look in light mode', () => {
    expect(styleForMode('light')).toBe('warm');
  });

  it('renders the rounded look in dark mode too', () => {
    expect(styleForMode('dark')).toBe('warm');
  });

  it('applies the same style before first paint', () => {
    // The inline script runs ahead of React, so a mismatch here shows up as
    // a flash of the wrong geometry rather than as a failing render.
    expect(appearanceScript).toContain("setAttribute('data-style','warm')");
    expect(appearanceScript).toContain(MODE_STORAGE_KEY);
  });

  it('sets both axes, never just one', () => {
    expect(appearanceScript).toContain("setAttribute('data-theme'");
    expect(appearanceScript).toContain("setAttribute('data-style'");
  });

  // Safari throws on localStorage when site data is blocked. The script used
  // to wrap the read and both setAttribute calls in one try, so that throw
  // left <html> bare and the phone rendered the square base tokens.
  it('still sets both axes when storage throws', () => {
    const attrs: Record<string, string> = {};
    const document = {
      documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) },
    };
    const window = { matchMedia: () => ({ matches: true }) };
    const localStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
    };
    new Function('document', 'window', 'localStorage', appearanceScript)(
      document,
      window,
      localStorage,
    );
    expect(attrs).toEqual({ 'data-theme': 'dark', 'data-style': 'warm' });
  });

  it('ignores a stored value that is not a mode', () => {
    const attrs: Record<string, string> = {};
    const document = {
      documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) },
    };
    const window = { matchMedia: () => ({ matches: false }) };
    const localStorage = { getItem: () => 'scope' };
    new Function('document', 'window', 'localStorage', appearanceScript)(
      document,
      window,
      localStorage,
    );
    expect(attrs).toEqual({ 'data-theme': 'light', 'data-style': 'warm' });
  });
});

describe('the browser chrome follows the in-app switch, not the phone (ADR-0052 §3)', () => {
  const tokens = readFileSync(
    fileURLToPath(new URL('../styles/tokens.css', import.meta.url)),
    'utf8',
  );
  const bgOf = (selector: string) => {
    const block = tokens.slice(tokens.indexOf(selector));
    return /--bg:\s*(#[0-9a-f]{6})/i.exec(block.slice(0, block.indexOf('}')))?.[1]?.toUpperCase();
  };

  it('uses the grounds the page is painted in', () => {
    expect(THEME_COLOR.dark).toBe(bgOf(":root[data-style='warm'][data-theme='dark'] {"));
    expect(THEME_COLOR.light).toBe(bgOf(":root[data-theme='light'] {"));
  });

  function run(stored: string | null, osDark: boolean) {
    const head: { id: string; name: string; content: string }[] = [];
    const document = {
      documentElement: { setAttribute: () => undefined },
      getElementById: (id: string) => head.find((m) => m.id === id) ?? null,
      createElement: () => ({ id: '', name: '', content: '' }),
      head: { prepend: (m: (typeof head)[number]) => head.unshift(m) },
    };
    const window = { matchMedia: () => ({ matches: osDark }) };
    const localStorage = { getItem: () => stored };
    new Function('document', 'window', 'localStorage', appearanceScript)(
      document,
      window,
      localStorage,
    );
    return head;
  }

  it('writes one theme-color, first in <head>, for the chosen mode', () => {
    // A light phone, dark chosen in the app: the chrome goes navy.
    expect(run('dark', false)).toEqual([
      { id: 'thc-theme-color', name: 'theme-color', content: THEME_COLOR.dark },
    ]);
    expect(run('light', true)[0]?.content).toBe(THEME_COLOR.light);
    // Nothing chosen: the phone decides, as before.
    expect(run(null, true)[0]?.content).toBe(THEME_COLOR.dark);
  });
});
