import { describe, expect, it } from 'vitest';
import { loadCheckMonitor } from '../checksData';

const NOW = '2026-09-30T13:30:00Z';

type Rows = Record<string, { data: unknown; error?: { message: string } | null }>;

/** A chainable stand-in for the Supabase client: every builder call returns itself. */
function fake(rows: Rows) {
  const calls: { table: string; not: unknown[][] }[] = [];
  return {
    calls,
    client: {
      from(table: string) {
        const call = { table, not: [] as unknown[][] };
        calls.push(call);
        const result = rows[table] ?? { data: [] };
        const chain: Record<string, unknown> = {
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ error: null, ...result }).then(resolve),
        };
        for (const method of ['select', 'eq', 'in', 'order', 'limit']) chain[method] = () => chain;
        chain['not'] = (...args: unknown[]) => {
          call.not.push(args);
          return chain;
        };
        return chain;
      },
    },
  };
}

const check = {
  check_id: 'c1',
  document_id: 'd-checked',
  staff_id: 's1',
  status: 'queued',
  attempts: 0,
  max_attempts: 5,
  created_at: '2026-09-30T13:00:00Z',
};

describe('loadCheckMonitor', () => {
  it('lists a filed code with no check as waiting, names the person, and asks only for coded documents', async () => {
    const { client, calls } = fake({
      rtw_checks_latest_v: { data: [check] },
      compliance_docs: {
        data: [
          { id: 'd-checked', staff_id: 's1', uploaded_at: '2026-09-30T13:00:00Z' },
          { id: 'd-waiting', staff_id: 's2', uploaded_at: '2026-09-30T13:05:00Z' },
          { id: 'd-closed', staff_id: 's3', uploaded_at: '2026-09-30T13:06:00Z' },
        ],
      },
      staff: {
        data: [
          { id: 's1', first_name: 'Sam', last_name: 'B', status: 'documents', removed_at: null },
          { id: 's2', first_name: 'Ana', last_name: 'C', status: 'documents', removed_at: null },
          { id: 's3', first_name: 'Rob', last_name: 'D', status: 'rejected', removed_at: null },
        ],
      },
      job_runs: {
        data: [{ started_at: NOW, ok: true, counts: { claimed: 1, note: 'x' }, error: '' }],
      },
    });

    const monitor = await loadCheckMonitor(client, NOW);

    expect(monitor.problem).toBeNull();
    expect(monitor.checks.map((c) => c.name)).toEqual(['Sam B']);
    expect(monitor.waiting.map((w) => [w.docId, w.name])).toEqual([['d-waiting', 'Ana C']]);
    expect(monitor.lastRun).toEqual({
      startedAt: NOW,
      ok: true,
      counts: { claimed: 1 },
      error: null,
    });
    const docs = calls.find((c) => c.table === 'compliance_docs');
    expect(docs?.not).toContainEqual(['share_code', 'is', null]);
  });

  it('reports the runner as never having run when job_runs is empty', async () => {
    const { client } = fake({ rtw_checks_latest_v: { data: [] } });
    const monitor = await loadCheckMonitor(client, NOW);
    expect(monitor.lastRun).toBeNull();
    expect(monitor.checks).toEqual([]);
    expect(monitor.waiting).toEqual([]);
  });

  it('says so instead of breaking when the checks cannot be read', async () => {
    const { client } = fake({ rtw_checks_latest_v: { data: null, error: { message: 'denied' } } });
    const monitor = await loadCheckMonitor(client, NOW);
    expect(monitor.problem).toBe('denied');
    expect(monitor.checks).toEqual([]);
  });
});
