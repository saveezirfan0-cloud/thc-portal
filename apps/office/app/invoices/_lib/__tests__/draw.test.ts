import { describe, expect, it, vi } from 'vitest';
import { drawWith } from '../draw';
import type { DrawDeps } from '../draw';

vi.mock('@thc/db/admin', () => ({ createAdminClient: () => ({}) }));

const DOC = {
  id: 'i1',
  source: 'timesheet',
  number: 4001,
  invoiceDate: '2026-10-28',
  dueDate: '2026-11-04',
  periodFrom: '2026-10-26',
  periodTo: '2026-11-01',
  poNumber: 'PO-9',
  payableMin: 0,
  net: '75.92',
  vatRate: '20.00',
  vat: '15.18',
  total: '91.10',
  termsDays: 7,
  billTo: { name: 'Taster London', format: 'named', dateLabel: 'W/C Date' },
  seller: { company: { name: 'THC' } },
  recipients: [],
  events: [],
  lines: [
    {
      date: '2026-10-26',
      staffName: 'A B',
      employeeId: null,
      role: 'Staff',
      startsAt: null,
      endsAt: null,
      breakMin: 0,
      payableMin: 240,
      rate: '18.98',
      amount: '75.92',
      kind: 'timesheet',
      hours: '4.00',
      staffCount: 1,
    },
  ],
};

function deps(over: Partial<DrawDeps> = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const uploads: string[] = [];
  const d: DrawDeps = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      return { data: fn === 'invoice_document_data' ? DOC : null, error: null };
    },
    invoice: async () => ({ status: 'drawing', source: 'timesheet', timesheet_job_id: 'j1' }),
    sourceFiles: async () => [{ storage_path: 'timesheet-jobs/j1/a.xlsx', file_name: 'a.xlsx' }],
    upload: async (p) => void uploads.push(p),
    ...over,
  };
  return { d, calls, uploads };
}

describe('drawTimesheetInvoice (ADR-0210)', () => {
  it('stores the PDF and Excel, records them with the sources, then marks generated', async () => {
    const { d, calls, uploads } = deps();
    expect(await drawWith(d, 'i1')).toEqual({ ok: true });
    expect(uploads).toEqual([
      'invoices/4001/Taster London - Inv 4001 - w-c 26-10-2026 - PO 9.pdf',
      'invoices/4001/Taster London - Inv 4001 - w-c 26-10-2026 - PO 9.xlsx',
    ]);
    expect(calls.map((c) => c.fn)).toEqual([
      'invoice_begin',
      'invoice_document_data',
      'invoice_record_files',
      'invoice_mark_generated',
    ]);
    expect(calls[2]!.args).toEqual({
      p_invoice: 'i1',
      p_storage_path: uploads[0],
      p_file_name: 'Taster London - Inv 4001 - w-c 26-10-2026 - PO 9.pdf',
      p_attachments: {
        excel: { path: uploads[1], name: 'Taster London - Inv 4001 - w-c 26-10-2026 - PO 9.xlsx' },
        sources: [{ path: 'timesheet-jobs/j1/a.xlsx', name: 'a.xlsx' }],
      },
    });
  });

  it('releases the invoice as failed, with the reason, when a step throws', async () => {
    const { d, calls } = deps({
      upload: async () => {
        throw new Error('storage down');
      },
    });
    expect(await drawWith(d, 'i1')).toEqual({ ok: false, error: 'storage down' });
    expect(calls.at(-1)).toEqual({
      fn: 'invoice_release',
      args: { p_invoice: 'i1', p_error: 'storage down' },
    });
    expect(calls.map((c) => c.fn)).not.toContain('invoice_mark_generated');
  });

  it('re-draws a failed invoice', async () => {
    const { d } = deps({
      invoice: async () => ({ status: 'failed', source: 'timesheet', timesheet_job_id: null }),
    });
    expect(await drawWith(d, 'i1')).toEqual({ ok: true });
  });

  it('refuses an invoice that is not open, without releasing it', async () => {
    for (const status of ['generated', 'queued', 'void']) {
      const { d, calls } = deps({
        invoice: async () => ({ status, source: 'timesheet', timesheet_job_id: null }),
      });
      const r = await drawWith(d, 'i1');
      expect(r.ok).toBe(false);
      expect(calls).toEqual([]);
    }
    const { d, calls } = deps({
      invoice: async () => ({ status: 'drawing', source: 'events', timesheet_job_id: null }),
    });
    expect((await drawWith(d, 'i1')).ok).toBe(false);
    expect(calls).toEqual([]);
  });
});
