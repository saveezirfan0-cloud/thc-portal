import { describe, expect, it } from 'vitest';
import {
  SESSION_ONLY_COOKIE,
  isSessionOnly,
  parseCookieHeader,
  serializeCookie,
  sessionCookieOptions,
} from '../session';
import { appOrigin, recoveryRedirect } from '../origin';

/**
 * "Keep me signed in on this device" (ADR-0035) and the reset-link origin
 * (audit D13).
 */
const PERSISTENT = { path: '/', sameSite: 'lax', httpOnly: false, maxAge: 400 * 24 * 60 * 60 };

describe('sessionCookieOptions', () => {
  it('ticked: the auth cookie keeps @supabase/ssr’s Max-Age', () => {
    expect(sessionCookieOptions(PERSISTENT, false)).toEqual(PERSISTENT);
  });

  it('unticked: Max-Age and Expires are dropped, so the browser forgets it on close', () => {
    const out = sessionCookieOptions({ ...PERSISTENT, expires: new Date(Date.now() + 1e9) }, true);
    expect(out).toEqual({ path: '/', sameSite: 'lax', httpOnly: false });
  });

  it('a deletion stays a deletion: sign-out must still clear the cookie', () => {
    expect(sessionCookieOptions({ ...PERSISTENT, maxAge: 0 }, true)).toEqual({
      ...PERSISTENT,
      maxAge: 0,
    });
    const past = { path: '/', expires: new Date(0) };
    expect(sessionCookieOptions(past, true)).toEqual(past);
  });

  it('passes undefined through', () => {
    expect(sessionCookieOptions(undefined, true)).toBeUndefined();
  });
});

describe('the marker', () => {
  it('is read from the request cookies', () => {
    expect(isSessionOnly([{ name: SESSION_ONLY_COOKIE, value: '1' }])).toBe(true);
    expect(isSessionOnly([{ name: SESSION_ONLY_COOKIE, value: '0' }])).toBe(false);
    expect(isSessionOnly([{ name: 'sb-x-auth-token', value: '1' }])).toBe(false);
  });

  it('round-trips through document.cookie', () => {
    const header = `a=1; ${SESSION_ONLY_COOKIE}=1; sb-x-auth-token=base64-eyJ%3D`;
    expect(parseCookieHeader(header)).toEqual([
      { name: 'a', value: '1' },
      { name: SESSION_ONLY_COOKIE, value: '1' },
      { name: 'sb-x-auth-token', value: 'base64-eyJ=' },
    ]);
  });

  it('serialises a session cookie with no Max-Age', () => {
    expect(serializeCookie('sb-x-auth-token', 'v=1', { path: '/', sameSite: 'lax' })).toBe(
      'sb-x-auth-token=v%3D1; Path=/; SameSite=Lax',
    );
    expect(serializeCookie('k', 'v', { maxAge: 0, path: '/', secure: true })).toBe(
      'k=v; Max-Age=0; Path=/; Secure',
    );
  });
});

describe('appOrigin (D13)', () => {
  it('uses the app’s own URL, without a trailing slash', () => {
    expect(appOrigin('https://staff.thc.example/ ', 'http://127.0.0.1:3001', 'production')).toBe(
      'https://staff.thc.example',
    );
  });

  it('refuses in production when it is unset — never VERCEL_URL, never localhost', () => {
    expect(appOrigin(undefined, 'http://127.0.0.1:3001', 'production')).toBeNull();
    expect(appOrigin('  ', 'http://127.0.0.1:3001', 'production')).toBeNull();
  });

  it('uses the dev server locally', () => {
    expect(appOrigin(undefined, 'http://127.0.0.1:3001', 'development')).toBe(
      'http://127.0.0.1:3001',
    );
  });

  it('the recovery redirect is /auth/confirm with no query of its own', () => {
    expect(recoveryRedirect('https://office.thc.example/')).toBe(
      'https://office.thc.example/auth/confirm',
    );
  });
});
