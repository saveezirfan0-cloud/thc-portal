import { describe, expect, it, vi } from 'vitest';
import {
  PAGE_ROWS,
  ROWS_MOVED,
  ROWS_OVER_CEILING,
  readAllPages,
  type PageRange,
  type PageReply,
} from '../paged';

/**
 * PostgREST cuts every reply at max_rows (1000) without an error. These hold
 * the one loop that reads past it, and its refusals: a read is complete or it
 * is an error — never quietly short (go-live audit 17.10.2026, B1).
 */

interface Row {
  id: string;
  n: number;
}

const rows = (count: number): Row[] =>
  Array.from({ length: count }, (_, n) => ({ id: `r${n}`, n }));

/** A server that honours `.range()` but never returns more than `maxRows`. */
function server(all: Row[], { maxRows = PAGE_ROWS, withCount = false } = {}) {
  return vi.fn(async ({ from, to, first }: PageRange): Promise<PageReply<Row>> => {
    const end = Math.min(to + 1, from + maxRows);
    return {
      data: all.slice(from, end),
      error: null,
      count: withCount && first ? all.length : null,
    };
  });
}

describe('readAllPages', () => {
  it('reads 2,345 rows across three pages, in order, none lost', async () => {
    const all = rows(2345);
    const fetchPage = server(all);
    const result = await readAllPages(fetchPage);
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(2345);
    expect(result.data?.map((r) => r.n)).toEqual(all.map((r) => r.n));
    expect(fetchPage.mock.calls.map(([r]) => [r.from, r.to])).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('asks for one more page after an exactly full one, and stops on the empty reply', async () => {
    const fetchPage = server(rows(2000));
    const result = await readAllPages(fetchPage);
    expect(result.data).toHaveLength(2000);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('with the exact count, a last full page needs no empty one after it', async () => {
    const fetchPage = server(rows(2000), { withCount: true });
    const result = await readAllPages(fetchPage);
    expect(result.data).toHaveLength(2000);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage.mock.calls[0]![0].first).toBe(true);
    expect(fetchPage.mock.calls[1]![0].first).toBe(false);
  });

  it('an empty read is an empty list, not an error', async () => {
    const result = await readAllPages(server([]));
    expect(result).toEqual({ data: [], error: null });
  });

  it('refuses when the server pages smaller than we ask and its count says so', async () => {
    // A project whose max_rows was lowered to 500: the first page looks
    // "short", and only the count reveals the other 1,500.
    const result = await readAllPages(server(rows(2000), { maxRows: 500, withCount: true }), {
      what: 'payroll lines',
    });
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe(ROWS_MOVED);
    expect(result.error?.message).toBe(
      'Only 500 of 2,000 payroll lines came back. Rather than use an incomplete list, nothing was used. Try again in a minute.',
    );
  });

  it('refuses when a known count differs from what arrived', async () => {
    const result = await readAllPages(server(rows(1500)), { expected: 1501, what: 'lines' });
    expect(result.error?.code).toBe(ROWS_MOVED);
    expect(result.data).toBeNull();
  });

  it('accepts a known count that matches', async () => {
    const result = await readAllPages(server(rows(1500)), { expected: 1500 });
    expect(result.data).toHaveLength(1500);
  });

  it('refuses when a row arrives twice (the order moved under the paging)', async () => {
    const all = rows(1500);
    const fetchPage = vi.fn(async ({ from, to }: PageRange): Promise<PageReply<Row>> => {
      // The second page starts one row early: a row was inserted ahead.
      const start = from === 0 ? 0 : from - 1;
      return { data: all.slice(start, Math.min(to + 1, start + PAGE_ROWS)), error: null };
    });
    const result = await readAllPages(fetchPage, { key: (r) => r.id });
    expect(result.error?.code).toBe(ROWS_MOVED);
  });

  it('errors past the ceiling instead of truncating', async () => {
    const fetchPage = server(rows(3500));
    const result = await readAllPages(fetchPage, { ceiling: 2500, what: 'staff' });
    expect(result.data).toBeNull();
    expect(result.error).toEqual({
      code: ROWS_OVER_CEILING,
      message:
        'There are more than 2,500 staff to read at once. Narrow the dates or the filters and try again.',
    });
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('a count over the ceiling stops after the first request', async () => {
    const fetchPage = server(rows(3500), { withCount: true });
    const result = await readAllPages(fetchPage, { ceiling: 2500 });
    expect(result.error?.code).toBe(ROWS_OVER_CEILING);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('passes a page error through untouched, and reads nothing after it', async () => {
    let calls = 0;
    const result = await readAllPages<Row>(async ({ from }) => {
      calls += 1;
      return from === 0
        ? { data: rows(1000), error: null }
        : {
            data: null,
            error: { code: '57014', message: 'canceling statement due to statement timeout' },
          };
    });
    expect(result).toEqual({
      data: null,
      error: { code: '57014', message: 'canceling statement due to statement timeout' },
    });
    expect(calls).toBe(2);
  });

  it('never asks for more than max_rows in one page', async () => {
    const fetchPage = server(rows(10));
    await readAllPages(fetchPage, { pageSize: 5000 });
    expect(fetchPage.mock.calls[0]![0]).toEqual({ from: 0, to: 999, first: true });
  });
});
