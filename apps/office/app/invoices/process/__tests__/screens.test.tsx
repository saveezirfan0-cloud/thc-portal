import { renderToString as renderRaw } from 'react-dom/server';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('../actions', () => ({
  addRow: vi.fn(),
  approveAllClean: vi.fn(),
  backToReview: vi.fn(),
  changeClient: vi.fn(),
  checkPoDuplicates: vi.fn(async () => ({ ok: true, duplicates: [] })),
  confirmJob: vi.fn(),
  deleteRow: vi.fn(),
  discardJob: vi.fn(),
  generateInvoices: vi.fn(),
  redrawInvoice: vi.fn(),
  retryExtraction: vi.fn(),
  setShiftStatus: vi.fn(),
  updateShift: vi.fn(),
}));

import { ConfirmScreen } from '../_components/ConfirmScreen';
import { ErrorView } from '../_components/ErrorView';
import { GenerateScreen } from '../_components/GenerateScreen';
import { JobsList } from '../_components/JobsList';
import { ProcessingView } from '../_components/ProcessingView';
import { ReviewScreen } from '../_components/ReviewScreen';
import { UploadForm } from '../_components/UploadForm';
import type { IssuedInvoice, JobSummary, ShiftRow, SourceFile, TimesheetClient } from '../types';

vi.mock('@thc/db/browser', () => ({ createClient: () => ({ storage: { from: () => ({}) } }) }));

const client: TimesheetClient = {
  id: 'c1',
  name: 'Taster Liverpool',
  invoiceFormat: 'named',
  poRequired: true,
  defaultRole: 'Service Staff',
};

let n = 0;
const row = (over: Partial<ShiftRow> = {}): ShiftRow => {
  n += 1;
  return {
    id: `r${n}`,
    fileId: 'f1',
    sort: n,
    kind: 'shift',
    status: 'extracted',
    staffName: `Person ${n}`,
    staffRef: `${1000 + n}`,
    workDate: '2026-10-19',
    roleName: 'Service Staff',
    startTime: null,
    endTime: null,
    breakMin: 0,
    hours: 21.5,
    staffCount: 1,
    quantity: null,
    description: null,
    rate: 17.77,
    amount: 382.06,
    issues: [],
    confidence: null,
    source: { type: 'excel', sheet: 'All Employees', row: 2 },
    invoiceId: null,
    ...over,
  };
};

const sources: SourceFile[] = [
  {
    id: 'f1',
    fileName: 'WC 12.10.26 Liverpool.xlsx',
    mimeType: 'x',
    sizeBytes: 20000,
    kind: 'sheet',
    url: 'https://signed.example/f1',
    previewNote: null,
    sheets: [
      {
        name: 'All Employees',
        rows: [
          ['First name', 'Hours'],
          ['Ana', '21:30'],
        ],
        truncated: false,
      },
    ],
  },
];

/** React marks text joins with comments; the tests read the text. */
const renderToString = (el: ReactElement) => renderRaw(el).replace(/<!-- -->/g, '');

