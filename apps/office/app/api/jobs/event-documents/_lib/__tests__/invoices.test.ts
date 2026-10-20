import { describe, expect, it, vi } from 'vitest';
import { runInvoices } from '../invoices';
import type { InvoiceRunDeps } from '../invoices';

/** ADR-0176: the invoice step of the event-documents job, its I/O faked. */
function deps(over: Partial<InvoiceRunDeps> = {}): InvoiceRunDeps & { lines: string[] } {
  const lines: string[] = [];
  return {
    now: new Date('2026-10-27T10:00:00Z'),
    unfinished: async () => [],
    groups: async () => [],
    claim: async (key) => `inv-${key}`,
    send: async (id) => ({ number: id === 'inv-b' ? 4001 : 4000, queued: true }),
    release: vi.fn(async () => undefined),
    log: (line) => lines.push(line),
    lines,
    ...over,
  };
}

describe('the invoice step (ADR-0176)', () => {
  it('issues and sends every due group, and only due ones', async () => {
    const claim = vi.fn(async (key: string) => `inv-${key}`);
    const send = vi.fn(async () => ({ number: 4000, queued: true }));
    const counts = await runInvoices(
      deps({
        groups: async () => [
          { group_key: 'a', verdict: 'due' },
          { group_key: 'b', verdict: 'scheduled' },
          { group_key: 'c', verdict: 'review' },
        ],
        claim,
        send,
      }),
    );
    expect(claim).toHaveBeenCalledTimes(1);
    expect(claim).toHaveBeenCalledWith('a');
    expect(send).toHaveBeenCalledWith('inv-a');
    expect(counts).toMatchObject({ issued: 1, sent: 1, failed: 0 });
    expect(counts.verdicts).toEqual({ due: 1, scheduled: 1, review: 1 });
  });

  it('finishes what an earlier run issued before issuing anything new', async () => {
    const order: string[] = [];
    await runInvoices(
      deps({
        unfinished: async () => ['old'],
        groups: async () => [{ group_key: 'a', verdict: 'due' }],
        send: async (id) => {
          order.push(id);
          return { number: 1, queued: true };
        },
      }),
    );
    expect(order).toEqual(['old', 'inv-a']);
  });

  it('a group another run took is not counted as issued', async () => {
    const counts = await runInvoices(
      deps({ groups: async () => [{ group_key: 'a', verdict: 'due' }], claim: async () => null }),
    );
    expect(counts).toMatchObject({ issued: 0, sent: 0 });
  });

  it('a claim that raises (changed mid-claim) skips that group and carries on', async () => {
    const send = vi.fn(async () => ({ number: 4001, queued: true }));
    const d = deps({
      groups: async () => [
        { group_key: 'a', verdict: 'due' },
        { group_key: 'b', verdict: 'due' },
      ],
      claim: async (key) => {
        if (key === 'a') throw new Error('invoice_claim: changed_while_issuing');
        return `inv-${key}`;
      },
      send,
    });
    const counts = await runInvoices(d);
    expect(counts).toMatchObject({ skipped: 1, issued: 1, sent: 1 });
    expect(send).toHaveBeenCalledWith('inv-b');
    expect(d.lines.join('\n')).toMatch(/group skipped: invoice_claim: changed_while_issuing/);
  });

  it('releases an invoice whose send failed, and carries on', async () => {
    const release = vi.fn(async () => undefined);
    const d = deps({
      groups: async () => [
        { group_key: 'a', verdict: 'due' },
        { group_key: 'b', verdict: 'due' },
      ],
      send: async (id) => {
        if (id === 'inv-a') throw new Error('Storage refused');
        return { number: 4001, queued: true };
      },
      release,
    });
    const counts = await runInvoices(d);
    expect(release).toHaveBeenCalledWith('inv-a', 'Storage refused');
    expect(counts).toMatchObject({ issued: 2, sent: 1, failed: 1 });
    // Ids and numbers only in the log — never a name or an amount.
    expect(d.lines.join('\n')).toMatch(/invoice inv-a failed: Storage refused/);
    expect(d.lines.join('\n')).toMatch(/invoice 4001 queued/);
  });

  it('out of time, issues nothing new and hands issued invoices to the next run', async () => {
    const release = vi.fn(async () => undefined);
    let t = 0;
    const counts = await runInvoices(
      deps({
        unfinished: async () => ['old'],
        groups: async () => [{ group_key: 'a', verdict: 'due' }],
        deadline: 10,
        clock: () => (t += 20),
        release,
      }),
    );
    expect(counts).toMatchObject({ issued: 0, sent: 0, deferred: 2 });
    // A deferral is not a failure: the lease runs out and the next run takes it.
    expect(release).not.toHaveBeenCalled();
  });
});
