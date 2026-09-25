import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WRONG_CREDENTIALS } from '../copy';
import { SESSION_ONLY_COOKIE } from '../sessionCookies';

/**
 * The sign-in action (§1.4, wireframes/backoffice/login.html):
 *  - `next` is honoured only as a path on this origin (open redirect);
 *  - a Client Portal account is "refused the same way" (login.html:55) —
 *    same sentence, and the office keeps no session for it;
 *  - "Keep me signed in on this device" decides the cookies' lifetime.
 * Supabase and Next are stubbed; this is about what the action decides.
 */
const fakes = vi.hoisted(() => {
  type Written = { name: string; value: string; options?: Record<string, unknown> };
  const writes: Written[] = [];
  const store = {
    writes,
    getAll: () => writes.map(({ name, value }) => ({ name, value })),
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      writes.push({ name, value, options });
    },
  };
  const auth = {
    signInWithPassword: vi.fn(),
    signOut: vi.fn(async () => ({ error: null })),
  };
  const createClient = vi.fn(() => ({ auth }));
  const redirect = vi.fn();
  return { store, auth, createClient, redirect };
});

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => fakes.store) }));
vi.mock('next/navigation', () => ({ redirect: fakes.redirect }));
vi.mock('@thc/db/server', () => ({ createClient: fakes.createClient }));

const { signIn } = await import('../actions');

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const CREDENTIALS = { email: 'gisela@thehospitalitycompany.co.uk', password: 'correct horse 1' };
const admin = { data: { user: { app_metadata: { role: 'admin' } } }, error: null };
const client = { data: { user: { app_metadata: { role: 'client' } } }, error: null };
const roleless = { data: { user: { app_metadata: {} } }, error: null };
const wrong = {
  data: { user: null },
  error: { status: 400, code: 'invalid_credentials', message: 'x' },
};

beforeEach(() => {
  process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'http://127.0.0.1:54321';
  process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'anon';
  fakes.store.writes.length = 0;
  fakes.auth.signInWithPassword.mockReset();
  fakes.auth.signOut.mockClear();
  fakes.createClient.mockClear();
  fakes.redirect.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('signIn · where it lands (open redirect)', () => {
  it.each(['//evil.com', '/\\evil.com', 'https://evil.com', '/%5Cevil.com', 'evil.com'])(
    'never follows next=%s — lands on /dashboard',
    async (next) => {
      fakes.auth.signInWithPassword.mockResolvedValue(admin);
      await signIn(null, form({ ...CREDENTIALS, next, remember: 'on' }));
      expect(fakes.redirect).toHaveBeenCalledWith('/dashboard');
    },
  );

  it('follows a path on this origin, query included', async () => {
    fakes.auth.signInWithPassword.mockResolvedValue(admin);
    await signIn(null, form({ ...CREDENTIALS, next: '/reports?week=39', remember: 'on' }));
    expect(fakes.redirect).toHaveBeenCalledWith('/reports?week=39');
  });

  it('lands on /dashboard when no next was asked for', async () => {
    fakes.auth.signInWithPassword.mockResolvedValue(admin);
    await signIn(null, form({ ...CREDENTIALS, remember: 'on' }));
    expect(fakes.redirect).toHaveBeenCalledWith('/dashboard');
  });
});

describe('signIn · refused the same way (§1.4)', () => {
  it('a wrong password gets the wireframe sentence and no redirect', async () => {
    fakes.auth.signInWithPassword.mockResolvedValue(wrong);
    expect(await signIn(null, form({ ...CREDENTIALS, remember: 'on' }))).toBe(WRONG_CREDENTIALS);
    expect(fakes.redirect).not.toHaveBeenCalled();
    expect(fakes.auth.signOut).not.toHaveBeenCalled();
  });

  it('a Client Portal account gets the SAME sentence, is signed out of this host, and is not redirected', async () => {
    fakes.auth.signInWithPassword.mockResolvedValue(client);
    expect(await signIn(null, form({ ...CREDENTIALS, remember: 'on' }))).toBe(WRONG_CREDENTIALS);
    expect(fakes.redirect).not.toHaveBeenCalled();
    // Local only: their genuine Client Portal sessions elsewhere survive.
    expect(fakes.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('an account with no role at all is not this app either (allow-list)', async () => {
    fakes.auth.signInWithPassword.mockResolvedValue(roleless);
    expect(await signIn(null, form({ ...CREDENTIALS, remember: 'on' }))).toBe(WRONG_CREDENTIALS);
    expect(fakes.redirect).not.toHaveBeenCalled();
    expect(fakes.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('an admin is admitted and never signed out', async () => {
    fakes.auth.signInWithPassword.mockResolvedValue(admin);
    expect(await signIn(null, form({ ...CREDENTIALS, remember: 'on' }))).toBeUndefined();
    expect(fakes.auth.signOut).not.toHaveBeenCalled();
    expect(fakes.redirect).toHaveBeenCalledTimes(1);
  });

  it('empty fields never reach Supabase', async () => {
    expect(await signIn(null, form({ email: '', password: '' }))).toBe(
      'Enter your email and password.',
    );
    expect(fakes.createClient).not.toHaveBeenCalled();
  });
});

describe('signIn · "Keep me signed in on this device"', () => {
  const SB = { path: '/', sameSite: 'lax', httpOnly: false, maxAge: 400 * 24 * 60 * 60 };

  function storeHandedToSupabase() {
    const [handed] = fakes.createClient.mock.calls[0] as unknown as [
      { set: (n: string, v: string, o?: Record<string, unknown>) => void },
    ];
    return handed;
  }

  it('ticked: the cookies keep the lifetime Supabase gives them', async () => {
    fakes.auth.signInWithPassword.mockResolvedValue(admin);
    await signIn(null, form({ ...CREDENTIALS, remember: 'on' }));
    storeHandedToSupabase().set('sb-x-auth-token', 'v', SB);
    const written = fakes.store.writes.find((w) => w.name === 'sb-x-auth-token');
    expect(written?.options).toEqual(SB);
    // and any old marker is cleared
    expect(fakes.store.writes.find((w) => w.name === SESSION_ONLY_COOKIE)?.options).toMatchObject({
      maxAge: 0,
    });
  });

  it('unticked (no field submitted): the cookies become session cookies and the marker is set', async () => {
    fakes.auth.signInWithPassword.mockResolvedValue(admin);
    await signIn(null, form(CREDENTIALS));
    storeHandedToSupabase().set('sb-x-auth-token', 'v', SB);
    const written = fakes.store.writes.find((w) => w.name === 'sb-x-auth-token');
    expect(written?.options).not.toHaveProperty('maxAge');
    expect(written?.options).not.toHaveProperty('expires');
    const marker = fakes.store.writes.find((w) => w.name === SESSION_ONLY_COOKIE);
    expect(marker?.value).toBe('1');
    expect(marker?.options).not.toHaveProperty('maxAge');
  });
});
