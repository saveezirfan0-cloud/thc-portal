'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@thc/db/server';
import { sanitiseEmailHtml } from '@thc/notifications';
import { explainDbError } from '../../_lib/dbError';
import { officeMayWrite, READ_ONLY_MESSAGE } from '../../_lib/sessionRole';
import { loadInvoiceDetail, supabaseConfigured } from './data';
import { emailProblem } from './email';
import type { AttachmentRef } from './types';
import { redrawTimesheetInvoice } from './redraw';

/**
 * Writes for /invoices/:invoiceId (ADR-0210). Every rule is in the database
 * (`invoice_void`, `queue_timesheet_invoice_email`, `xero_retry`: finance
 * callers that may write); these validate first so a typo costs no round
 * trip, and turn the refusals into sentences.
 */

export type InvoiceActionResult = { ok: true; message?: string } | { ok: false; message: string };

const NOT_CONFIGURED =
  'This environment has no Supabase project, so this cannot be saved. See docs/04-setup-github-vercel-supabase.md.';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const WORDING = {
  codes: {
    not_permitted: 'Only an owner or a manager with finance can do this. Ask an owner.',
    invoice_not_found: 'That invoice no longer exists. Refresh the page.',
    void_reason_required: 'Say why the invoice is being voided.',
    invoice_not_voidable:
      'Only a generated or sent invoice can be voided. It may already have been voided. Refresh the page.',
    invoice_not_sendable:
      'Only a generated or sent timesheet invoice can be emailed from here. Refresh the page.',
    invoice_has_no_files: 'This invoice has no PDF yet. Re-draw it first.',
    invoice_has_no_recipients: 'Add at least one address in To.',
    invalid_invoice_email: 'One of the email addresses is not valid. Check To, Cc and Bcc.',
    subject_required: 'The email needs a subject.',
    xero_nothing_to_retry: 'Nothing to retry: this invoice is not failed or mismatched in Xero.',
  },
  log: '[invoices]',
} as const;

interface Rpc {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{
    data?: unknown;
    error: { code?: string | null; message: string; details?: string | null } | null;
  }>;
}

function refresh(invoiceId: string): void {
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath('/invoices');
  revalidatePath('/reports');
}

/**
 * Void: the number is never reused and the rows go back to review. A reason
 * is required (the database refuses a blank one too).
 */
export async function voidInvoice(invoiceId: string, reason: string): Promise<InvoiceActionResult> {
  if (!UUID.test(invoiceId)) return { ok: false, message: WORDING.codes.invoice_not_found };
  const why = String(reason ?? '').trim();
  if (why === '') return { ok: false, message: WORDING.codes.void_reason_required };
  if (why.length > 500) return { ok: false, message: 'Keep the reason under 500 characters.' };
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  const db = createClient(await cookies()) as unknown as Rpc;
  const { error } = await db.rpc('invoice_void', { p_invoice: invoiceId, p_reason: why });
  if (error) return { ok: false, message: explainDbError(error, WORDING) };
  refresh(invoiceId);
  return { ok: true };
}

/** The office's "Try again" on a Xero row that failed or does not match. */
export async function retryXero(invoiceId: string): Promise<InvoiceActionResult> {
  if (!UUID.test(invoiceId)) return { ok: false, message: WORDING.codes.invoice_not_found };
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const db = createClient(await cookies()) as unknown as Rpc;
  const { error } = await db.rpc('xero_retry', { p_invoice: invoiceId });
  if (error) return { ok: false, message: explainDbError(error, WORDING) };
  refresh(invoiceId);
  return { ok: true, message: 'Queued for Xero again. It is pushed within a few minutes.' };
}

/**
 * "Re-draw" on a timesheet invoice whose PDF failed or is still drawing.
 * The draw uses the service key, which does not meet RLS, so the caller's
 * right to write is asked first (`office_can('write')`), and the invoice is
 * read as the caller (finance RLS) to be sure it is theirs to see and in the
 * right state.
 */
