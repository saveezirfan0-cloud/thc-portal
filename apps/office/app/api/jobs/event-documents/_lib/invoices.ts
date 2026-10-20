/**
 * The invoice step of the event-documents job (ADR-0176), run after D1/D2
 * every 15 minutes, with its I/O injected so the order is testable without
 * a database, Storage or a PDF.
 *
 *   1. Finish what an earlier run issued but did not send (a failed upload,
 *      a run that died): `invoices_unfinished()` hands back a few, oldest
 *      number first, under a fresh lease, so a number is never left without
 *      its email. Each send counts its own attempt (`invoice_begin`).
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
  /** Groups whose claim raised (changed mid-claim); retried next run. */
  skipped: number;
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
    skipped: 0,
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
    let id: string | null;
    try {
      id = await deps.claim(g.group_key);
    } catch (cause) {
      // changed_while_issuing (a check-out corrected mid-claim) or a race
      // with an overlapping run: the claim rolled back, number included.
      // Skip this group; the next run looks again. Never stop the step.
      const message = (cause instanceof Error ? cause.message : String(cause)).slice(0, 300);
      counts.skipped += 1;
      deps.log(`event-documents: invoice group skipped: ${message}`);
      continue;
    }
    if (!id) continue;
    counts.issued += 1;
    work.push(id);
  }

  for (const id of work) {
    if (deps.deadline !== undefined && clock() > deps.deadline) {
      // Issued already and still leased (10 min, shorter than the 15-min
      // cadence): the next run's invoices_unfinished() picks it up. Not
      // released — a deferral is not a failed attempt.
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
