import { describe, expect, it } from 'vitest';
import { SESSION_ONLY_COOKIE, rememberedCookies } from '../sessionCookies';

/**
 * "Keep me signed in on this device" (wireframes/backoffice/login.html:39,
 * :95): ticked, the session cookies keep their lifetime; unticked, they
 * become session cookies and the sign-in ends with the browser.
 */
type Written = { name: string; value: string; options: Record<string, unknown> | undefined };

function fakeStore() {
  const writes: Written[] = [];
  return {
    writes,
    getAll: () => writes.map(({ name, value }) => ({ name, value })),
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      writes.push({ name, value, options });
    },
  };
}

// What @supabase/ssr hands the adapter: its 400-day default.
const SB_OPTIONS = { path: '/', sameSite: 'lax', httpOnly: false, maxAge: 400 * 24 * 60 * 60 };

describe('rememberedCookies', () => {
  it('ticked: hands the store back untouched and clears any old marker', () => {
    const store = fakeStore();
    const out = rememberedCookies(store, true);
    expect(out).toBe(store);
    expect(store.writes).toEqual([
      { name: SESSION_ONLY_COOKIE, value: '', options: { path: '/', maxAge: 0 } },
    ]);
    out.set('sb-x-auth-token', 'v', SB_OPTIONS);
    expect(store.writes.at(-1)?.options).toEqual(SB_OPTIONS);
  });

  it('unticked: strips maxAge and expires so the browser holds session cookies', () => {
    const store = fakeStore();
    const out = rememberedCookies(store, false);
    expect(out).not.toBe(store);
    out.set('sb-x-auth-token', 'v', SB_OPTIONS);
    out.set('sb-x-auth-token.1', 'w', { ...SB_OPTIONS, expires: new Date('2027-01-01') });
    const [, first, second] = store.writes;
    expect(first?.options).toEqual({ path: '/', sameSite: 'lax', httpOnly: false });
    expect(first?.options).not.toHaveProperty('maxAge');
    expect(first?.options).not.toHaveProperty('expires');
    expect(second?.options).not.toHaveProperty('expires');
    expect(second?.options).not.toHaveProperty('maxAge');
  });

  it('unticked: sets the marker as a session cookie for the middleware', () => {
    const store = fakeStore();
    rememberedCookies(store, false);
    const marker = store.writes.find((w) => w.name === SESSION_ONLY_COOKIE);
    expect(marker?.value).toBe('1');
    expect(marker?.options).not.toHaveProperty('maxAge');
    expect(marker?.options).toMatchObject({ path: '/', httpOnly: true });
  });

  it('unticked: a deletion (maxAge 0) still deletes', () => {
    const store = fakeStore();
    const out = rememberedCookies(store, false);
    out.set('sb-x-auth-token', '', { ...SB_OPTIONS, maxAge: 0 });
    expect(store.writes.at(-1)?.options).toMatchObject({ maxAge: 0 });
  });

  it('reads through to the underlying store either way', () => {
    const store = fakeStore();
    store.set('a', '1', undefined);
    // The wrapper's own marker write is there too; the point is `a` reads through.
    expect(rememberedCookies(store, false).getAll()).toContainEqual({ name: 'a', value: '1' });
  });
});
