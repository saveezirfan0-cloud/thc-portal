import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEEP_SIGNED_IN_COOKIE, KEEP_SIGNED_IN_MAX_AGE } from '../session';
import type { CookieToSet } from '../session';

/**
 * ADR-0032: the two Supabase clients this package builds hand their auth-cookie
 * writes through `withSessionPersistence`. `@supabase/ssr` is replaced by a
 * stub that keeps the cookie methods it was given, so the test can play the
 * library's part — a token refresh writing `sb-*-auth-token` with the
 * library's 400-day default — and see what actually reaches the cookie jar.
 */
type Methods = {
  getAll: () => { name: string; value: string }[];
  setAll: (toSet: CookieToSet[]) => void;
};
const captured = vi.hoisted(() => ({ server: null as unknown, browser: null as unknown }));

vi.mock('server-only', () => ({}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: unknown }) => {
    captured.server = options.cookies;
    return {};
  },
  createBrowserClient: (_url: string, _key: string, options: { cookies: unknown }) => {
    captured.browser = options.cookies;
    return {};
  },
}));

const { createClient: createServer } = await import('../server');
const {
  createClient: createBrowser,
  serializeCookie,
  readDocumentCookies,
} = await import('../browser');

const refresh = (): CookieToSet[] => [
  {
    name: 'sb-abc-auth-token',
    value: 'base64-eyJ4IjoxfQ',
    options: { path: '/', sameSite: 'lax', httpOnly: false, maxAge: 400 * 24 * 60 * 60 },
  },
];

const saved = { ...process.env };
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
});
afterAll(() => {
  process.env = saved;
  vi.unstubAllGlobals();
});

describe('server client (server actions, route handlers such as /auth/callback)', () => {
  function jar(pref: string | null) {
    const set = vi.fn();
    const store = {
      getAll: () => (pref === null ? [] : [{ name: KEEP_SIGNED_IN_COOKIE, value: pref }]),
      set,
    };
    return { store, set };
  }

  it('unticked device: a refresh writes a session cookie', () => {
    const { store, set } = jar('0');
    createServer(store);
    (captured.server as Methods).setAll(refresh());
    const [, , options] = set.mock.calls[0] ?? [];
    expect(options).not.toHaveProperty('maxAge');
    expect(options).not.toHaveProperty('expires');
  });

  it('ticked device: a refresh writes the 30-day Max-Age', () => {
    const { store, set } = jar('1');
    createServer(store);
    (captured.server as Methods).setAll(refresh());
    expect(set.mock.calls[0]?.[2]).toMatchObject({ maxAge: KEEP_SIGNED_IN_MAX_AGE });
  });

  it("the login action's explicit choice wins over a stale preference", () => {
    const { store, set } = jar('1');
    createServer(store, { persistence: 'session' });
    (captured.server as Methods).setAll(refresh());
    expect(set.mock.calls[0]?.[2]).not.toHaveProperty('maxAge');
  });
});

describe('browser client (a long-open page refreshing its own token)', () => {
  let written: string[];
  let cookieHeader: string;

  beforeEach(() => {
    written = [];
    cookieHeader = '';
    vi.stubGlobal('document', {
      get cookie() {
        return cookieHeader;
      },
      set cookie(value: string) {
        written.push(value);
      },
    });
  });

  it('unticked device: writes the auth cookie without Max-Age or Expires', () => {
    cookieHeader = `${KEEP_SIGNED_IN_COOKIE}=0; sb-abc-auth-token=base64-old`;
    createBrowser();
    (captured.browser as Methods).setAll(refresh());
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(/^sb-abc-auth-token=base64-eyJ4IjoxfQ; /);
    expect(written[0]).not.toMatch(/Max-Age|Expires/);
    expect(written[0]).toContain('Path=/');
    expect(written[0]).toContain('SameSite=Lax');
  });

  it('ticked device: writes the 30-day Max-Age', () => {
    cookieHeader = `${KEEP_SIGNED_IN_COOKIE}=1`;
    createBrowser();
    (captured.browser as Methods).setAll(refresh());
    expect(written[0]).toContain(`Max-Age=${KEEP_SIGNED_IN_MAX_AGE}`);
  });

  it('reads document.cookie the way the library adapter does', () => {
    cookieHeader = 'a=1; b=x%3Dy; c="quoted"; broken';
    expect(readDocumentCookies()).toEqual([
      { name: 'a', value: '1' },
      { name: 'b', value: 'x=y' },
      { name: 'c', value: 'quoted' },
    ]);
  });

  it('serializes a deletion with Max-Age=0', () => {
    expect(serializeCookie('sb-abc-auth-token.1', '', { path: '/', maxAge: 0 })).toBe(
      'sb-abc-auth-token.1=; Max-Age=0; Path=/',
    );
  });
});
