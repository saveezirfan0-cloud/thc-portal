import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The root layout's read behind the menu counter (§4.1) and the sidebar
 * foot. It runs on every request of every screen, so what it must never do
 * is throw, query without a session, or trust anything it did not verify.
 */
type Claims = {
  email?: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
} | null;

const state: {
  claims: Claims;
  count: number | null;
  error: { message: string } | null;
  throwOn: 'claims' | 'query' | null;
} = { claims: null, count: 0, error: null, throwOn: null };
const select = vi.fn();

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({
    auth: {
      getClaims: async () => {
        if (state.throwOn === 'claims') throw new Error('jwks unreachable');
        return { data: state.claims ? { claims: state.claims } : null, error: null };
      },
    },
    from: (table: string) => ({
      select: (...args: unknown[]) => {
        select(table, ...args);
        if (state.throwOn === 'query') throw new Error('network');
        return Promise.resolve({ count: state.count, error: state.error });
      },
    }),
  }),
}));

const { loadChrome, operatorName } = await import('../chrome');

const admin: Claims = {
  email: 'gisela@thehospitalitycompany.example',
  app_metadata: { role: 'admin' },
  user_metadata: { full_name: 'Gisela M.' },
};

describe('loadChrome', () => {
  const saved = { ...process.env };
  beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  });
  afterAll(() => {
    process.env = saved;
  });
  afterEach(() => {
    Object.assign(state, { claims: null, count: 0, error: null, throwOn: null });
    select.mockClear();
  });

  it('counts the Needs-review queue for the admin and names them for the foot', async () => {
    state.claims = admin;
    state.count = 7;
    expect(await loadChrome()).toEqual({
      complianceCount: 7,
      user: { name: 'Gisela M.', role: 'Admin' },
    });
    // A count, not the rows: the badge does not need the queue.
    expect(select).toHaveBeenCalledWith('compliance_review_queue_v', 'item_id', {
      count: 'exact',
      head: true,
    });
  });

  it('queries nothing without a session (/login is under the same layout)', async () => {
    expect(await loadChrome()).toEqual({ complianceCount: 0, user: null });
    expect(select).not.toHaveBeenCalled();
  });

  it('queries nothing for a session that is not the office’s', async () => {
    state.claims = { email: 'marco@leonardo-stpauls.example', app_metadata: { role: 'client' } };
    state.count = 7;
    expect(await loadChrome()).toEqual({
      complianceCount: 0,
      user: { name: 'marco', role: 'Client' },
    });
    expect(select).not.toHaveBeenCalled();
  });

  it('is a blank badge, not a broken page, when the view errors', async () => {
    state.claims = admin;
    state.error = { message: 'permission denied' };
    state.count = null;
    expect(await loadChrome()).toEqual({
      complianceCount: 0,
      user: { name: 'Gisela M.', role: 'Admin' },
    });
  });

  it('never throws — the chrome is on every screen', async () => {
    state.claims = admin;
    state.throwOn = 'query';
    expect(await loadChrome()).toEqual({ complianceCount: 0, user: null });
    state.throwOn = 'claims';
    expect(await loadChrome()).toEqual({ complianceCount: 0, user: null });
  });

  it('does nothing with no Supabase configured (the Phase 0 shell)', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    state.claims = admin;
    expect(await loadChrome()).toEqual({ complianceCount: 0, user: null });
    expect(select).not.toHaveBeenCalled();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  });
});

describe('operatorName', () => {
  it('prefers the invite’s full_name, then the email’s local part, then a plain word', () => {
    expect(operatorName('Gisela M.', 'gisela@thehospitalitycompany.example')).toBe('Gisela M.');
    expect(operatorName('  ', 'ops@thehospitalitycompany.example')).toBe('ops');
    expect(operatorName(undefined, undefined)).toBe('Signed in');
    expect(operatorName(42, 'not-an-email')).toBe('Signed in');
  });
});
