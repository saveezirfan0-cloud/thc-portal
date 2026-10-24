import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvoiceDetail, InvoiceListRow } from '../_lib/types';

/**
 * /invoices and /invoices/:invoiceId (ADR-0210): who sees what, and what each
 * state draws. The figures are the database's; this pins the pages' reading
 * of them.
 */

const state = vi.hoisted(() => ({
  role: 'manager' as string | null,
  list: [] as unknown[],
  detail: null as unknown,
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  useRouter: () => ({ refresh: () => undefined }),
}));
vi.mock('../../_components/OfficeShell', () => ({
  OfficeShell: ({
    title,
    crumbs,
    children,
  }: {
    title: ReactNode;
    crumbs?: ReactNode;
    children: ReactNode;
  }) => (
    <div>
      <h1>{title}</h1>
      <p>{crumbs}</p>
      {children}
    </div>
  ),
}));
vi.mock('../../_components/NotAvailable', () => ({
  NotAvailable: ({ needs }: { needs: string }) => <p>not-available:{needs}</p>,
}));
vi.mock('../../_components/officeUser', () => ({
  currentOfficeRole: async () => state.role,
  officeUser: async () => ({ name: 'Gisela M.' }),
}));
vi.mock('../../reports/_components/zone', () => ({
  ViewerZone: () => null,
  ScheduledWindow: ({ startsAt }: { startsAt: string }) => <span>window:{startsAt}</span>,
}));
vi.mock('../../reports/invoicing/[eventId]/ResendInvoice', () => ({
  ResendInvoice: ({ retry }: { retry: boolean }) => (
    <button>resend:{retry ? 'retry' : 'again'}</button>
  ),
}));
vi.mock('../_components/InvoiceActions', () => ({
  InvoiceActions: (props: {
    canWrite: boolean;
    mail: { subject: string; to: string[] } | null;
    can: object;
  }) => (
    <div data-actions={JSON.stringify({ ...props.can, canWrite: props.canWrite })}>
      mail:{props.mail ? `${props.mail.subject}|${props.mail.to.join(',')}` : 'none'}
    </div>
  ),
}));
vi.mock('../_components/XeroRetry', () => ({ XeroRetry: () => <button>try-again</button> }));
vi.mock('../_lib/data', () => ({
  loadInvoiceList: async () => ({
    rows: state.list,
    clients: [{ id: 'c-1', name: 'Taster' }],
    problem: null,
  }),
  loadInvoiceDetail: async () => ({ invoice: state.detail, problem: null }),
  loadComposer: async () => ({ userId: 'u-1', email: 'gisela@thc.co.uk' }),
}));

const { default: ListPage } = await import('../page');
const { default: DetailPage } = await import('../[invoiceId]/page');

const ID = '0a0a0a0a-0000-4000-8000-000000000001';

function listRow(over: Partial<InvoiceListRow> & { number: number }): InvoiceListRow {
  return {
    id: `i-${over.number}`,
    invoiceDate: '2026-10-20',
    clientId: 'c-1',
    clientName: 'Taster Liverpool',
    venue: '',
    poNumber: 'SBX-W42',
    source: 'timesheet',
    format: 'named',
    status: 'generated',
    payableMin: 600,
    net: 100,
    vat: 20,
    total: 120,
    lastSentAt: null,
    xero: 'pending',
    xeroInvoiceId: null,
    ...over,
  };
}

