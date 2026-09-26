import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventFilterSet } from '../filters';

/**
 * The saved-view server actions (ADR-0053) against an in-memory stand-in
 * for `office_saved_views` on the manager's own session. What is pinned:
 * the table name and scope, that only the four filter keys are ever
 * written, re-saving a name updates in place, the cap is said before the
 * database has to, a refusal becomes a sentence (and read-only when it is
 * a permission refusal), and the move re-parses whatever the browser sent.
 */

type Row = {
  id: string;
  owner: string;
  scope: string;
  name: string;
  query: unknown;
  created_at: string;
};
type Failure = { code: string; message: string };

const fake = vi.hoisted(() => ({
  rows: [] as Row[],
  fail: {} as Partial<
    Record<'select' | 'insert' | 'update' | 'delete', { code: string; message: string }>
  >,
  calls: [] as { table: string; op: string; payload?: unknown; filters: [string, unknown][] }[],
  seq: 0,
}));
const configured = vi.hoisted(() => ({ value: true }));

function builder(table: string) {
  const filters: [string, unknown][] = [];
  let op = 'select';
  let payload: unknown;
  const matches = (row: Row) =>
    filters.every(([key, value]) => (row as Record<string, unknown>)[key] === value);
  const run = () => {
    fake.calls.push({ table, op, payload, filters: [...filters] });
    const failure = fake.fail[op as keyof typeof fake.fail] as Failure | undefined;
    if (failure) return { data: null, error: failure };
    if (op === 'select') {
      const data = fake.rows
        .filter(matches)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map(({ id, name, query }) => ({ id, name, query }));
      return { data, error: null };
    }
    if (op === 'insert') {
      for (const row of Array.isArray(payload) ? payload : [payload]) {
        fake.seq += 1;
        fake.rows.push({
          id: `row-${fake.seq}`,
          owner: 'me',
          created_at: `2026-09-26T10:${String(fake.seq).padStart(2, '0')}:00Z`,
          ...(row as { scope: string; name: string; query: unknown }),
        });
      }
      return { data: null, error: null };
    }
    if (op === 'update') {
      fake.rows = fake.rows.map((row) => (matches(row) ? { ...row, ...(payload as object) } : row));
      return { data: null, error: null };
    }
    fake.rows = fake.rows.filter((row) => !matches(row));
    return { data: null, error: null };
  };
  const chain = {
    select: () => chain,
    insert: (value: unknown) => ((op = 'insert'), (payload = value), chain),
    update: (value: unknown) => ((op = 'update'), (payload = value), chain),
    delete: () => ((op = 'delete'), chain),
    eq: (key: string, value: unknown) => (filters.push([key, value]), chain),
    order: () => chain,
    then: (resolve: (value: ReturnType<typeof run>) => unknown) => resolve(run()),
  };
  return chain;
}

const client = { from: vi.fn((table: string) => builder(table)) };

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('../../db', () => ({
  eventsDb: () => client,
  supabaseConfigured: () => configured.value,
}));

const { deleteMyView, listMySavedViews, moveLocalViews, saveMyView } =
  await import('../saved-views-actions');

const CLIENT = 'aaaaaaaa-0000-4000-8000-000000000001';
const ALL: EventFilterSet = { view: 'list', q: '', clientId: '', status: '' };
const CANCELLED: EventFilterSet = {
  view: 'month',
  q: 'gala',
  clientId: CLIENT,
  status: 'cancelled',
};

function seed(name: string, query: unknown = ALL) {
  fake.seq += 1;
  fake.rows.push({
    id: `row-${fake.seq}`,
    owner: 'me',
    scope: 'events',
    name,
    query,
    created_at: `2026-09-26T09:${String(fake.seq).padStart(2, '0')}:00Z`,
  });
}

