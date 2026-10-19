import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { KEEP_SIGNED_IN_COOKIE, KEEP_SIGNED_IN_MAX_AGE } from '../session';
import type { SessionFallback, SessionPersistence } from '../session';

/**
 * ADR-0032 against the REAL `@supabase/ssr` and `@supabase/supabase-js`.
 *
 * Every other session test (session-clients, the apps' middleware-session,
 * keep-signed-in and session-lifetime tests) replaces `@supabase/ssr` with
 * a stub and plays the library's part itself. That pins our wrapper, but
 * says nothing about what a new release of the library hands the wrapper:
 * which writes it makes on sign-in, refresh and sign-out, with which
 * options, through which `setAll` signature. This file is the evidence a
 * library bump is judged on (ADR-0165): GoTrue is the only thing faked
 * (a `fetch` stub answering the token, user and logout endpoints), and the
 * cookie jar is a plain Map, so what lands in it is what a browser would
 * be told.
 *
 * What must hold, whatever the library version:
 *   ticked    → the auth cookies carry Max-Age = 30 days (sign-in AND refresh);
 *   unticked  → no Max-Age and no Expires: a browser-session cookie;
 *   no choice → the app's fallback: 30 days (Office, Client), or the
 *               library's own options passed through (Staff App);
 *   sign-out  → deletions reach the jar untouched (Max-Age 0, empty value);
 *   httpOnly  → the Client Portal's opt-in reaches every auth cookie.
 */

vi.mock('server-only', () => ({}));