describe('Review screen', () => {
  const rows = [
    row({ status: 'approved' }),
    row({ status: 'flagged', rate: null, amount: null, issues: ['no_rate'] }),
    row({
      status: 'extracted',
      confidence: 0.4,
      startTime: '10:00',
      endTime: '18:00',
      hours: 8,
      roleName: 'Shift Leader',
    }),
    row({ status: 'rejected', staffName: 'Ingrid' }),
    row({
      kind: 'custom',
      staffName: '',
      description: 'Train fare',
      quantity: 2,
      rate: 7.5,
      amount: 15,
      hours: null,
    }),
  ];

  it('shows the counters, the chips, the weekly banner, the columns and the footer', () => {
    const html = renderToString(
      <ReviewScreen
        jobId="j1"
        client={client}
        clients={[client]}
        initialRows={rows}
        sources={sources}
        canAct
      />,
    );
    expect(html).toContain('5 rows · 1 approved · 1 flagged');
    expect(html).toContain('Taster Liverpool');
    for (const label of ['All', 'Extracted', 'Flagged', 'Approved', 'Rejected'])
      expect(html).toContain(label);
    expect(html).toContain('summary hours only');
    for (const th of [
      'Name',
      'Staff ID',
      'Event date',
      'Role',
      'Start',
      'End',
      'Break (min)',
      'Hours',
      'Rate',
      'Total',
    ]) {
      expect(html).toContain(th);
    }
    expect(html).toContain('Approve all clean (1)');
    expect(html).toContain('Source document');
    expect(html).toContain('WC 12.10.26 Liverpool.xlsx');
    expect(html).toContain('Approved: <b>1 row</b>');
    expect(html).toContain('Continue with 1 approved row');
    expect(html).toContain('+ Add staff row');
    expect(html).toContain('+ Add expense line');
    expect(html).toContain('19/10/2026');
  });

  it('explains why a row cannot be approved, and shows a low reading', () => {
    const html = renderToString(
      <ReviewScreen
        jobId="j1"
        client={client}
        clients={[client]}
        initialRows={rows}
        sources={sources}
        canAct
      />,
    );
    expect(html).toContain('No rate for this role');
    expect(html).toContain('Check reading 40%');
    expect(html).toMatch(/aria-label="Approve Person \d+"[^>]*disabled/);
  });

  it('does not offer to edit when the login is read-only', () => {
    const html = renderToString(
      <ReviewScreen
        jobId="j1"
        client={client}
        clients={[client]}
        initialRows={rows}
        sources={sources}
        canAct={false}
      />,
    );
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Approve all clean/);
    expect(html).toMatch(/aria-label="Staff name"[^>]*disabled/);
  });

  it('with nothing read, says so and still lets rows be added', () => {
    const html = renderToString(
      <ReviewScreen
        jobId="j1"
        client={client}
        clients={[client]}
        initialRows={[]}
        sources={sources}
        canAct
      />,
    );
    expect(html).toContain('Nothing was read from the file');
    expect(html).toContain('+ Add staff row');
    expect(html).toContain('Continue with 0 approved rows');
  });
});

describe('Confirm screen', () => {
  const rows = [row({ status: 'approved', amount: 100 }), row({ status: 'approved', amount: 50 })];
  it('starts as one invoice with PO, dates, format and a VAT summary', () => {
    const html = renderToString(
      <ConfirmScreen
        jobId="j1"
        client={client}
        rows={rows}
        vatRate={20}
        today="2026-10-26"
        canAct
      />,
    );
    expect(html).toContain('Invoice 1');
    expect(html).not.toContain('Invoice 2');
    expect(html).toContain('PO number *');
    expect(html).toContain('26/10/2026');
    expect(html).toContain('19/10/2026');
    expect(html).toContain('£150.00');
    expect(html).toContain('VAT 20%');
    expect(html).toContain('£30.00');
    expect(html).toContain('£180.00');
    expect(html).toContain('Split by week');
    expect(html).toContain('Split by PO');
    expect(html).toContain('Confirm 1 invoice');
  });

  it('has a way back when nothing is approved', () => {
    const html = renderToString(
      <ConfirmScreen jobId="j1" client={client} rows={[]} vatRate={20} today="2026-10-26" canAct />,
    );
    expect(html).toContain('no approved rows');
    expect(html).toContain('Back to review');
  });
});

const invoice = (over: Partial<IssuedInvoice> = {}): IssuedInvoice => ({
  id: 'i1',
  number: 4000,
  status: 'generated',
  source: 'timesheet',
  poNumber: 'SBX-Liverpool-W42-2026',
  total: 3605.46,
  net: 3004.55,
  vat: 600.91,
  invoiceDate: '2026-10-26',
  format: 'named',
  clientName: 'Taster Liverpool',
  lastError: null,
  stale: false,
  ...over,
});

