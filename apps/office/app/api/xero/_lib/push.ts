import { createHash } from 'node:crypto';
import { XeroError } from './client';
import type { XeroClient, XeroInvoiceResult } from './client';
import { idempotencyKey, mapInvoice } from './map';
import type { DocData } from './map';
import type { XeroSettings } from './settings';

/**
 * The Xero push (ADR-0210 §6, ADR-0211): claim a batch, push each invoice,
 * attach its PDF, and record the result. Every database step is injected, so
 * the tests run it with a scripted Xero and an in-memory ledger.
 *
 * Idempotent three ways: xero_claim_batch leases a row for ten minutes; the
 * Idempotency-Key makes a retry of a lost response return the first answer;
 * and an invoice Xero already holds under our number (or the id we recorded)
 * is adopted, never created twice.
 */

export interface InvoiceSource {
  doc: DocData;
  clientId: string;
  xeroContactId: string | null;
  storagePath: string | null;
  fileName: string | null;
  /** From an earlier attempt that created the invoice but failed to attach. */
  xeroInvoiceId: string | null;
}

export interface PushDeps {
  client: XeroClient;
  settings: XeroSettings;
  now: () => Date;
  /** Stop starting new invoices after this (ms epoch). */
  deadline: number;
  claim(limit: number): Promise<string[]>;
  load(invoiceId: string): Promise<InvoiceSource>;
  saveContact(clientId: string, contactId: string): Promise<void>;
  pdf(storagePath: string): Promise<Uint8Array | null>;
  record(
    invoiceId: string,
    ok: boolean,
    xeroInvoiceId: string | null,
    xeroStatus: string | null,
    xeroTotal: number | null,
    error: string | null,
  ): Promise<void>;
  log(line: string): void;
  batch?: number;
}

export interface PushCounts {
  claimed: number;
  synced: number;
  mismatch: number;
  failed: number;
  adopted: number;
  /** Set when the run stopped early, e.g. 'rate_limit' or 'auth'. */
  stopped?: string;
}

const MAX_PDF_BYTES = 9_500_000; // Xero allows 10 MB per attachment

export async function pushBatch(deps: PushDeps): Promise<PushCounts> {
  const counts: PushCounts = { claimed: 0, synced: 0, mismatch: 0, failed: 0, adopted: 0 };
  const ids = await deps.claim(deps.batch ?? 10);
  counts.claimed = ids.length;

  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i]!;
    if (counts.stopped || deps.now().getTime() > deps.deadline) {
      const reason = counts.stopped ?? 'out_of_time';
      // Not started: hand it back as failed so the next run claims it.
      await deps.record(id, false, null, null, null, stoppedMessage(reason));
      counts.failed += 1;
      continue;
    }
    const progress: { xeroId: string | null } = { xeroId: null };
    try {
      const result = await pushOne(deps, id, progress);
      if (result.adopted) counts.adopted += 1;
      if (result.mismatch) counts.mismatch += 1;
      else counts.synced += 1;
    } catch (cause) {
      const error = cause instanceof XeroError ? cause : null;
      const message = error ? error.message : 'Unexpected error while sending to Xero.';
      if (
        error &&
        (error.kind === 'rate_limit' || error.kind === 'auth' || error.kind === 'not_connected')
      ) {
        counts.stopped = error.kind === 'rate_limit' ? 'rate_limit' : 'auth';
      }
      // Kind and a short text only: never a token, an address or a line.
      deps.log(`xero-sync: invoice ${id} ${error?.kind ?? 'error'}`);
      await deps.record(id, false, progress.xeroId, null, null, message);
      counts.failed += 1;
    }
  }
  return counts;
}

function stoppedMessage(reason: string): string {
  return reason === 'rate_limit'
    ? 'Xero rate limit reached; will retry on the next run.'
    : reason === 'auth'
      ? 'Xero sign-in problem; reconnect Xero in Settings.'
      : 'Not reached in this run; will retry.';
}

async function pushOne(
  deps: PushDeps,
  invoiceId: string,
  /** Filled in as soon as Xero holds the invoice, so a later failure keeps its id. */
  progress: { xeroId: string | null },
): Promise<{ adopted: boolean; mismatch: boolean }> {
  const { client, settings } = deps;
  const src = await deps.load(invoiceId);
  const number = String(src.doc.number);

  // 1 · The invoice may already be in Xero (an earlier attempt, a lost reply).
  let xero: XeroInvoiceResult | null = null;
  let adopted = false;
  if (src.xeroInvoiceId) {
    xero = await client.invoiceById(src.xeroInvoiceId);
    adopted = xero !== null;
  }

  // 2 · Otherwise the contact, then the invoice.
  if (!xero) {
    const contactId = await ensureContact(deps, src);
    const payload = mapInvoice(src.doc, contactId, settings);
    const digest = createHash('sha1').update(JSON.stringify(payload)).digest('hex').slice(0, 12);
    try {
      xero = await client.createInvoice(payload, idempotencyKey(src.doc.number, digest));
    } catch (e) {
      // Xero refuses a duplicate InvoiceNumber: if it holds ours, adopt it.
      if (e instanceof XeroError && e.kind === 'validation') {
        const held = await client.invoiceByNumber(number);
        if (!held) throw e;
        xero = held;
        adopted = true;
      } else {
        throw e;
      }
    }
  }
  progress.xeroId = xero.InvoiceID;

  // 3 · The PDF, once.
  if (settings.attach_pdf && src.storagePath) {
    const name = attachmentName(src);
    const have = adopted ? await client.attachmentNames(xero.InvoiceID) : [];
    if (!have.includes(name)) {
      const pdf = await deps.pdf(src.storagePath);
      if (!pdf)
        throw new XeroError('validation', 'The invoice PDF could not be read from storage.');
      if (pdf.byteLength > MAX_PDF_BYTES) {
        throw new XeroError('validation', "The invoice PDF is over Xero's 10 MB attachment limit.");
      }
      await client.attachPdf(xero.InvoiceID, name, pdf);
    }
  }

  // 4 · The result; the database compares Xero's total with ours.
  const total = typeof xero.Total === 'number' ? xero.Total : null;
  await deps.record(invoiceId, true, xero.InvoiceID, xero.Status ?? null, total, null);
  return {
    adopted,
    mismatch: total === null || Math.round(total * 100) !== Math.round(Number(src.doc.total) * 100),
  };
}

async function ensureContact(deps: PushDeps, src: InvoiceSource): Promise<string> {
  if (src.xeroContactId) return src.xeroContactId;
  const name = src.doc.billTo.name.trim();
  if (!name) throw new XeroError('validation', 'The invoice has no client name to match in Xero.');
  const email = src.doc.billTo.emails?.find((e) => e && e.trim())?.trim() ?? null;
  const found =
    (await deps.client.findContact(name)) ?? (await deps.client.createContact(name, email));
  await deps.saveContact(src.clientId, found);
  return found;
}

function attachmentName(src: InvoiceSource): string {
  const raw = (src.fileName ?? '').trim() || `Invoice ${src.doc.number}.pdf`;
  // No path separators or control characters in a name that goes into a URL.
  const safe = [...raw]
    .map((ch) => (ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? '-' : ch))
    .join('')
    .slice(0, 150);
  return /\.pdf$/i.test(safe) ? safe : `${safe}.pdf`;
}
