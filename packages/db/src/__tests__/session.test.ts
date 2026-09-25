import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  KEEP_SIGNED_IN_COOKIE,
  KEEP_SIGNED_IN_MAX_AGE,
  LEGACY_SESSION_ONLY_COOKIE,
  applySessionPersistence,
  authCookieOptions,
  clearKeepSignedInCookie,
  clearLegacySessionOnlyCookie,
  defaultSessionFallback,
  keepSignedInCookie,
  persistenceFromForm,
  readSessionPersistence,
  withSessionPersistence,
} from '../session';
import type { CookieToSet } from '../session';

/**
 * "Keep me signed in on this device" (ADR-0032,
 * `wireframes/backoffice/login.html:39`, `wireframes/client/login.html:65`).
 *
 * The rule under test: ticked → the auth cookies carry a Max-Age; unticked →
 * they carry neither Max-Age nor Expires (a session cookie); and a later
 * writer — above all the middleware's token refresh — keeps whichever the
 * device chose instead of putting `@supabase/ssr`'s 400-day default back.
 */

const LIBRARY_DEFAULT = { path: '/', sameSite: 'lax' as const, httpOnly: false, maxAge: 34560000 };
const tokenWrite = (): CookieToSet => ({
  name: 'sb-abc-auth-token',
  value: 'base64-eyJhY2Nlc3NfdG9rZW4iOiJ4In0',
  options: { ...LIBRARY_DEFAULT },
});
const preference = (value: string) => ({ name: KEEP_SIGNED_IN_COOKIE, value });
const legacy = () => ({ name: LEGACY_SESSION_ONLY_COOKIE, value: '1' });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the checkbox → the choice', () => {
  it('ticked (submitted) is persistent, unticked (absent from the form) is session', () => {
    expect(persistenceFromForm('1')).toBe('persistent');
    expect(persistenceFromForm('on')).toBe('persistent');
    expect(persistenceFromForm(null)).toBe('session');
  });
});

describe('authCookieOptions', () => {
  it('ticked: Max-Age is the 30-day constant', () => {
    expect(KEEP_SIGNED_IN_MAX_AGE).toBe(30 * 24 * 60 * 60);
    const out = authCookieOptions(LIBRARY_DEFAULT, 'persistent');
    expect(out.maxAge).toBe(KEEP_SIGNED_IN_MAX_AGE);
    expect(out.expires).toBeUndefined();
    expect(out).toMatchObject({ path: '/', sameSite: 'lax' });
  });

  it('unticked: neither Max-Age nor Expires survives, so it is a session cookie', () => {
    const out = authCookieOptions({ ...LIBRARY_DEFAULT, expires: new Date(2030, 0, 1) }, 'session');
    expect('maxAge' in out).toBe(false);
    expect('expires' in out).toBe(false);
    expect(out).toMatchObject({ path: '/', sameSite: 'lax', httpOnly: false });
  });

  it('no choice on this device: the library options pass through untouched', () => {
    expect(authCookieOptions(LIBRARY_DEFAULT, null)).toEqual(LIBRARY_DEFAULT);
  });
});

describe('applySessionPersistence', () => {
  it('never turns a deletion into a live cookie', () => {
    const deletion: CookieToSet = {
      name: 'sb-abc-auth-token.1',
      value: '',
      options: { ...LIBRARY_DEFAULT, maxAge: 0 },
    };
    expect(applySessionPersistence([deletion], 'session')).toEqual([deletion]);
    expect(applySessionPersistence([deletion], 'persistent')).toEqual([deletion]);
  });
});

describe('the remembered choice', () => {
  it('reads 1 / 0 and ignores anything else', () => {
    expect(readSessionPersistence([preference('1')])).toBe('persistent');
    expect(readSessionPersistence([preference('0')])).toBe('session');
    expect(readSessionPersistence([preference('yes')])).toBeNull();
    expect(readSessionPersistence([{ name: 'other', value: '0' }])).toBeNull();
    expect(readSessionPersistence(null)).toBeNull();
  });

  it("LEGACY: #65's `thc-session-only` marker (present) reads as session only", () => {
    expect(LEGACY_SESSION_ONLY_COOKIE).toBe('thc-session-only');
    expect(readSessionPersistence([legacy()])).toBe('session');
    expect(readSessionPersistence([{ name: LEGACY_SESSION_ONLY_COOKIE, value: '' }])).toBe(
      'session',
    );
    // The new preference, once the login action has written it, wins.
    expect(readSessionPersistence([legacy(), preference('1')])).toBe('persistent');
    expect(readSessionPersistence([legacy(), preference('yes')])).toBe('session');
  });

  it('is a first-party Lax cookie; persistent when ticked, a session cookie when not', () => {
    const kept = keepSignedInCookie('persistent');
    expect(kept).toMatchObject({ name: KEEP_SIGNED_IN_COOKIE, value: '1' });
    expect(kept.options).toMatchObject({ path: '/', sameSite: 'lax', httpOnly: false });
    expect(kept.options.maxAge).toBeGreaterThan(KEEP_SIGNED_IN_MAX_AGE);

    const session = keepSignedInCookie('session');
    expect(session).toMatchObject({ name: KEEP_SIGNED_IN_COOKIE, value: '0' });
    expect(session.options).toMatchObject({ path: '/', sameSite: 'lax', httpOnly: false });
    expect('maxAge' in session.options).toBe(false);
    expect('expires' in session.options).toBe(false);
  });

  it('is Secure in production only, so plain-http `next dev` keeps it', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(keepSignedInCookie('persistent').options.secure).toBe(false);
    expect(keepSignedInCookie('session').options.secure).toBe(false);
    expect(clearKeepSignedInCookie().options.secure).toBe(false);
    vi.stubEnv('NODE_ENV', 'production');
    expect(keepSignedInCookie('persistent').options.secure).toBe(true);
    expect(keepSignedInCookie('session').options.secure).toBe(true);
    expect(clearKeepSignedInCookie().options.secure).toBe(true);
  });

  it('sign-out deletes it', () => {
    expect(clearKeepSignedInCookie()).toMatchObject({
      name: KEEP_SIGNED_IN_COOKIE,
      value: '',
      options: { path: '/', maxAge: 0 },
    });
  });

  it("LEGACY: #65's marker can be deleted at the path it was set on", () => {
    expect(clearLegacySessionOnlyCookie()).toMatchObject({
      name: LEGACY_SESSION_ONLY_COOKIE,
      value: '',
      options: { path: '/', maxAge: 0, httpOnly: true },
    });
  });
});

