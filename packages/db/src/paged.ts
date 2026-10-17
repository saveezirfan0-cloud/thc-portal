/**
 * Every row of a read, page by page (go-live audit 17.10.2026, B1–B3).
 *
 * PostgREST answers at most `max_rows` rows per request — 1000 in
 * `supabase/config.toml` and on the hosted project — and it applies that to
 * tables, views AND set-returning functions, for every role, service_role
 * included. Past it the reply is simply shorter: no error, no warning. A
 * payroll CSV read in one request therefore stops at line 1,000, and the
 * workers whose surnames come last are not paid (RULE-14: payroll exports
 * are never corrected retroactively).
 *
 * `readAllPages` asks for `[from, from + pageSize - 1]` until a page comes
 * back short, and refuses — never truncates — when:
 *
 *   · the rows pass `ceiling` (the read is too big to hold; narrow it);
 *   · the server's exact count (asked for on the first page, when the
 *     caller passes `first` on to `count: 'exact'`) or the caller's own
 *     `expected` count differs from what arrived — the data moved between
 *     pages, or the server's page is smaller than ours;
 *   · a `key` is seen twice — the order shifted under the paging.
 *
 * The caller supplies a TOTAL order (or reads a function whose ORDER BY is
 * one): paging an order with ties can skip a row at a page boundary.
 *
 * Pure and import-free, so the Edge Functions import it by relative path
 * (`../../../packages/db/src/paged.ts`, as they do service-caller.ts —
 * ADR-0006) and vitest holds it (`__tests__/paged.test.ts`).
 */

/** PostgREST's `max_rows` here and on the hosted project. A page never asks for more. */
export const PAGE_ROWS = 1000;

/** Where a read stops being a screen or a file and becomes a mistake. */
export const DEFAULT_ROW_CEILING = 50_000;

/** The read passed its ceiling. */
export const ROWS_OVER_CEILING = 'THC_ROWS_OVER_CEILING';
/** Fewer (or more) rows arrived than the count said, or one arrived twice. */
export const ROWS_MOVED = 'THC_ROWS_MOVED';

export interface PageError {
  code?: string | null;
  message: string;
  details?: string | null;
}

/** What supabase-js resolves a query to — only the parts read here. */
export interface PageReply<T> {
  data: T[] | null;
  error: PageError | null;
  count?: number | null;
}

export interface PageRange {
  from: number;
  /** Inclusive, as `.range(from, to)` takes it. */
  to: number;
  /** The first request: the one to ask `count: 'exact'` on, if the caller wants the check. */
  first: boolean;
}

export interface ReadAllOptions<T> {
  /** For the refusal sentence: "payroll lines", "staff". */
  what?: string;
  pageSize?: number;
  ceiling?: number;
  /** A count known before the read (e.g. prepare_finance_reports().rows). */
  expected?: number | null;
  /** A row's identity; the same key twice refuses the read. */
  key?: (row: T) => string;
}

export type ReadAllResult<T> = { data: T[]; error: null } | { data: null; error: PageError };

function thousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function overCeiling(what: string, ceiling: number): PageError {
  return {
    code: ROWS_OVER_CEILING,
    message: `There are more than ${thousands(ceiling)} ${what} to read at once. Narrow the dates or the filters and try again.`,
  };
}

function moved(what: string, got: number, want: number | null): PageError {
  return {
    code: ROWS_MOVED,
    message:
      want === null
        ? `The ${what} changed while they were being read. Rather than use a list with gaps, nothing was used. Try again in a minute.`
        : `Only ${thousands(got)} of ${thousands(want)} ${what} came back. Rather than use an incomplete list, nothing was used. Try again in a minute.`,
  };
}

export async function readAllPages<T>(
  fetchPage: (range: PageRange) => PromiseLike<PageReply<T>>,
  options: ReadAllOptions<T> = {},
): Promise<ReadAllResult<T>> {
  const what = options.what ?? 'rows';
  const size = Math.max(1, Math.min(options.pageSize ?? PAGE_ROWS, PAGE_ROWS));
  const ceiling = options.ceiling ?? DEFAULT_ROW_CEILING;
  const expected = options.expected ?? null;
  const rows: T[] = [];
  const seen = new Set<string>();
  let counted: number | null = null;

  for (let from = 0; ; from += size) {
    const reply = await fetchPage({ from, to: from + size - 1, first: from === 0 });
    if (reply.error) return { data: null, error: reply.error };
    if (from === 0 && typeof reply.count === 'number') {
      counted = reply.count;
      if (counted > ceiling) return { data: null, error: overCeiling(what, ceiling) };
    }
    const page = reply.data ?? [];
    for (const row of page) {
      if (options.key) {
        const id = options.key(row);
        if (seen.has(id)) return { data: null, error: moved(what, rows.length, null) };
        seen.add(id);
      }
      rows.push(row);
    }
    if (rows.length > ceiling) return { data: null, error: overCeiling(what, ceiling) };
    if (page.length < size) break;
    // The count is in: a last full page needs no empty one after it.
    if (counted !== null && rows.length >= counted) break;
  }

  if (counted !== null && rows.length !== counted) {
    return { data: null, error: moved(what, rows.length, counted) };
  }
  if (expected !== null && rows.length !== expected) {
    return { data: null, error: moved(what, rows.length, expected) };
  }
  return { data: rows, error: null };
}