function detail(over: Partial<InvoiceDetail> = {}): InvoiceDetail {
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
    net: 3530.28,
    vat: 706.06,
    vatRate: 20,
    total: 4236.34,
    payableMin: 11160,
    termsDays: 30,
    createdAt: '2026-10-27T10:00:00Z',
    sentAt: null,
    voidedAt: null,
    voidReason: null,
    lastError: null,
    timesheetJobId: 'job-9',
    clientId: 'c-1',
    clientName: 'Leonardo',
    billTo: {
      name: 'Jurys Inn & Leonardo Hotels',
      contact: 'Ajit Singh',
      emails: ['ap@leonardo.co.uk'],
      address: '',
      venue: "St Paul's",
      format: 'aggregated',
      dateLabel: null,
    },
    clientCcEmails: [],
    omitEventDates: false,
    recipients: [],
    hasPdf: true,
    fileName: 'Invoice 4001.pdf',
    excel: null,
    sources: [],
    pdfPath: 'invoices/4001.pdf',
    xero: {
      status: 'mismatch',
      attempts: 1,
      xeroInvoiceId: 'x-1',
      xeroStatus: 'DRAFT',
      xeroTotal: 4236.35,
      lastError: 'Xero total differs.',
      syncedAt: null,
    },
    lines: [
      {
        id: 1,
        sort: 1,
        lineDate: '2026-10-15',
        staffName: '',
        employeeId: null,
        roleName: 'Waiting',
        breakMin: 0,
        payableMin: 600,
        hours: 10,
        staffCount: 3,
        quantity: null,
        rate: 18.98,
        amount: 569.4,
        kind: 'timesheet',
        startsAt: null,
        endsAt: null,
      },
      {
        id: 2,
        sort: 2,
        lineDate: '2026-10-16',
        staffName: '',
        employeeId: null,
        roleName: 'Taxi',
        breakMin: 0,
        payableMin: 0,
        hours: null,
        staffCount: null,
        quantity: 2,
        rate: 12.5,
        amount: 25,
        kind: 'custom',
        startsAt: null,
        endsAt: null,
      },
    ],
    sends: [],
    events: [],
    ...over,
  };
}

beforeEach(() => {
  state.role = 'manager';
  state.list = [];
  state.detail = null;
});

const render = async (node: Promise<ReactNode>) => renderToStaticMarkup(await node);

describe('/invoices', () => {
  const search = Promise.resolve({});

  it('tells a scheduler it is for finance and asks nothing', async () => {
    state.role = 'scheduler';
    expect(await render(ListPage({ searchParams: search }))).toContain('not-available:finance');
  });

  it('draws the header count and total, the KPI strip and a row per invoice', async () => {
    state.list = [
      listRow({ number: 4002, total: 120, payableMin: 600 }),
      listRow({
        number: 4001,
        total: 230.5,
        payableMin: 90,
        source: 'events',
        format: 'log',
        status: 'queued',
        xero: 'synced',
        lastSentAt: '2026-10-21T10:00:00Z',
      }),
    ];
    const html = await render(ListPage({ searchParams: search }));
    expect(html).toContain('All generated invoices');
    expect(html).toContain('2 invoices | £350.50');
    expect(html).toContain('All Invoices');
    expect(html).toContain('Weekly Summary');
    expect(html).toContain('Monthly Summary');
    expect(html).toContain('href="/invoices/i-4002"');
    expect(html).toContain('#4001');
    expect(html).toContain('Timesheet');
    expect(html).toContain('Sign-in log');
    expect(html).toContain('In Xero');
    expect(html).toContain('Xero pending');
    // the Paid chip of the old tool is gone; Draft / Generated, Sent and Void are the chips
    expect(html).not.toContain('Paid');
    expect(html).toContain('Draft / Generated');
    expect(html).toContain('/invoices/export');
    expect(html).toContain('/invoices/process');
  });

  it('keeps Void off by default and shows the empty state', async () => {
    state.list = [listRow({ number: 4003, status: 'void' })];
    const html = await render(ListPage({ searchParams: search }));
    expect(html).toContain('No invoice matches these filters.');
    expect(html).toContain('0 invoices | £0.00');
  });

  it('a viewer sees everything and no way to start a timesheet', async () => {
    state.role = 'viewer';
    state.list = [listRow({ number: 4001 })];
    const html = await render(ListPage({ searchParams: search }));
    expect(html).toContain('#4001');
    expect(html).not.toContain('+ Process timesheet');
  });

  it('draws the weekly summary by ISO week of the invoice date', async () => {
    state.list = [
      listRow({ number: 4001, invoiceDate: '2026-10-20' }),
      listRow({ number: 4002, invoiceDate: '2026-10-13' }),
    ];
    const html = await render(ListPage({ searchParams: Promise.resolve({ tab: 'weekly' }) }));
    expect(html).toContain('Week 43: 19 Oct – 25 Oct 2026');
    expect(html).toContain('Week 42: 12 Oct – 18 Oct 2026');
  });
});

