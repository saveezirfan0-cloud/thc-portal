import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { KEEP_SIGNED_IN_MAX_AGE } from '@thc/db';

/**
 * ADR-0032 on the Staff App: there is no "Keep me signed in" box, so the
 * middleware's token refresh must leave `@supabase/ssr`'s own cookie
 * lifetime alone — the Back Office and Client Portal's 30-day fallback for a
 * device with no preference is not the Staff App's. It must hold whatever the
 * build-time setting says: the middleware passes `fallback: null` itself.
 */
const LIBRARY_MAX_AGE = 400 * 24 * 60 * 60;

const state = vi.hoisted(() => ({
  refreshWrites: [] as { name: string; value: string; options: Record<string, unknown> }[],
}));

// Plays the library during a middleware refresh: it writes a fresh token with
// @supabase/ssr's own 400-day default through the cookie methods it was given.
vi.mock('@supabase/ssr', () => ({
  createServerClient: (
    _url: string,
    _key: string,
    { cookies }: { cookies: { setAll: (toSet: unknown[]) => void } },
  ) => ({
    auth: {
      getUser: async () => {
        cookies.setAll(state.refreshWrites);
        return { data: { user: { app_metadata: { role: 'staff' } } } };
      },
    },
  }),
}));

const { middleware } = await import('../../middleware');

const saved = { ...process.env };
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
});
afterAll(() => {
  process.env = saved;
});
afterEach(() => {
  vi.unstubAllEnvs();
});

async function refresh(): Promise<string> {
  state.refreshWrites = [
    {
      name: 'sb-abc-auth-token',
      value: 'base64-fresh',
      options: { path: '/', sameSite: 'lax', httpOnly: false, maxAge: LIBRARY_MAX_AGE },
    },
  ];
  const request = new NextRequest('http://127.0.0.1:3001/shifts', {
    headers: { cookie: 'sb-abc-auth-token=base64-old' },
  });
  const response = await middleware(request);
  return response.headers.get('set-cookie') ?? '';
}

describe('Staff App token refresh (no preference cookie, ever)', () => {
  it("keeps the library's lifetime, unchanged by ADR-0032", async () => {
    const header = await refresh();
    expect(header).toContain('sb-abc-auth-token=base64-fresh');
    expect(header).toContain(`Max-Age=${LIBRARY_MAX_AGE}`);
    expect(header).not.toContain(`Max-Age=${KEEP_SIGNED_IN_MAX_AGE}`);
  });

  it('even when the build-time setting is missing (the factories would fall back to 30 days)', async () => {
    vi.stubEnv('THC_AUTH_COOKIE_FALLBACK', '');
    const header = await refresh();
    expect(header).toContain(`Max-Age=${LIBRARY_MAX_AGE}`);
  });
});