describe('Generate screen', () => {
  it('offers to generate what is not yet numbered', () => {
    const html = renderToString(
      <GenerateScreen jobId="j1" status="confirmed" invoices={[]} pendingGroups={2} canAct />,
    );
    expect(html).toContain('Generate 2 invoices');
    expect(html).toContain('Back to review');
  });

  it('a card per invoice with preview, downloads and the email link', () => {
    const html = renderToString(
      <GenerateScreen
        jobId="j1"
        status="complete"
        invoices={[invoice()]}
        pendingGroups={0}
        canAct
      />,
    );
    expect(html).toContain('Invoice #4000');
    expect(html).toContain('Generated');
    expect(html).toContain('Named staff');
    expect(html).toContain('PO SBX-Liverpool-W42-2026');
    expect(html).toContain('£3,605.46');
    expect(html).toContain('Preview');
    expect(html).toContain('href="/api/invoices/i1"');
    expect(html).toContain('href="/api/invoices/i1/excel"');
    expect(html).toContain('href="/invoices/i1?email=1"');
    expect(html).toContain('1 invoice is generated');
    expect(html).toContain('Back to Invoices');
    expect(html).toContain('Process another timesheet');
    expect(html).not.toContain('Generate 0');
  });

  it('a failed draw keeps the number and offers Re-draw', () => {
    const html = renderToString(
      <GenerateScreen
        jobId="j1"
        status="confirmed"
        invoices={[invoice({ status: 'failed', lastError: 'no fonts' })]}
        pendingGroups={0}
        canAct
      />,
    );
    expect(html).toContain('could not be drawn: no fonts');
    expect(html).toContain('#4000');
    expect(html).toContain('Re-draw');
    expect(html).not.toContain('Download PDF');
  });

  it('a complete job with no invoice says it was closed', () => {
    const html = renderToString(
      <GenerateScreen jobId="j1" status="complete" invoices={[]} pendingGroups={0} canAct />,
    );
    expect(html).toContain('closed without any invoice');
  });
});

describe('jobs list, processing, error, upload', () => {
  const job = (over: Partial<JobSummary> = {}): JobSummary => ({
    id: 'j1',
    clientId: 'c1',
    clientName: 'Leonardo St Paul’s M&E',
    status: 'reviewing',
    error: null,
    notes: null,
    createdAt: '2026-10-01T10:00:00Z',
    updatedAt: '2026-10-01T10:00:00Z',
    fileNames: ['a.pdf', 'b.pdf'],
    rowCount: 12,
    approvedCount: 0,
    ...over,
  });

  it('marks a job that has waited over a week', () => {
    const html = renderToString(
      <JobsList
        title="Needs review (1)"
        empty="Nothing."
        jobs={[job()]}
        canAct
        now={Date.parse('2026-10-24T12:00:00Z')}
        showAge
      />,
    );
    expect(html).toContain('Needs review');
    expect(html).toContain('23 days old');
    expect(html).toContain('a.pdf + 1 more');
    expect(html).toContain('12 · 0 approved');
    expect(html).toContain('href="/invoices/process/j1"');
    expect(html).toContain('Discard');
  });

  it('says when empty', () => {
    const html = renderToString(
      <JobsList title="Recent jobs" empty="No other jobs yet." jobs={[]} canAct now={0} />,
    );
    expect(html).toContain('No other jobs yet.');
  });

  it('extracting: a status the page refreshes itself from', () => {
    const html = renderToString(
      <ProcessingView
        status="extracting"
        clientName="Taster"
        fileNames={['x.xlsx']}
        stalled={false}
      />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('Reading');
    const slow = renderToString(
      <ProcessingView status="extracting" clientName="T" fileNames={['x']} stalled />,
    );
    expect(slow).toContain('much longer than usual');
  });

  it('error: the reason in words and a Retry', () => {
    const html = renderToString(<ErrorView jobId="j1" error="no_rows_found" canAct />);
    expect(html).toContain('No timesheet rows could be found');
    expect(html).toContain('Retry');
    expect(renderToString(<ErrorView jobId="j1" error="no_rows_found" canAct={false} />)).toMatch(
      /<button[^>]*disabled[^>]*>Retry/,
    );
  });

  it('upload: lists the clients, the accepted files, notes and the button', () => {
    const html = renderToString(<UploadForm clients={[client]} canAct />);
    expect(html).toContain('Taster Liverpool');
    expect(html).toContain('Search clients');
    expect(html).toContain('max 25 MB each, up to 10 files');
    expect(html).toContain('Notes (optional)');
    expect(html).toContain('Upload &amp; process');
    expect(html).toContain('accept=".xlsx,.xls,.csv,.pdf,.jpg,.jpeg,.png"');
    expect(renderToString(<UploadForm clients={[client]} canAct={false} />)).toContain('read-only');
  });
});
