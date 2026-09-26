import { describe, expect, it } from 'vitest';
import { isSafeRelativePath, safeNextPath, safeRelativePath } from '../redirect';

/**
 * The open-redirect guard every sign-in and emailed-link landing uses
 * (§1.4; audit 24.09 §2.3). The escapes below are the real ones: each got
 * past `next.startsWith('/')`, and two of them got past the Staff App's
 * extra `!next.startsWith('//')` as well.
 */
const ORIGIN = 'https://office.thc.example';

describe('safeRelativePath', () => {
  it.each([
    ['/dashboard', '/dashboard'],
    ['/', '/'],
    ['/events/123?tab=board#role-2', '/events/123?tab=board#role-2'],
    ['/staff?view=student', '/staff?view=student'],
    ['/a/../b', '/b'],
    ['/%2F%2Fevil.example', '/%2F%2Fevil.example'],
  ])('accepts the same-origin path %j', (input, expected) => {
    expect(safeRelativePath(input, ORIGIN)).toBe(expected);
    expect(safeRelativePath(input)).toBe(expected);
  });

  it.each([
    ['protocol-relative', '//evil.example'],
    ['protocol-relative with a path', '//evil.example/dashboard'],
    ['backslash host', '/\\evil.example'],
    ['double backslash', '/\\\\evil.example'],
    ['backslash later in the path', '/foo\\..\\\\evil.example'],
    ['bare backslash', '\\\\evil.example'],
    ['tab smuggled between the slashes', '/\t/evil.example'],
    ['newline smuggled between the slashes', '/\n/evil.example'],
    ['carriage return', '/\r/evil.example'],
    ['NUL byte', '/dash\u0000board'],
    ['DEL', '/dash\u007fboard'],
    ['leading space', ' /dashboard'],
    ['line separator', '/\u2028/evil.example'],
    ['absolute https URL', 'https://evil.example'],
    ['absolute URL on our own origin', `${ORIGIN}/dashboard`],
    ['javascript: scheme', 'javascript:alert(1)'],
    ['data: scheme', 'data:text/html,hi'],
    ['scheme-looking path without a slash', 'http:evil.example'],
    ['relative path', 'dashboard'],
    ['dot relative', './dashboard'],
    ['empty', ''],
    ['over-long', `/${'a'.repeat(2048)}`],
  ])('rejects %s', (_why, input) => {
    expect(safeRelativePath(input, ORIGIN)).toBeNull();
    expect(isSafeRelativePath(input, ORIGIN)).toBe(false);
  });

  it.each([null, undefined, 42, {}, ['/dashboard']])('rejects a non-string %j', (input) => {
    expect(safeRelativePath(input, ORIGIN)).toBeNull();
  });

  it('refuses when the origin itself cannot be parsed', () => {
    expect(safeRelativePath('/dashboard', 'not a url')).toBeNull();
  });
});

describe('safeNextPath', () => {
  it('returns a safe next', () => {
    expect(safeNextPath('/events/1', '/dashboard', ORIGIN)).toBe('/events/1');
  });

  it('falls back when next escapes the origin', () => {
    expect(safeNextPath('//evil.example', '/dashboard', ORIGIN)).toBe('/dashboard');
    expect(safeNextPath('/\\evil.example', '/shifts', ORIGIN)).toBe('/shifts');
    expect(safeNextPath(null, '/events')).toBe('/events');
  });

  it('refuses an unsafe fallback rather than trusting it', () => {
    expect(() => safeNextPath('//evil.example', 'https://evil.example')).toThrow(/fallback/);
  });

  // audit D12: the office's deleted /login/safeNext.ts normalised these to
  // `//evil.com` and redirected there. The shared guard resolves them and
  // refuses what the resolution produces.
  it.each([
    '/..//evil.com',
    '/.//evil.com',
    '/a/..//evil.com',
    '/%2e%2e//evil.com',
    '/../..//evil.com',
  ])('dot-segment smuggling %s falls back and stays on the origin', (input) => {
    expect(safeRelativePath(input, ORIGIN)).toBeNull();
    const path = safeNextPath(input, '/reset', ORIGIN);
    expect(path).toBe('/reset');
    expect(new URL(path, ORIGIN).origin).toBe(ORIGIN);
  });

  it('never yields something a browser would read as another host', () => {
    // Belt and braces: whatever comes back, resolving it keeps the origin.
    for (const input of ['//x', '/\\x', '/\t/x', '///x', '/./\\x', '/%09/x']) {
      const path = safeNextPath(input, '/home', ORIGIN);
      expect(new URL(path, ORIGIN).origin).toBe(ORIGIN);
      expect(path.startsWith('//')).toBe(false);
    }
  });
});
