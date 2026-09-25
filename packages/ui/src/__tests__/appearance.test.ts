import { describe, expect, it } from 'vitest';

import { appearanceScript, MODE_STORAGE_KEY, styleForMode } from '../components/Appearance';

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