export async function redrawInvoice(invoiceId: string): Promise<InvoiceActionResult> {
  if (!UUID.test(invoiceId)) return { ok: false, message: WORDING.codes.invoice_not_found };
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  const db = createClient(await cookies());
  if (!(await officeMayWrite(db))) return { ok: false, message: READ_ONLY_MESSAGE };

  const { invoice, problem } = await loadInvoiceDetail(invoiceId);
  if (problem) return { ok: false, message: problem };
  if (!invoice) return { ok: false, message: WORDING.codes.invoice_not_found };
  if (
    invoice.source !== 'timesheet' ||
    (invoice.status !== 'drawing' && invoice.status !== 'failed')
  ) {
    return {
      ok: false,
      message: 'Only a timesheet invoice that is drawing or failed can be re-drawn.',
    };
  }

  const drawn = await redrawTimesheetInvoice(invoiceId);
  refresh(invoiceId);
  return drawn.ok ? { ok: true, message: 'Invoice drawn.' } : drawn;
}

export interface SendInvoiceInput {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  bodyHtml: string;
  /** Storage paths ticked in the modal: the invoice PDF, the Excel, original timesheets. */
  attachmentPaths: string[];
  /** The signed-in user's address, so the client's reply reaches them. */
  replyTo?: string | null;
}

/**
 * Email Invoice (ADR-0210, INV2). The attachments are re-derived from the
 * database: only a path that belongs to THIS invoice (its PDF, its Excel,
 * its timesheet files) is attached, whatever the browser sent. The body is
 * cut down to the allowed rich text here as well as by the sender.
 */
export async function sendInvoiceEmail(
  invoiceId: string,
  input: SendInvoiceInput,
): Promise<InvoiceActionResult> {
  if (!UUID.test(invoiceId)) return { ok: false, message: WORDING.codes.invoice_not_found };
  const clean = (list: readonly string[] | undefined) => [
    ...new Set((list ?? []).map((a) => String(a).trim().toLowerCase()).filter(Boolean)),
  ];
  const draft = {
    to: clean(input.to),
    cc: clean(input.cc),
    bcc: clean(input.bcc),
    subject: String(input.subject ?? ''),
    bodyHtml: sanitiseEmailHtml(String(input.bodyHtml ?? '')),
  };
  const problem = emailProblem(draft);
  if (problem) return { ok: false, message: problem };
  if (!supabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };

  const { invoice, problem: readFailed } = await loadInvoiceDetail(invoiceId);
  if (readFailed) return { ok: false, message: readFailed };
  if (!invoice) return { ok: false, message: WORDING.codes.invoice_not_found };

  const allowed = new Map<string, AttachmentRef>();
  if (invoice.pdfPath) {
    allowed.set(invoice.pdfPath, {
      path: invoice.pdfPath,
      name: invoice.fileName ?? `Invoice ${invoice.number}.pdf`,
    });
  }
  if (invoice.excel) allowed.set(invoice.excel.path, invoice.excel);
  for (const source of invoice.sources) allowed.set(source.path, source);
  const attachments = [...new Set(input.attachmentPaths ?? [])]
    .map((path) => allowed.get(path))
    .filter((a): a is AttachmentRef => a !== undefined)
    .map((a) => ({ path: a.path, name: a.name }));

  const db = createClient(await cookies()) as unknown as Rpc;
  const { error } = await db.rpc('queue_timesheet_invoice_email', {
    p_invoice: invoiceId,
    p_to: draft.to,
    p_cc: draft.cc.filter((a) => !draft.to.includes(a)),
    p_bcc: draft.bcc.filter((a) => !draft.to.includes(a) && !draft.cc.includes(a)),
    p_subject: draft.subject.trim(),
    p_body_html: draft.bodyHtml,
    p_reply_to: input.replyTo?.trim() || null,
    p_attachments: attachments,
  });
  if (error) return { ok: false, message: explainDbError(error, WORDING) };
  refresh(invoiceId);
  return { ok: true, message: `Invoice ${invoice.number} queued to ${draft.to.join(', ')}.` };
}
