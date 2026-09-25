import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The Staff App's two places that honour `next` (audit 24.09 §2.3): the
 * sign-in form, and the landing for an emailed link. The callback blocked
 * `//evil` already but not `/\evil`, which a browser reads as the same
 * thing. Both now go through packages/db/src/redirect.ts.
 */
vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: async () => ({ data: { user: {} }, error: null }),
      exchangeCodeForSession: async () => ({ error: null }),
    },
  }),
}));

const { signIn } = await import('../login/actions');
const { GET } = await import('../auth/callback/route');

const saved = { ...process.env };
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
});
afterAll(() => {
  process.env = saved;
});

const ESCAPES = ['//evil.example', '/\\evil.example', '/\t/evil.example', 'https://evil.example'];

describe('sign-in next', () => {
  async function outcome(next: string): Promise<string> {
    const fd = new FormData();
    fd.set('email', 'tom.reid@example.com');
    fd.set('password', 'password123');
    fd.set('next', next);
    try {
      return `RETURNED:${await signIn(null, fd)}`;
    } catch (error) {
      return (error as Error).message;
    }
  }

  it('honours a path on this app', async () => {
    expect(await outcome('/shifts/9')).toBe('REDIRECT:/shifts/9');
  });

  it.each(ESCAPES)('refuses %j', async (next) => {
    expect(await outcome(next)).toBe('REDIRECT:/shifts');
  });
});

describe('/auth/callback next', () => {
  const ORIGIN = 'https://app.thc.example';
  const land = async (next: string) => {
    const res = await GET(
      new Request(`${ORIGIN}/auth/callback?code=abc&next=${encodeURIComponent(next)}`),
    );
    return new URL(res.headers.get('location')!);
  };

  it('honours a path on this app', async () => {
    expect((await land('/activate/done')).pathname).toBe('/activate/done');
  });

  it.each(ESCAPES)('refuses %j and lands on /reset', async (next) => {
    const to = await land(next);
    expect(to.origin).toBe(ORIGIN);
    expect(to.pathname).toBe('/reset');
  });
});
