import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RosterPageData } from '../data';
import { parseRosterReport } from '../report';

/**
 * ADR-0138 · GET /staff/roster/export: only an office session gets a file,
 * no file when the report cannot be read, and the file is the screen's
 * filter, sorted by surname.
 */
const state = vi.hoisted(() => ({
  user: null as { app_metadata: Record<string, unknown> } | null,
  page: null as unknown as RosterPageData,
}));

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
}));
vi.mock('../../data', () => ({ supabaseConfigured: () => true }));
vi.mock('../data', () => ({ loadRosterPage: async () => state.page }));

const { GET } = await import('../export/route');

const entry = (id: string, first: string, last: string, grp: 'spudbros' | 'thc') => ({
  id,
  email: `${first.toLowerCase()}@x.co`,
  first_name: first,
  last_name: last,
  payroll_id: null,
  grp,
  loaded_at: '2026-10-08T14:55:12Z',
});

const call = (query = '') => GET(new Request(`https://office.test/staff/roster/export${query}`));

beforeEach(() => {
  state.user = { app_metadata: { role: 'admin' } };
  state.page = {
    waiting: [
      entry('1', 'Daisy', 'Marsden', 'spudbros'),
      entry('2', 'Joshua', 'Allen', 'spudbros'),
      entry('3', 'Kept', 'Here', 'spudbros'),
      entry('4', 'Tia', 'Cole', 'thc'),
    ],
    report: parseRosterReport({ applied: ['3'] }),
    problem: null,
  };
});

describe('GET /staff/roster/export', () => {
  it('turns away a signed-out session and a non-office one', async () => {
    state.user = null;
    expect((await call()).status).toBe(401);
    state.user = { app_metadata: { role: 'staff' } };
    expect((await call()).status).toBe(403);
  });

  it('gives no file when the list or its report cannot be read', async () => {
    state.page = { ...state.page, report: null, problem: 'The reminder report could not be read' };
    const res = await call();
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('could not be read');
  });

  it('exports the filter, sorted by surname, as a named CSV that is never cached', async () => {
    const res = await call('?grp=spudbros&status=waiting');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="invite-list-spudbros-not-applied-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    const lines = (await res.text()).replace(/^\uFEFF/, '').trimEnd().split('\r\n');
    expect(lines.slice(1).map((l) => l.split(',').slice(0, 2).join(' '))).toEqual([
      'Joshua Allen',
      'Daisy Marsden',
    ]);
  });
});
