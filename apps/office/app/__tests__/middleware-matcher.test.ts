import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// No session: every request is signed out, so only an exempt path passes.
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: null } }),
      getSession: async () => ({ data: { session: null } }),
    },
  }),
}));

const { config, middleware } = await import('../../middleware');

/**
 * The session gate's matcher (audit D52): static files are skipped only at
 * the top level, where public/ serves them. A nested path that merely ends
 * in an image extension is a page route and must pass the gate.
 */
describe('middleware matcher', () => {
  const matcher = new RegExp(`^${config.matcher[0]}$`);

  it('skips the top-level public files and Next.js assets', () => {
    for (const skipped of [
      '/favicon.ico',
      '/logo.png',
      '/manifest.webmanifest',
      '/sw.js',
      '/_next/static/x.js',
      '/_next/image',
    ]) {
      expect(matcher.test(skipped), skipped).toBe(false);
    }
  });

  it('gates a nested path that merely ends in an image extension', () => {
    for (const gated of [
      '/staff/x.png',
      '/events/1/photo.jpg',
      '/dashboard',
      '/sw.jsx',
      '/favicon.icon',
      '/',
    ]) {
      expect(matcher.test(gated), gated).toBe(true);
    }
  });
});

/**
 * The job routes pg_cron calls carry no session and gate themselves on a
 * bearer secret (ADR-0025, ADR-0074). The session gate steps aside for
 * exactly those paths, POST only — nothing under them, no other method.
 */
describe('middleware · the job routes', () => {
  const saved = { ...process.env };
  beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  });
  afterAll(() => {
    process.env = saved;
  });

  const call = (path: string, method: string) =>
    middleware(new NextRequest(`http://127.0.0.1:3000${path}`, { method }));
  const passes = (res: Response) => res.status === 200 && !res.headers.get('location');

  it('lets a POST to each job path through to its own bearer check', async () => {
    for (const path of ['/api/jobs/rtw-check', '/api/jobs/event-documents']) {
      expect(passes(await call(path, 'POST')), path).toBe(true);
    }
  });

  it('sends a GET to a job path to /login like any signed-out request', async () => {
    for (const path of ['/api/jobs/rtw-check', '/api/jobs/event-documents']) {
      const res = await call(path, 'GET');
      expect(res.status, path).toBe(307);
      expect(new URL(res.headers.get('location')!).pathname, path).toBe('/login');
    }
  });

  it('does not exempt a path under a job route', async () => {
    for (const path of ['/api/jobs/rtw-check/x', '/api/jobs/event-documents/x', '/api/jobs']) {
      const res = await call(path, 'POST');
      expect(passes(res), path).toBe(false);
      expect(new URL(res.headers.get('location')!).pathname, path).toBe('/login');
    }
  });
});