const URL_ = 'http://127.0.0.1:54321';
const STORAGE_KEY = 'sb-127-auth-token';
const LIBRARY_MAX_AGE = 400 * 24 * 60 * 60;

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function accessToken(expiresAt: number): string {
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({
    sub: '00000000-0000-0000-0000-000000000001',
    role: 'authenticated',
    aud: 'authenticated',
    exp: expiresAt,
    iat: expiresAt - 3600,
    session_id: '00000000-0000-0000-0000-0000000000aa',
  })}.sig`;
}

const USER = {
  id: '00000000-0000-0000-0000-000000000001',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'ops@thehospitalitycompany.co.uk',
  app_metadata: { provider: 'email' },
  user_metadata: {},
  created_at: '2026-09-01T00:00:00Z',
};

function sessionBody(refreshToken: string) {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  return {
    access_token: accessToken(expiresAt),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    refresh_token: refreshToken,
    user: USER,
  };
}

/** GoTrue, as far as these flows reach it. */
const gotrue = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  if (url.includes('/auth/v1/token?grant_type=password')) return json(sessionBody('rt-signin'));
  if (url.includes('/auth/v1/token?grant_type=refresh_token'))
    return json(sessionBody('rt-refreshed'));
  if (url.includes('/auth/v1/user')) return json(USER);
  if (url.includes('/auth/v1/logout')) return new Response(null, { status: 204 });
  return json({ message: `unexpected ${url}` }, 500);
});

interface Written {
  name: string;
  value: string;
  options: Record<string, unknown>;
}

/** A cookie store as `next/headers` cookies() presents it, recording writes. */
function jar(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const writes: Written[] = [];
  return {
    writes,
    store: {
      getAll: () => [...values].map(([name, value]) => ({ name, value })),
      set: (name: string, value: string, options: Record<string, unknown> = {}) => {
        writes.push({ name, value, options });
        if (value === '' || options['maxAge'] === 0) values.delete(name);
        else values.set(name, value);
      },
    },
  };
}

/** A stored session whose access token has expired, so the next read refreshes it. */
function expiredSessionCookie(): Record<string, string> {
  const expiresAt = Math.floor(Date.now() / 1000) - 60;
  const session = {
    access_token: accessToken(expiresAt),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    refresh_token: 'rt-old',
    user: USER,
  };
  return { [STORAGE_KEY]: `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}` };
}

const authWrites = (writes: Written[]) => writes.filter((w) => w.name.startsWith(STORAGE_KEY));

function expectLifetime(writes: Written[], lifetime: 'session' | number): void {
  const live = authWrites(writes).filter((w) => w.value !== '');
  expect(live.length).toBeGreaterThan(0);
  for (const w of live) {
    if (lifetime === 'session') {
      expect(w.options['maxAge']).toBeUndefined();
      expect(w.options['expires']).toBeUndefined();
    } else {
      expect(w.options['maxAge']).toBe(lifetime);
    }
  }
}

const saved = { ...process.env };
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = URL_;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-for-tests';
  vi.stubGlobal('fetch', gotrue);
});
afterAll(() => {
  process.env = saved;
  vi.unstubAllGlobals();
});
afterEach(() => {
  gotrue.mockClear();
  vi.unstubAllEnvs();
});

const { createClient: createServer } = await import('../server');

async function signIn(
  options: { persistence?: SessionPersistence; fallback?: SessionFallback; httpOnly?: boolean },
  initial: Record<string, string> = {},
) {
  const { store, writes } = jar(initial);
  const client = createServer(store, { ...options, requestTimeout: false });
  const { error } = await client.auth.signInWithPassword({
    email: USER.email,
    password: 'not-the-seed-password',
  });
  expect(error).toBeNull();
  return { client, store, writes };
}

describe('server client, real @supabase/ssr: sign-in (the login action)', () => {
  it('ticked → 30-day auth cookies', async () => {
    const { writes } = await signIn({ persistence: 'persistent' });
    expectLifetime(writes, KEEP_SIGNED_IN_MAX_AGE);
  });

  it('unticked → browser-session auth cookies', async () => {
    const { writes } = await signIn({ persistence: 'session' });
    expectLifetime(writes, 'session');
  });

  it("no choice, Office/Client fallback → 30 days, never the library's 400", async () => {
    const { writes } = await signIn({ fallback: 'persistent' });
    expectLifetime(writes, KEEP_SIGNED_IN_MAX_AGE);
  });

  it("no choice, Staff App fallback (null) → the library's own lifetime", async () => {
    const { writes } = await signIn({ fallback: null });
    expectLifetime(writes, LIBRARY_MAX_AGE);
  });

  it("the Client Portal's httpOnly opt-in reaches every auth cookie", async () => {
    const { writes } = await signIn({ persistence: 'persistent', httpOnly: true });
    for (const w of authWrites(writes)) expect(w.options['httpOnly']).toBe(true);
  });
});

describe('server client, real @supabase/ssr: token refresh honours the remembered choice', () => {
  async function refresh(preference: '0' | '1' | null, fallback: SessionFallback) {
    const initial = {
      ...expiredSessionCookie(),
      ...(preference === null ? {} : { [KEEP_SIGNED_IN_COOKIE]: preference }),
    };
    const { store, writes } = jar(initial);
    const client = createServer(store, { fallback, requestTimeout: false });
    const { data, error } = await client.auth.getSession();
    expect(error).toBeNull();
    expect(data.session?.refresh_token).toBe('rt-refreshed');
    expect(gotrue.mock.calls.some(([u]) => String(u).includes('grant_type=refresh_token'))).toBe(
      true,
    );
    return writes;
  }

  it('remembered "unticked" → the refreshed cookies stay session-only', async () => {
    expectLifetime(await refresh('0', 'persistent'), 'session');
  });

  it('remembered "ticked" → the refreshed cookies slide another 30 days', async () => {
    expectLifetime(await refresh('1', null), KEEP_SIGNED_IN_MAX_AGE);
  });

  it('no preference cookie → the fallback decides', async () => {
    expectLifetime(await refresh(null, 'persistent'), KEEP_SIGNED_IN_MAX_AGE);
    expectLifetime(await refresh(null, 'session'), 'session');
  });
});

describe('server client, real @supabase/ssr: sign-out', () => {
  it('deletes the auth cookies; a deletion is never given a lifetime', async () => {
    const signedIn = await signIn({ persistence: 'session' });
    const cookies = Object.fromEntries(
      signedIn.store.getAll().map(({ name, value }) => [name, value]),
    );
    const { store, writes } = jar({ ...cookies, [KEEP_SIGNED_IN_COOKIE]: '1' });
    const client = createServer(store, { requestTimeout: false });
    const { error } = await client.auth.signOut();
    expect(error).toBeNull();
    const deletions = authWrites(writes);
    expect(deletions.length).toBeGreaterThan(0);
    for (const w of deletions) {
      expect(w.value).toBe('');
      expect(w.options['maxAge']).toBe(0);
    }
    expect(store.getAll().some(({ name }) => name.startsWith(STORAGE_KEY))).toBe(false);
  });
});

describe('browser client, real @supabase/ssr', () => {
  /** `document.cookie` as a browser keeps it: one Set-Cookie string per write. */
  function documentJar(initial: Record<string, string> = {}) {
    const values = new Map(Object.entries(initial));
    const written: string[] = [];
    const doc = {
      get cookie() {
        return [...values].map(([n, v]) => `${n}=${encodeURIComponent(v)}`).join('; ');
      },
      set cookie(line: string) {
        written.push(line);
        const [pair = ''] = line.split(';');
        const eq = pair.indexOf('=');
        const name = pair.slice(0, eq);
        const value = decodeURIComponent(pair.slice(eq + 1));
        if (value === '' || /Max-Age=0(;|$)/.test(line)) values.delete(name);
        else values.set(name, value);
      },
    };
    vi.stubGlobal('document', doc);
    return written;
  }

  async function browserSignIn(preference: '0' | '1') {
    const written = documentJar({ [KEEP_SIGNED_IN_COOKIE]: preference });
    const { createClient: createBrowser } = await import('../browser');
    // Not a singleton: each case needs its own jar. In a real browser the
    // library keeps one client per page, which changes nothing here.
    const client = createBrowser({ fallback: 'persistent' });
    const { error } = await client.auth.signInWithPassword({
      email: USER.email,
      password: 'not-the-seed-password',
    });
    expect(error).toBeNull();
    return written.filter((line) => line.startsWith(STORAGE_KEY));
  }

  it('a long-open page (check-in monitor) keeps an unticked sign-in session-only', async () => {
    const lines = await browserSignIn('0');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toMatch(/Max-Age=/);
      expect(line).not.toMatch(/Expires=/);
    }
  });

  it('a ticked sign-in gets 30 days in the browser too', async () => {
    const lines = await browserSignIn('1');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toMatch(new RegExp(`Max-Age=${KEEP_SIGNED_IN_MAX_AGE}`));
  });
});