describe('withSessionPersistence: the refresh path', () => {
  function harness(
    jar: { name: string; value: string }[],
    options?: Parameters<typeof withSessionPersistence>[1],
  ) {
    const setAll = vi.fn((_toSet: CookieToSet[]) => {});
    const methods = withSessionPersistence({ getAll: () => jar, setAll }, options);
    return { methods, written: () => setAll.mock.calls.at(-1)?.[0] ?? [] };
  }

  it('a device that unticked the box: a refresh writes session cookies', () => {
    const { methods, written } = harness([preference('0')]);
    methods.setAll([tokenWrite()]);
    const [cookie] = written();
    expect(cookie?.name).toBe('sb-abc-auth-token');
    expect(cookie?.options.maxAge).toBeUndefined();
    expect(cookie?.options.expires).toBeUndefined();
  });

  it('a device that ticked it: a refresh slides the 30 days forward', () => {
    const { methods, written } = harness([preference('1')]);
    methods.setAll([tokenWrite()]);
    expect(written()[0]?.options.maxAge).toBe(KEEP_SIGNED_IN_MAX_AGE);
  });

  it('reads the preference at write time, not when the client was built', () => {
    const jar: { name: string; value: string }[] = [];
    const { methods, written } = harness(jar);
    jar.push(preference('0'));
    methods.setAll([tokenWrite()]);
    expect(written()[0]?.options.maxAge).toBeUndefined();
  });

  it('an explicit choice (the login action) beats the cookies', () => {
    const setAll = vi.fn((_toSet: CookieToSet[]) => {});
    const methods = withSessionPersistence(
      { getAll: () => [preference('1')], setAll },
      { persistence: 'session' },
    );
    methods.setAll([tokenWrite()]);
    expect(setAll.mock.calls[0]?.[0][0]?.options.maxAge).toBeUndefined();
  });

  it('a legacy session-only sign-in: a refresh writes session cookies', () => {
    const { methods, written } = harness([legacy()], { fallback: 'persistent' });
    methods.setAll([tokenWrite()]);
    expect(written()[0]?.options.maxAge).toBeUndefined();
    expect(written()[0]?.options.expires).toBeUndefined();
  });

  it('no preference, Back Office / Client Portal fallback: 30 days, never the 400', () => {
    const { methods, written } = harness([], { fallback: 'persistent' });
    methods.setAll([tokenWrite()]);
    expect(written()[0]?.options.maxAge).toBe(KEEP_SIGNED_IN_MAX_AGE);
  });

  it('no preference and no app setting: fails safe to 30 days', () => {
    vi.stubEnv('THC_AUTH_COOKIE_FALLBACK', '');
    const { methods, written } = harness([]);
    methods.setAll([tokenWrite()]);
    expect(written()[0]?.options.maxAge).toBe(KEEP_SIGNED_IN_MAX_AGE);
  });

  it('no preference, Staff App fallback (null): the library default is left alone', () => {
    const { methods, written } = harness([], { fallback: null });
    methods.setAll([tokenWrite()]);
    expect(written()[0]?.options).toEqual(LIBRARY_DEFAULT);
  });

  it("a device's choice beats the fallback either way", () => {
    const ticked = harness([preference('1')], { fallback: null });
    ticked.methods.setAll([tokenWrite()]);
    expect(ticked.written()[0]?.options.maxAge).toBe(KEEP_SIGNED_IN_MAX_AGE);
    const unticked = harness([preference('0')], { fallback: 'persistent' });
    unticked.methods.setAll([tokenWrite()]);
    expect(unticked.written()[0]?.options.maxAge).toBeUndefined();
  });
});

describe('defaultSessionFallback: the app build-time setting', () => {
  it("'library' (the Staff App's next.config) passes the library options through", () => {
    vi.stubEnv('THC_AUTH_COOKIE_FALLBACK', 'library');
    expect(defaultSessionFallback()).toBeNull();
  });

  it("'session' is honoured", () => {
    vi.stubEnv('THC_AUTH_COOKIE_FALLBACK', 'session');
    expect(defaultSessionFallback()).toBe('session');
  });

  it('unset or unrecognised is 30 days (the Back Office and Client Portal set nothing)', () => {
    vi.stubEnv('THC_AUTH_COOKIE_FALLBACK', '');
    expect(defaultSessionFallback()).toBe('persistent');
    vi.stubEnv('THC_AUTH_COOKIE_FALLBACK', 'forever');
    expect(defaultSessionFallback()).toBe('persistent');
  });
});
