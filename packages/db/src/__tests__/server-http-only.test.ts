import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CookieToSet } from '../session';

/**
 * httpOnly auth cookies are an opt-in per app (security review 12.10): the
 * Client Portal sets THC_AUTH_COOKIE_HTTP_ONLY=1 in its next.config.ts
 * because it has no browser Supabase client. The Back Office and Staff App
 * set nothing and keep the library's readable cookies — their browser
 * clients need them.
 */
const captured = vi.hoisted(() => ({
  server: null as null | { setAll: (toSet: CookieToSet[]) => void },
}));

vi.mock('server-only', () => ({}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: unknown }) => {
    captured.server = options.cookies as typeof captured.server;
    return {};
  },
}));

const { createClient } = await import('../server');

const write: CookieToSet = {
  name: 'sb-abc-auth-token',
  value: 'base64-eyJ4IjoxfQ',
  options: { path: '/', sameSite: 'lax', httpOnly: false, maxAge: 3600 },
};

function written(options?: { httpOnly?: boolean }) {
  const jar: { name: string; options?: Record<string, unknown> }[] = [];
  createClient(
    { getAll: () => [], set: (name, _value, opts) => jar.push({ name, options: opts }) },
    options,
  );
  captured.server!.setAll([write]);
  return jar[0]!.options!;
}

beforeAll(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
});
afterEach(() => {
  vi.stubEnv('THC_AUTH_COOKIE_HTTP_ONLY', '');
});

describe('server client · httpOnly auth cookies are opt-in', () => {
  it('unchanged by default (Back Office, Staff App)', () => {
    expect(written().httpOnly).toBe(false);
  });

  it('on when the app opts in at build time (Client Portal)', () => {
    vi.stubEnv('THC_AUTH_COOKIE_HTTP_ONLY', '1');
    expect(written().httpOnly).toBe(true);
  });

  it('on when a caller asks explicitly, and an explicit false wins over the app setting', () => {
    expect(written({ httpOnly: true }).httpOnly).toBe(true);
    vi.stubEnv('THC_AUTH_COOKIE_HTTP_ONLY', '1');
    expect(written({ httpOnly: false }).httpOnly).toBe(false);
  });
});
