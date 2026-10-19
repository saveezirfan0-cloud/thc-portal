/**
 * A stand-in for supabase-js that behaves like PostgREST where it matters
 * for paging: every reply — table, view or RPC — is cut at `max_rows`
 * (1000) without an error, `.range(from, to)` is honoured, and the exact
 * count comes back only when it is asked for. A loader that reads in one
 * request is therefore short here exactly as it would be in production.
 *
 * Not a test file (no `.test.`): the paged-read tests import it.
 */

export const MAX_ROWS = 1000;

export interface FakeCall {
  kind: 'from' | 'rpc';
  name: string;
  args?: unknown;
  select?: string;
  count?: string;
  filters: [string, ...unknown[]][];
  orders: [string, unknown?][];
  range: [number, number] | null;
}

type Source = readonly unknown[] | ((call: FakeCall) => readonly unknown[]);

export interface FakeQuery extends PromiseLike<{
  data: unknown[] | null;
  error: { code?: string; message: string } | null;
  count: number | null;
}> {
  select(columns?: string, options?: { count?: string }): FakeQuery;
  order(column: string, options?: unknown): FakeQuery;
  range(from: number, to: number): FakeQuery;
  limit(n: number): FakeQuery;
  returns(): FakeQuery;
  maybeSingle(): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  eq(...args: unknown[]): FakeQuery;
  neq(...args: unknown[]): FakeQuery;
  in(...args: unknown[]): FakeQuery;
  is(...args: unknown[]): FakeQuery;
  or(...args: unknown[]): FakeQuery;
  gte(...args: unknown[]): FakeQuery;
  lte(...args: unknown[]): FakeQuery;
  not(...args: unknown[]): FakeQuery;
}

const FILTERS = ['eq', 'neq', 'in', 'is', 'or', 'gte', 'lte', 'not'] as const;

export function fakePostgrest(
  sources: Record<string, Source>,
  {
    maxRows = MAX_ROWS,
    errors = {},
  }: { maxRows?: number; errors?: Record<string, { code?: string; message: string }> } = {},
) {
  const calls: FakeCall[] = [];

  function reply(call: FakeCall) {
    calls.push(call);
    const error = errors[call.name];
    if (error) return { data: null, error, count: null };
    const source = sources[call.name] ?? [];
    const all = typeof source === 'function' ? source(call) : source;
    const [from, to] = call.range ?? [0, Number.POSITIVE_INFINITY];
    const end = Math.min(to + 1, from + maxRows);
    return {
      data: all.slice(from, end) as unknown[],
      error: null,
      count: call.count === 'exact' ? all.length : null,
    };
  }

  function query(call: FakeCall): FakeQuery {
    const q = {
      select(columns?: string, options?: { count?: string }) {
        call.select = columns;
        if (options?.count) call.count = options.count;
        return q;
      },
      order(column: string, options?: unknown) {
        call.orders.push([column, options]);
        return q;
      },
      range(from: number, to: number) {
        call.range = [from, to];
        return q;
      },
      limit(n: number) {
        call.range = [0, n - 1];
        return q;
      },
      returns() {
        return q;
      },
      maybeSingle() {
        const { data, error } = reply(call);
        return Promise.resolve({ data: data?.[0] ?? null, error });
      },
      then<A = never, B = never>(
        onFulfilled?: ((value: ReturnType<typeof reply>) => A | PromiseLike<A>) | null,
        onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
      ) {
        return Promise.resolve(reply(call)).then(onFulfilled, onRejected);
      },
    } as unknown as FakeQuery;
    for (const name of FILTERS) {
      (q as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
        call.filters.push([name, ...args]);
        return q;
      };
    }
    return q;
  }

  return {
    calls,
    from(name: string) {
      return query({ kind: 'from', name, filters: [], orders: [], range: null });
    },
    rpc(name: string, args?: unknown, options?: { count?: string }) {
      return query({
        kind: 'rpc',
        name,
        args,
        count: options?.count,
        filters: [],
        orders: [],
        range: null,
      });
    },
    storage: {
      from: () => ({
        createSignedUrls: async (paths: string[]) => ({
          data: paths.map((path) => ({ path, signedUrl: `https://signed/${path}`, error: null })),
          error: null,
        }),
      }),
    },
  };
}

/** The calls made to one source, in order. */
export function callsTo(calls: readonly FakeCall[], name: string): FakeCall[] {
  return calls.filter((call) => call.name === name);
}
