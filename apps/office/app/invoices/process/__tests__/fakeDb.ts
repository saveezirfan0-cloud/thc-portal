/* eslint-disable @typescript-eslint/no-explicit-any -- a fake of the untyped client */
import { vi } from 'vitest';

export interface Call {
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete';
  filters: [string, string, unknown][];
  values?: any;
  columns?: string;
}
export interface Reply {
  data?: any;
  error?: { code?: string; message: string; details?: string | null } | null;
}

/**
 * A chainable stand-in for the supabase-js query builder. Every query ends
 * in one `Call`; `script` answers it. Calls are kept in `calls` so a test
 * can say what was written, and with which filters.
 */
export function fakeDb(
  script: (call: Call) => Reply | undefined,
  rpcScript: (fn: string, args: any) => Reply | undefined = () => ({ data: null, error: null }),
) {
  const calls: Call[] = [];
  const rpcCalls: { fn: string; args: any }[] = [];

  function from(table: string) {
    const call: Call = { table, op: 'select', filters: [] };
    const finish = () => {
      calls.push(call);
      const r = script(call) ?? { data: [], error: null };
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
    };
    const builder: any = {
      select(columns?: string) {
        call.columns = columns;
        return builder;
      },
      insert(values: any) {
        call.op = 'insert';
        call.values = values;
        return builder;
      },
      update(values: any) {
        call.op = 'update';
        call.values = values;
        return builder;
      },
      delete() {
        call.op = 'delete';
        return builder;
      },
      eq: (c: string, v: unknown) => (call.filters.push([c, 'eq', v]), builder),
      neq: (c: string, v: unknown) => (call.filters.push([c, 'neq', v]), builder),
      is: (c: string, v: unknown) => (call.filters.push([c, 'is', v]), builder),
      in: (c: string, v: unknown) => (call.filters.push([c, 'in', v]), builder),
      not: (c: string, o: string, v: unknown) => (call.filters.push([c, `not.${o}`, v]), builder),
      order: () => builder,
      range: (from: number, to: number) => (
        call.filters.push(['range', 'range', [from, to]]),
        builder
      ),
      limit: () => builder,
      maybeSingle() {
        return finish().then((r: any) => ({
          ...r,
          data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data,
        }));
      },
      then(resolve: any, reject: any) {
        return finish().then(resolve, reject);
      },
    };
    return builder;
  }

  const db = {
    from,
    rpc: vi.fn((fn: string, args: any) => {
      rpcCalls.push({ fn, args });
      const r = rpcScript(fn, args) ?? { data: null, error: null };
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
    }),
  };
  return { db, calls, rpcCalls };
}

/** A database row for timesheet_shifts, with sensible defaults. */
export function shiftRow(over: Record<string, unknown> = {}) {
  return {
    id: 's1',
    file_id: 'f1',
    sort: 1,
    kind: 'shift',
    status: 'extracted',
    staff_name: 'Ana Smith',
    staff_ref: '1042',
    work_date: '2026-10-19',
    role_name: 'Waiting',
    start_time: '10:00:00',
    end_time: '18:00:00',
    break_min: 30,
    hours: 7.5,
    staff_count: 1,
    quantity: null,
    description: null,
    rate: 18.98,
    amount: 142.35,
    issues: [],
    confidence: null,
    source: null,
    invoice_id: null,
    ...over,
  };
}
