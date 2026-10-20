/**
 * The invoice step of the event-documents job (ADR-0175), run after D1/D2
 * every 15 minutes, with its I/O injected so the order is testable without
 * a database, Storage or a PDF.
 *
 *   1. Finish what an earlier run issued but did not send (a failed upload,
 *      a run that died): `invoices_unfinished()` hands those back under a
 *      fresh lease, so a number is never left without its email.
 *   2. Issue every group `invoice_groups_due()` calls `due` — one invoice
 *      per PO (or per event without one) at 10:00 UK the morning after the
 *      last event — through `invoice_claim()`, which re-checks under a lock
 *      and takes the next number.
 *   3. For each: draw the invoice PDF and each event's completed timesheet,
 *      store them, record them, queue INV1. On any failure, release the
 *      invoice for the next run.
 *
 * Log lines carry invoice ids and numbers and reasons — never a name, an
 * address or an amount.
 */

export interface InvoiceRunDeps {
  now: Date;
  unfinished(): Promise<string[]>;
  groups(): Promise<{ group_key: string; verdict: string }[]>;
  claim(groupKey: string): Promise<string | null>;
  /** Draw, store, record and queue one invoice; throws on any failure. */
  send(invoiceId: string): Promise<{ number: number; queued: boolean }>;
  release(invoiceId: string, error: string): Promise<void>;
  deadline?: number;
  clock?: () => number;
  log(line: string): void;
}

export interface InvoiceRunCounts {
  verdicts: Record<string, number>;
  retried: number;
  issued: number;
  sent: number;
  failed: number;
  deferred: number;
}

export async function runInvoices(deps: InvoiceRunDeps): Promise<InvoiceRunCounts> {
  const clock = deps.clock ?? Date.now;
  const counts: InvoiceRunCounts = {
    verdicts: {},
    retried: 0,
    issued: 0,
    sent: 0,
    failed: 0,
    deferred: 0,
  };

  const work: string[] = [];
  for (const id of await deps.unfinished()) {
    counts.retried += 1;
    work.push(id);
  }

  for (const g of await deps.groups()) {
    counts.verdicts[g.verdict] = (counts.verdicts[g.verdict] ?? 0) + 1;
    if (g.verdict !== 'due') continue;
    if (deps.deadline !== undefined && clock() > deps.deadline) {
      counts.deferred += 1;
      continue;
    }
    const id = await deps.claim(g.group_key);
    if (!id) continue;
    counts.issued += 1;
    work.push(id);
  }

  for (const id of work) {
    if (deps.deadline !== undefined && clock() > deps.deadline) {
      // Issued already: the next run's invoices_unfinished() picks it up.
      await deps.release(id, 'deferred: out of time this run').catch(() => undefined);
      counts.deferred += 1;
      continue;
    }
    try {
      const { number, queued } = await deps.send(id);
      counts.sent += 1;
      deps.log(`event-documents: invoice ${number} ${queued ? 'queued' : 'already queued'}`);
    } catch (cause) {
      const message = (cause instanceof Error ? cause.message : String(cause)).slice(0, 300);
      counts.failed += 1;
      deps.log(`event-documents: invoice ${id} failed: ${message}`);
      await deps.release(id, message).catch(() => undefined);
    }
  }
  return counts;
}