beforeEach(() => {
  fake.rows = [];
  fake.fail = {};
  fake.calls = [];
  fake.seq = 0;
  configured.value = true;
  client.from.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('listMySavedViews', () => {
  it('reads office_saved_views for the events scope, oldest first', async () => {
    seed('Weddings', CANCELLED);
    seed('All');
    const result = await listMySavedViews();
    expect(result).toEqual({
      ok: true,
      views: [
        { id: 'row-1', name: 'Weddings', filters: CANCELLED },
        { id: 'row-2', name: 'All', filters: ALL },
      ],
    });
    expect(client.from).toHaveBeenCalledWith('office_saved_views');
    expect(fake.calls[0]!.filters).toEqual([['scope', 'events']]);
  });

  it('is read-only with a reason when the database refuses the read', async () => {
    fake.fail.select = { code: '42501', message: 'permission denied for table office_saved_views' };
    expect(await listMySavedViews()).toEqual({
      ok: false,
      readOnly: true,
      message: 'This login is not allowed to change saved views.',
    });
  });

  it('is read-only without a project, and never builds a client', async () => {
    configured.value = false;
    const result = await listMySavedViews();
    expect(result).toMatchObject({ ok: false, readOnly: true });
    expect(client.from).not.toHaveBeenCalled();
  });
});

describe('saveMyView', () => {
  it('inserts a new view with only the four filter keys', async () => {
    const smuggled = { ...CANCELLED, q: '  gala ', extra: '<script>' } as EventFilterSet;
    const result = await saveMyView('  Savoy   galas ', smuggled);
    expect(result).toMatchObject({ ok: true, message: 'View saved.' });
    const insert = fake.calls.find((call) => call.op === 'insert')!;
    expect(insert.payload).toEqual({
      scope: 'events',
      name: 'Savoy galas',
      query: { view: 'month', q: 'gala', clientId: CLIENT, status: 'cancelled' },
    });
    if (result.ok) expect(result.views.map((v) => v.name)).toEqual(['Savoy galas']);
  });

  it('re-saving a name, in any case, updates that view in place', async () => {
    seed('Weddings');
    const result = await saveMyView('WEDDINGS', CANCELLED);
    expect(result).toMatchObject({ ok: true, message: 'Updated “Weddings”.' });
    expect(fake.calls.some((call) => call.op === 'insert')).toBe(false);
    const update = fake.calls.find((call) => call.op === 'update')!;
    expect(update.filters).toEqual([['id', 'row-1']]);
    expect(fake.rows).toHaveLength(1);
    expect(fake.rows[0]!.name).toBe('WEDDINGS');
  });

  it('refuses a nameless view and invalid filters before touching the database', async () => {
    expect(await saveMyView('   ', ALL)).toEqual({
      ok: false,
      readOnly: false,
      message: 'Give the view a name.',
    });
    expect(await saveMyView('Bad', { ...ALL, clientId: 'not-a-uuid' })).toMatchObject({
      ok: false,
      readOnly: false,
    });
    expect(client.from).not.toHaveBeenCalled();
  });

  it('says the cap before the database has to', async () => {
    for (let i = 0; i < 30; i += 1) seed(`View ${i}`);
    expect(await saveMyView('One more', ALL)).toEqual({
      ok: false,
      readOnly: false,
      message: 'You already have 30 saved views. Delete one to save another.',
    });
    expect(fake.calls.some((call) => call.op === 'insert')).toBe(false);
    // Re-saving an existing name at the cap is still an update.
    expect(await saveMyView('View 3', CANCELLED)).toMatchObject({ ok: true });
  });

  it('a permission refusal on write turns the bar read-only; a clash does not', async () => {
    fake.fail.insert = { code: '42501', message: 'new row violates row-level security policy' };
    expect(await saveMyView('Mine', ALL)).toEqual({
      ok: false,
      readOnly: true,
      message: 'This login is not allowed to change saved views.',
    });
    fake.fail.insert = { code: '23505', message: 'duplicate key value' };
    expect(await saveMyView('Mine', ALL)).toMatchObject({ ok: false, readOnly: false });
    fake.fail.insert = { code: '23514', message: 'saved_views_cap' };
    expect(await saveMyView('Mine', ALL)).toMatchObject({
      ok: false,
      message: 'You already have 30 saved views. Delete one to save another.',
    });
  });
});

describe('deleteMyView', () => {
  it('deletes by id within the scope and returns the fresh list', async () => {
    seed('A');
    seed('B');
    const result = await deleteMyView('row-1');
    expect(result).toEqual({ ok: true, views: [{ id: 'row-2', name: 'B', filters: ALL }] });
    const del = fake.calls.find((call) => call.op === 'delete')!;
    expect(del.filters).toEqual([
      ['id', 'row-1'],
      ['scope', 'events'],
    ]);
  });

  it('refuses nonsense without a round trip', async () => {
    expect(await deleteMyView('')).toMatchObject({ ok: false });
    expect(client.from).not.toHaveBeenCalled();
  });
});

describe('moveLocalViews', () => {
  it('re-parses what the browser sent and inserts the valid ones in one statement', async () => {
    const result = await moveLocalViews([
      { name: 'Weddings', filters: CANCELLED },
      { name: 'Legacy client', filters: { view: 'list', clientId: 'c-1' } },
      { name: 'Bad view', filters: { view: 'year' } },
      'junk',
      { name: 'All', filters: { ...ALL, injected: 'x' } },
    ]);
    const inserts = fake.calls.filter((call) => call.op === 'insert');
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.payload).toEqual([
      {
        scope: 'events',
        name: 'Weddings',
        query: { view: 'month', q: 'gala', clientId: CLIENT, status: 'cancelled' },
      },
      { scope: 'events', name: 'All', query: { view: 'list', q: '', clientId: '', status: '' } },
    ]);
    expect(result).toMatchObject({
      ok: true,
      message:
        'Moved 2 saved views to your account. 1 could not be moved (a duplicate name, an invalid filter or no room).',
    });
    if (result.ok) expect(result.views.map((v) => v.name)).toEqual(['Weddings', 'All']);
  });

  it('keeps nothing half-moved: a refusal comes back as not ok', async () => {
    fake.fail.insert = { code: '42501', message: 'permission denied' };
    expect(await moveLocalViews([{ name: 'A', filters: ALL }])).toMatchObject({
      ok: false,
      readOnly: true,
    });
  });

  it('with nothing valid to move, writes nothing', async () => {
    expect(await moveLocalViews('not an array')).toMatchObject({ ok: true, views: [] });
    expect(fake.calls.some((call) => call.op === 'insert')).toBe(false);
  });
});
