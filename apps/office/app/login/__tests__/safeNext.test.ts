import { describe, expect, it } from 'vitest';
import { safeNext } from '../safeNext';

/**
 * §1.4 sign-in lands on `next` only when it is a path on this origin. The
 * old guard was `startsWith('/')`, which `//evil.com` and `/\evil.com` both
 * pass — and both resolve to https://evil.com/ in every browser.
 */
const FALLBACK = '/dashboard';

describe('safeNext', () => {
  it('keeps a path on this origin, with its query and hash', () => {
    expect(safeNext('/reports', FALLBACK)).toBe('/reports');
    expect(safeNext('/events/42?tab=board#chef', FALLBACK)).toBe('/events/42?tab=board#chef');
    expect(safeNext('/staff', '/x')).toBe('/staff');
  });

  it('falls back when there is nothing to honour', () => {
    expect(safeNext('', FALLBACK)).toBe(FALLBACK);
    expect(safeNext(null, FALLBACK)).toBe(FALLBACK);
    expect(safeNext(undefined, FALLBACK)).toBe(FALLBACK);
  });

  it.each([
    ['//evil.com', 'protocol-relative host'],
    ['//evil.com/dashboard', 'protocol-relative host with a path'],
    ['/\\evil.com', 'backslash host — a slash to the URL parser'],
    ['\\\\evil.com', 'two backslashes'],
    ['/%5Cevil.com', 'percent-encoded backslash'],
    ['/%5cevil.com', 'percent-encoded backslash, lower case'],
    ['https://evil.com', 'absolute URL'],
    ['http://evil.com/dashboard', 'absolute URL with a path'],
    ['javascript:alert(1)', 'a scheme'],
    ['reports', 'a relative segment'],
    ['evil.com', 'a bare host'],
    [' /reports', 'leading whitespace'],
  ])('sends %s (%s) to the fallback', (next) => {
    expect(safeNext(next, FALLBACK)).toBe(FALLBACK);
  });

  it('every value the browser would resolve off-origin is refused', () => {
    // The property the helper exists for, checked the way a browser would.
    const origin = 'https://office.example.com';
    for (const next of ['//evil.com', '/\\evil.com', '/\\\\evil.com', 'https://evil.com']) {
      expect(new URL(next, origin).origin).not.toBe(origin);
      expect(safeNext(next, FALLBACK)).toBe(FALLBACK);
    }
    for (const next of ['/reports', '/events?x=1']) {
      expect(new URL(safeNext(next, FALLBACK), origin).origin).toBe(origin);
    }
  });
});
