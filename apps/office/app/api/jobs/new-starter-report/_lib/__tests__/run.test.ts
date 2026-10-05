import { describe, expect, it } from 'vitest';
import { runNewStarterReport, storagePath } from '../run';
import type { NewStarterDeps, Prepared } from '../run';

const PREPARED: Prepared = {
  alreadyPrepared: false,
  periodStart: '2026-09-28',
  periodEnd: '2026-10-04',
  sendId: 41,
  status: 'preparing',
  newStarters: 2,
  queued: false,
};

const ROW = { staff_name: 'A B' } as never;

function harness(over: Partial<NewStarterDeps> = {}, prepared: Partial<Prepared> = {}) {
  const calls: string[] = [];
  const logs: string[] = [];
  const deps: NewStarterDeps = {
    due: async () => {
      calls.push('due');
      return true;
    },
    prepare: async () => {
      calls.push('prepare');
      return { ...PREPARED, ...prepared };
    },
    rows: async (id) => {
      calls.push(`rows ${id}`);
      return [ROW, ROW];
    },
    csv: (rows) => `csv(${rows.length})`,
    upload: async (path, csv) => {
      calls.push(`upload ${path} ${csv}`);
    },
    queue: async (id, path) => {
      calls.push(`queue ${id} ${path}`);
    },
    log: (line) => logs.push(line),
    ...over,
  };
  return { deps, calls, logs };
}

describe('the New Starter (HMRC) report job (ADR-0088)', () => {
  it('does nothing before Monday 09:00 UK, while switched off, or once the week is done', async () => {
    const { deps, calls } = harness({ due: async () => false });
    const counts = await runNewStarterReport(deps);
    expect(calls).toEqual([]);
    expect(counts.skipped).toBeTruthy();
  });

  it('prepares, builds the CSV from the prepared rows, uploads it, then queues the email', async () => {
    const { deps, calls } = harness();
    const counts = await runNewStarterReport(deps);
    expect(calls).toEqual([
      'due',
      'prepare',
      'rows 41',
      'upload new-starter/2026-09-28_2026-10-04.csv csv(2)',
      'queue 41 new-starter/2026-09-28_2026-10-04.csv',
    ]);
    expect(counts).toMatchObject({ queued: true, newStarters: 2, resumed: false });
  });

  it('sends nothing for a week with nobody new, and says so', async () => {
    const { deps, calls, logs } = harness({}, { status: 'no_new', newStarters: 0 });
    const counts = await runNewStarterReport(deps);
    expect(calls).toEqual(['due', 'prepare']);
    expect(counts).toMatchObject({ newStarters: 0, queued: false });
    expect(logs[0]).toContain('no new starters');
  });

  it('does not queue a week that is already queued', async () => {
    const { deps, calls } = harness({}, { alreadyPrepared: true, queued: true });
    const counts = await runNewStarterReport(deps);
    expect(calls).toEqual(['due', 'prepare']);
    expect(counts.skipped).toBe('already queued');
  });

  it('finishes a week that was prepared but not queued (a run that died between steps)', async () => {
    const { deps, calls } = harness({}, { alreadyPrepared: true, queued: false });
    const counts = await runNewStarterReport(deps);
    expect(calls).toContain('queue 41 new-starter/2026-09-28_2026-10-04.csv');
    expect(counts.resumed).toBe(true);
  });

  it('lets a failure out, so the next tick retries the same week', async () => {
    const { deps } = harness({
      upload: async () => {
        throw new Error('upload reports/new-starter/x: storage down');
      },
    });
    await expect(runNewStarterReport(deps)).rejects.toThrow('storage down');
  });

  it('keeps the file under the week it covers, in the private reports bucket layout', () => {
    expect(storagePath('2026-09-28', '2026-10-04')).toBe('new-starter/2026-09-28_2026-10-04.csv');
  });
});
