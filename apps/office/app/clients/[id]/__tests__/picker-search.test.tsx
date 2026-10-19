// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { callsTo, fakePostgrest } from '../../../_lib/__tests__/fakePostgrest';
import type { RateCardRow, StaffOption } from '../types';

/**
 * "+ Add staff" on a client card (§9.7) searches the server a page at a time
 * (go-live audit M2). It used to read the whole compliant directory off
 * `staff_directory_v` — the weekly cap computed for ~1,000 workers to fill a
 * name list, and cut at 1,000 by name — with every card load and refresh.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@thc/db/server', () => ({ createClient: () => state.db }));

const { searchQualifyPicker } = await import('../actions');
const { PICKER_PAGE, pickerSearch } = await import('../card');

describe('pickerSearch', () => {
  it('reads a number, bare or as an Employee ID, as that Employee ID', () => {
    expect(pickerSearch('873')).toEqual({ words: [], employeeId: 873 });
    expect(pickerSearch(' THC-00873 ')).toEqual({ words: [], employeeId: 873 });
    expect(pickerSearch('thc00873')).toEqual({ words: [], employeeId: 873 });
  });

  it('reads anything else as words for the first or last name', () => {
    expect(pickerSearch('Amara  Kalu')).toEqual({ words: ['Amara', 'Kalu'], employeeId: null });
    expect(pickerSearch("O'Neill-Smith")).toEqual({ words: ["O'Neill-Smith"], employeeId: null });
    expect(pickerSearch('Zoë')).toEqual({ words: ['Zoë'], employeeId: null });
    expect(pickerSearch('   ')).toEqual({ words: [], employeeId: null });
  });

  it('drops what PostgREST’s filter syntax and LIKE reserve, never passes it through', () => {
    expect(pickerSearch('a,b(c)*d.e:f%')).toEqual({ words: ['abcdef'], employeeId: null });
    expect(pickerSearch('first_name.eq.x),or(')).toEqual({
      words: ['firstnameeqxor'],
      employeeId: null,
    });
  });
});

describe('searchQualifyPicker', () => {
  const STAFF = Array.from({ length: 120 }, (_, n) => ({
    id: `w-${String(n).padStart(3, '0')}`,
    first_name: n === 87 ? 'Amara' : 'Worker',
    last_name: n === 87 ? 'Kalu' : String(n),
    employee_id: n,
  }));

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  });

  function db() {
    return fakePostgrest({
      staff: STAFF,
      staff_roles: [
        { staff_id: 'w-000', role_id: 'r-bar' },
        { staff_id: 'w-000', role_id: 'r-wait' },
      ],
      roles: [
        { id: 'r-bar', name: 'Bar Staff' },
        { id: 'r-wait', name: 'Waiting Staff' },
      ],
    });
  }

  it('reads one page of compliant, live workers off staff — never the directory view', async () => {
    const fake = db();
    state.db = fake;
    const page = await searchQualifyPicker('', 0);
    expect(page).toMatchObject({ ok: true, total: 120 });
    if (!page.ok) return;
    expect(page.workers).toHaveLength(PICKER_PAGE);
    expect(page.workers[0]).toEqual({
      id: 'w-000',
      display_name: 'Worker 0',
      employee_id: 0,
      role_names: ['Bar Staff', 'Waiting Staff'],
    });
    expect(callsTo(fake.calls, 'staff_directory_v')).toEqual([]);
    const [read] = callsTo(fake.calls, 'staff');
    expect(read!.count).toBe('exact');
    expect(read!.range).toEqual([0, PICKER_PAGE - 1]);
    expect(read!.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'status', 'compliant'],
        ['is', 'removed_at', null],
      ]),
    );
    expect(read!.orders.map(([column]) => column)).toEqual(['first_name', 'last_name', 'id']);
    // The roles are read for this page's workers only.
    const [held] = callsTo(fake.calls, 'staff_roles');
    expect((held!.filters[0]![2] as string[]).length).toBe(PICKER_PAGE);
  });

  it('asks for every word in the first or last name, or for the Employee ID', async () => {
    const fake = db();
    state.db = fake;
    await searchQualifyPicker('amara kalu', 0);
    await searchQualifyPicker('THC-00087', 50);
    const [byName, byId] = callsTo(fake.calls, 'staff');
    expect(byName!.filters.filter(([op]) => op === 'or')).toEqual([
      ['or', 'first_name.ilike.*amara*,last_name.ilike.*amara*'],
      ['or', 'first_name.ilike.*kalu*,last_name.ilike.*kalu*'],
    ]);
    expect(byId!.filters).toContainEqual(['eq', 'employee_id', 87]);
    expect(byId!.range).toEqual([50, 50 + PICKER_PAGE - 1]);
  });

  it('a failed read is a sentence, not an empty list', async () => {
    state.db = fakePostgrest({}, { errors: { staff: { code: '57014', message: 'timeout' } } });
    const page = await searchQualifyPicker('a', 0);
    expect(page.ok).toBe(false);
  });
});

describe('the picker dialog', () => {
  const search = vi.fn<(q: string, offset: number) => Promise<unknown>>();
  let root: Root | null = null;
  let host: HTMLDivElement;

  beforeAll(() => {
    vi.doMock('../actions', () => ({
      qualifyStaff: vi.fn(async () => ({ ok: true })),
      searchQualifyPicker: search,
      revokeQualification: vi.fn(),
      setDoNotReturn: vi.fn(),
    }));
  });

  beforeEach(() => {
    vi.useFakeTimers();
    search.mockReset();
    host = document.createElement('div');
    document.body.append(host);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    host.remove();
    vi.useRealTimers();
  });

  const worker = (id: string, name: string, roles = ['Waiting Staff']): StaffOption => ({
    id,
    display_name: name,
    employee_id: Number(id.slice(2)),
    role_names: roles,
  });
  const RATE_CARD = [{ role_id: 'r-wait', role_name: 'Waiting Staff' }] as RateCardRow[];

  async function open() {
    vi.resetModules();
    const { QualifiedStaff } = await import('../QualifiedStaff');
    root = createRoot(host);
    await act(async () => {
      root!.render(<QualifiedStaff clientId="c-1" rows={[]} rateCard={RATE_CARD} />);
    });
    const add = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('+ Add staff'),
    )!;
    await act(async () => add.click());
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
  }

  const type = async (text: string) => {
    const box = document.querySelector<HTMLInputElement>(
      'input[aria-label="Search workers by name or Employee ID"]',
    )!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(box, text);
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  it('asks the server when opened, then once per pause in typing', async () => {
    search.mockResolvedValue({ ok: true, workers: [worker('w-1', 'Worker One')], total: 1 });
    await open();
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenLastCalledWith('', 0);
    expect(document.body.textContent).toContain('Worker One');
    expect(document.body.textContent).toContain('Showing 1 of 1');

    await type('a');
    await type('am');
    await type('amara');
    expect(search).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(search).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenLastCalledWith('amara', 0);
  });

  it('keeps a tick across searches and pages on with “Show more”', async () => {
    search.mockResolvedValueOnce({
      ok: true,
      workers: [worker('w-1', 'Worker One')],
      total: 51,
    });
    await open();
    const tick = document.querySelector<HTMLInputElement>('ul.picker input[type="checkbox"]')!;
    await act(async () => tick.click());
    expect(document.body.textContent).toContain('1 selected');

    search.mockResolvedValueOnce({ ok: true, workers: [worker('w-2', 'Worker Two')], total: 51 });
    const more = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.startsWith('Show '),
    )!;
    expect(more.textContent).toBe('Show 50 more');
    await act(async () => more.click());
    expect(search).toHaveBeenLastCalledWith('', 1);
    expect(document.body.textContent).toContain('Worker One');
    expect(document.body.textContent).toContain('Worker Two');

    search.mockResolvedValueOnce({ ok: true, workers: [], total: 0 });
    await type('zzz');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(document.body.textContent).toContain('No compliant worker matches “zzz”.');
    // Worker One is still ticked although the list no longer shows them.
    expect(document.body.textContent).toContain('1 selected');
  });

  it('an older answer never overwrites a newer one', async () => {
    let slow: (value: unknown) => void = () => {};
    search
      .mockResolvedValueOnce({ ok: true, workers: [], total: 0 })
      .mockImplementationOnce(() => new Promise((resolve) => (slow = resolve)))
      .mockResolvedValueOnce({ ok: true, workers: [worker('w-9', 'Newest Answer')], total: 1 });
    await open();
    await type('old');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await type('new');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await act(async () => slow({ ok: true, workers: [worker('w-8', 'Stale Answer')], total: 1 }));
    expect(document.body.textContent).toContain('Newest Answer');
    expect(document.body.textContent).not.toContain('Stale Answer');
  });
});
