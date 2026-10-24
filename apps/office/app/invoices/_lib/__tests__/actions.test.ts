import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvoiceDetail } from '../types';

/**
 * The invoice screen's writes (ADR-0210): void, Xero retry, re-draw and the
 * composed email. Every rule is the database's; these hold what the action
 * says before the round trip, what it sends, and that a refusal reaches the
 * office as a sentence.
 */

type Err = { code?: string; message: string; details?: string | null };
const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({
  data: null as unknown,
  error: null as Err | null,
}));
const revalidatePath = vi.fn();
const loadInvoiceDetail = vi.fn();
const redraw = vi.fn();

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ rpc }) }));
vi.mock('../data', () => ({
  supabaseConfigured: () => true,
  loadInvoiceDetail: (id: string) => loadInvoiceDetail(id),
}));
vi.mock('../redraw', () => ({ redrawTimesheetInvoice: (id: string) => redraw(id) }));

const { redrawInvoice, retryXero, sendInvoiceEmail, voidInvoice } = await import('../actions');

const ID = '11111111-1111-4111-8111-111111111111';

function invoice(over: Partial<InvoiceDetail> = {}): InvoiceDetail {
  return {
    id: ID,
    number: 4001,
    source: 'timesheet',
    status: 'generated',
    invoiceDate: '2026-10-27',
    dueDate: '2026-11-26',
    periodFrom: '2026-10-15',
    periodTo: '2026-10-17',
    poNumber: '52453465',
    net: 100,
    vat: 20,
    vatRate: 20,
    total: 120,
    payableMin: 60,
    termsDays: 30,
    createdAt: '2026-10-27T10:00:00Z',
    sentAt: null,
    voidedAt: null,
    voidReason: null,
    lastError: null,
    timesheetJobId: 'job-1',
    clientId: 'c-1',
    clientName: 'Leonardo',
    billTo: {
      name: 'Leonardo',
      contact: 'Ajit Singh',
      emails: ['ap@x.co.uk'],
      address: '',
      venue: '',
      format: 'aggregated',
      dateLabel: null,
    },
    clientCcEmails: [],
    omitEventDates: false,
    recipients: ['ap@x.co.uk'],
    hasPdf: true,
    fileName: 'Invoice 4001.pdf',
    excel: { path: 'invoices/4001.xlsx', name: 'Invoice 4001.xlsx' },
    sources: [{ path: 'timesheet-jobs/job-1/sheet.pdf', name: 'sheet.pdf' }],
    pdfPath: 'invoices/4001.pdf',
    xero: null,
    lines: [],
    sends: [],
    events: [],
    ...over,
  };
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: null, error: null });
  revalidatePath.mockClear();
  loadInvoiceDetail.mockReset();
  loadInvoiceDetail.mockResolvedValue({ invoice: invoice(), problem: null });
  redraw.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('voidInvoice', () => {
  it('needs a reason and says so before any round trip', async () => {
    expect(await voidInvoice(ID, '   ')).toEqual({
      ok: false,
      message: 'Say why the invoice is being voided.',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses something that is not an invoice id, and a runaway reason', async () => {
    expect((await voidInvoice('nope', 'x')).ok).toBe(false);
    expect((await voidInvoice(ID, 'x'.repeat(501))).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('calls invoice_void with the trimmed reason and refreshes the list and the page', async () => {
    expect(await voidInvoice(ID, '  Wrong PO  ')).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('invoice_void', { p_invoice: ID, p_reason: 'Wrong PO' });
    expect(revalidatePath).toHaveBeenCalledWith(`/invoices/${ID}`);
    expect(revalidatePath).toHaveBeenCalledWith('/invoices');
  });

  it('turns the database refusals into sentences', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'invoice_not_voidable', details: 'void' },
    });
    const result = await voidInvoice(ID, 'because');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(/generated or sent invoice/);
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'read_only' } });
    expect((await voidInvoice(ID, 'because')).ok).toBe(false);
  });
});

describe('retryXero', () => {
  it('calls xero_retry and says it is queued', async () => {
    const result = await retryXero(ID);
    expect(rpc).toHaveBeenCalledWith('xero_retry', { p_invoice: ID });
    expect(result).toMatchObject({ ok: true });
  });

  it('says when there is nothing to retry', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'xero_nothing_to_retry' } });
    const result = await retryXero(ID);
    expect(!result.ok && result.message).toMatch(/Nothing to retry/);
  });
});

