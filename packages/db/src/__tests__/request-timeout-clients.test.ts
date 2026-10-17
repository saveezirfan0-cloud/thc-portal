import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ADR-0152: both server-side clients this package builds carry the
 * request-timeout fetch by default, and drop it only when asked.
 * The two client factories are stubbed to capture their options.
 */
const captured = vi.hoisted(() => ({
  server: null as null | { global?: { fetch?: unknown } },
  admin: null as null | { global?: { fetch?: unknown }; auth?: unknown },
}));

vi.mock('server-only', () => ({}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, options: { global?: { fetch?: unknown } }) => {
    captured.server = options;
    return {};
  },
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, _key: string, options: { global?: { fetch?: unknown } }) => {
    captured.admin = options;
    return {};
  },
}));

const { createClient } = await import('../server');
const { createAdminClient } = await import('../admin');

const saved = { ...process.env };
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abcdefghij.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
});
afterAll(() => {
  process.env = saved;
});
beforeEach(() => {
  captured.server = null;
  captured.admin = null;
});

const cookies = { getAll: () => [], set: () => undefined };

describe('createClient (session, server side)', () => {
  it('bounds reads by default', () => {
    createClient(cookies);
    expect(typeof captured.server?.global?.fetch).toBe('function');
  });

  it('takes the caller’s options, and none at all with false', () => {
    createClient(cookies, {
      requestTimeout: { readMs: 5_000, readOnlyRpcs: ['staff_open_shifts'] },
    });
    expect(typeof captured.server?.global?.fetch).toBe('function');
    createClient(cookies, { requestTimeout: false });
    expect(captured.server?.global).toBeUndefined();
  });
});

describe('createAdminClient (service role)', () => {
  it('bounds reads by default and keeps its auth settings', () => {
    createAdminClient();
    expect(typeof captured.admin?.global?.fetch).toBe('function');
    expect(captured.admin?.auth).toEqual({ persistSession: false, autoRefreshToken: false });
  });

  it('drops the timeout fetch when asked', () => {
    createAdminClient({ requestTimeout: false });
    expect(captured.admin?.global).toBeUndefined();
  });
});