describe('/invoices/:invoiceId', () => {
  const params = Promise.resolve({ invoiceId: ID });

  it('is finance only, and a bad id is a 404', async () => {
    state.role = 'scheduler';
    expect(await render(DetailPage({ params }))).toContain('not-available:finance');
    state.role = 'manager';
    await expect(DetailPage({ params: Promise.resolve({ invoiceId: 'nope' }) })).rejects.toThrow(
      'NOT_FOUND',
    );
    state.detail = null;
    await expect(DetailPage({ params })).rejects.toThrow('NOT_FOUND');
  });

  it('draws the summary, the money, Xero’s mismatch with Try again, the lines and the job link', async () => {
    state.detail = detail();
    const html = await render(DetailPage({ params }));
    expect(html).toContain('Invoice #4001');
    expect(html).toContain('Generated');
    expect(html).toContain('52453465');
    expect(html).toContain('£3,530.28');
    expect(html).toContain('£706.06');
    expect(html).toContain('£4,236.34');
    expect(html).toContain('Xero mismatch');
    expect(html).toContain('Xero total £4,236.35 differs from ours £4,236.34');
    expect(html).toContain('try-again');
    expect(html).toContain('href="/invoices/process/job-9"');
    // role-aggregated: No. of staff, no staff column
    expect(html).toContain('No. of staff');
    expect(html).toContain('Waiting');
    expect(html).toContain('Taxi');
    // the email modal is offered with the notifications package's subject
    expect(html).toContain('Inv 4001');
    expect(html).toContain('ap@leonardo.co.uk');
  });

  it('uses the client’s date column header', async () => {
    state.detail = detail({
      billTo: { ...detail().billTo, format: 'named', dateLabel: 'W/C Date' },
    });
    const html = await render(DetailPage({ params }));
    expect(html).toContain('W/C Date');
    expect(html).not.toContain('No. of staff');
  });

  it('a voided invoice says why, keeps its number and offers nothing to change', async () => {
    state.detail = detail({
      status: 'void',
      voidedAt: '2026-10-28T09:00:00Z',
      voidReason: 'Wrong PO',
      xero: {
        status: 'synced',
        attempts: 1,
        xeroInvoiceId: 'x-1',
        xeroStatus: 'DRAFT',
        xeroTotal: 4236.34,
        lastError: null,
        syncedAt: '2026-10-27T11:00:00Z',
      },
    });
    const html = await render(DetailPage({ params }));
    expect(html).toContain('Wrong PO');
    expect(html).toContain('never reused');
    expect(html).toContain('void it in Xero too');
    expect(html).toContain('mail:none');
  });

  it('a failed PDF says so and points at Re-draw', async () => {
    state.detail = detail({ status: 'failed', lastError: 'renderer down', xero: null });
    const html = await render(DetailPage({ params }));
    expect(html).toContain('The PDF could not be drawn.');
    expect(html).toContain('renderer down');
    expect(html).toContain('Re-draw');
  });

  it('a viewer gets the page and no write controls', async () => {
    state.role = 'viewer';
    state.detail = detail();
    const html = await render(DetailPage({ params }));
    expect(html).toContain('&quot;canWrite&quot;:false');
    expect(html).not.toContain('try-again');
  });

  it('an events invoice lists its events and offers Send again to a writer', async () => {
    state.detail = detail({
      source: 'events',
      timesheetJobId: null,
      status: 'queued',
      sentAt: '2026-10-28T10:00:00Z',
      billTo: { ...detail().billTo, format: null },
      events: [{ id: 'e-1', title: 'Gala Dinner', date: '2026-10-19', venue: 'Leonardo Royal' }],
      xero: null,
    });
    const html = await render(DetailPage({ params }));
    expect(html).toContain('href="/reports/invoicing/e-1"');
    expect(html).toContain('Gala Dinner');
    expect(html).toContain('resend:again');
    expect(html).toContain('mail:none');
    expect(html).toContain('Sign-in log');
  });
});