describe('redrawInvoice', () => {
  beforeEach(() => {
    // office_can('write') answers true
    rpc.mockImplementation(async (fn: string) => ({
      data: fn === 'office_can' ? true : null,
      error: null,
    }));
  });

  it('draws a failed timesheet invoice', async () => {
    loadInvoiceDetail.mockResolvedValue({ invoice: invoice({ status: 'failed' }), problem: null });
    redraw.mockResolvedValue({ ok: true });
    expect(await redrawInvoice(ID)).toMatchObject({ ok: true });
    expect(redraw).toHaveBeenCalledWith(ID);
  });

  it('refuses a viewer before it touches the service key', async () => {
    rpc.mockImplementation(async (fn: string) => ({
      data: fn === 'office_can' ? false : null,
      error: null,
    }));
    const result = await redrawInvoice(ID);
    expect(result.ok).toBe(false);
    expect(redraw).not.toHaveBeenCalled();
  });

  it('only re-draws a timesheet invoice that is drawing or failed', async () => {
    expect((await redrawInvoice(ID)).ok).toBe(false); // generated
    loadInvoiceDetail.mockResolvedValue({
      invoice: invoice({ source: 'events', status: 'failed' }),
      problem: null,
    });
    expect((await redrawInvoice(ID)).ok).toBe(false);
    expect(redraw).not.toHaveBeenCalled();
  });

  it('passes a failed draw on as a sentence', async () => {
    loadInvoiceDetail.mockResolvedValue({ invoice: invoice({ status: 'drawing' }), problem: null });
    redraw.mockResolvedValue({ ok: false, message: 'The PDF renderer is down.' });
    expect(await redrawInvoice(ID)).toEqual({ ok: false, message: 'The PDF renderer is down.' });
  });
});

describe('sendInvoiceEmail', () => {
  const input = {
    to: [' AP@X.co.uk ', 'ap@x.co.uk'],
    cc: ['cc@x.co.uk', 'ap@x.co.uk'],
    bcc: ['sam@thc.co.uk'],
    subject: ' Inv 4001 ',
    bodyHtml: '<p>Hi <b>Ajit</b></p><script>alert(1)</script><img src=x onerror=alert(1)>',
    attachmentPaths: [
      'invoices/4001.pdf',
      'invoices/4001.xlsx',
      'timesheet-jobs/job-1/sheet.pdf',
      'invoices/4002.pdf', // someone else's invoice
      '../../etc/passwd',
    ],
    replyTo: 'gisela@thc.co.uk',
  };

  it('queues the email: addresses normalised, body cut to the allowed markup, only this invoice’s files attached', async () => {
    const result = await sendInvoiceEmail(ID, input);
    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0]!;
    expect(fn).toBe('queue_timesheet_invoice_email');
    expect(args).toMatchObject({
      p_invoice: ID,
      p_to: ['ap@x.co.uk'],
      // an address already in To is not copied again
      p_cc: ['cc@x.co.uk'],
      p_bcc: ['sam@thc.co.uk'],
      p_subject: 'Inv 4001',
      p_reply_to: 'gisela@thc.co.uk',
      p_attachments: [
        { path: 'invoices/4001.pdf', name: 'Invoice 4001.pdf' },
        { path: 'invoices/4001.xlsx', name: 'Invoice 4001.xlsx' },
        { path: 'timesheet-jobs/job-1/sheet.pdf', name: 'sheet.pdf' },
      ],
    });
    const html = String(args['p_body_html']);
    expect(html).toContain('<b>Ajit</b>');
    expect(html).not.toMatch(/script|onerror|<img/i);
  });

  it('attaches only what was ticked', async () => {
    await sendInvoiceEmail(ID, { ...input, attachmentPaths: ['invoices/4001.pdf'] });
    expect(rpc.mock.calls[0]![1]['p_attachments']).toEqual([
      { path: 'invoices/4001.pdf', name: 'Invoice 4001.pdf' },
    ]);
  });

  it('refuses a bad address, an empty subject or an empty message before the round trip', async () => {
    const bad = await sendInvoiceEmail(ID, { ...input, to: ['not-an-address'] });
    expect(!bad.ok && bad.message).toMatch(/not an email address/);
    const none = await sendInvoiceEmail(ID, { ...input, to: [] });
    expect(!none.ok && none.message).toMatch(/at least one address/);
    const subject = await sendInvoiceEmail(ID, { ...input, subject: '  ' });
    expect(!subject.ok && subject.message).toMatch(/subject/);
    const empty = await sendInvoiceEmail(ID, { ...input, bodyHtml: '<p> </p>' });
    expect(!empty.ok && empty.message).toMatch(/message/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('explains the database refusals', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'invoice_not_sendable', details: 'events/queued' },
    });
    const result = await sendInvoiceEmail(ID, input);
    expect(!result.ok && result.message).toMatch(/timesheet invoice/);
  });

  it('says so when the invoice cannot be read', async () => {
    loadInvoiceDetail.mockResolvedValue({ invoice: null, problem: null });
    const result = await sendInvoiceEmail(ID, input);
    expect(!result.ok && result.message).toMatch(/no longer exists/);
  });
});
