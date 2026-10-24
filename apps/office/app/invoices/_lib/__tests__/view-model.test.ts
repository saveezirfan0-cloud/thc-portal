import { describe, expect, it } from 'vitest';
import { INVOICE_CSV_COLUMNS, csvFileName, invoicesCsv } from '../csv';
import { hoursFromMin, pence, pounds, ukDate, ukStamp } from '../format';
import type { InvoiceListRow, RawInvoiceListRow } from '../types';
import {
  PAGE_SIZE,
  filterRows,
  invoiceCan,
  isoWeek,
  listHref,
  matchesSearch,
  monthlySummary,
  paginate,
  parseInvoiceView,
  quickRange,
  sortRows,
  statusGroup,
  statusesFor,
  toListRow,
  totalsOf,
  viewQuery,
  voidXeroNote,
  weeklySummary,
  xeroGroup,
  xeroRetryable,
} from '../view-model';

// Today in the audit's world: Thu 22 Oct 2026 (week 43 started Mon 19 Oct).
const TODAY = '2026-10-22';
const CLIENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function row(over: Partial<InvoiceListRow> & { number: number }): InvoiceListRow {
  return {
    id: `id-${over.number}`,
    invoiceDate: '2026-10-20',
    clientId: CLIENT_A,
    clientName: "Leonardo St Paul's M & E",
    venue: '',
    poNumber: null,
    source: 'timesheet',
    format: 'aggregated',
    status: 'generated',
    payableMin: 60,
    net: 100,
    vat: 20,
    total: 120,
    lastSentAt: null,
    xero: null,
    xeroInvoiceId: null,
    ...over,
  };
}

describe('the URL (audit §2.4)', () => {
  it('opens on all invoices, Draft/Generated and Sent on, Void off', () => {
    const view = parseInvoiceView({}, TODAY);
    expect(view).toMatchObject({
      tab: 'all',
      client: '',
      from: null,
      to: null,
      range: 'all',
      statuses: ['draft', 'sent'],
      source: '',
      xero: '',
      sort: 'number',
      dir: 'desc',
      page: 1,
    });
  });

  it('reads the tab, the filters and the sort, and ignores what it does not know', () => {
    const view = parseInvoiceView(
      {
        tab: 'weekly',
        client: CLIENT_A,
        from: '2026-10-01',
        to: '2026-10-31',
        q: ' 3255 ',
        status: 'void',
        source: 'events',
        xero: 'failed',
        sort: 'total',
        dir: 'asc',
        page: '3',
      },
      TODAY,
    );
    expect(view).toMatchObject({
      tab: 'weekly',
      client: CLIENT_A,
      from: '2026-10-01',
      to: '2026-10-31',
      range: 'custom',
      q: '3255',
      statuses: ['void'],
      source: 'events',
      xero: 'failed',
      sort: 'total',
      dir: 'asc',
      page: 3,
    });
    const junk = parseInvoiceView(
      {
        tab: 'x',
        client: 'not-a-uuid',
        from: '2026-02-30',
        source: 'both',
        xero: 'syncing',
        sort: 'pwn',
        page: '-4',
      },
      TODAY,
    );
    expect(junk).toMatchObject({
      tab: 'all',
      client: '',
      from: null,
      source: '',
      xero: '',
      sort: 'number',
      page: 1,
    });
  });

  it('swaps a reversed range and lets a quick range override the dates', () => {
    expect(parseInvoiceView({ from: '2026-10-31', to: '2026-10-01' }, TODAY)).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(parseInvoiceView({ range: 'last-week', from: '2020-01-01' }, TODAY)).toMatchObject({
      range: 'last-week',
      from: '2026-10-12',
      to: '2026-10-18',
    });
  });

  it('takes repeated checkboxes from the filter form, and a form with none ticked shows nothing', () => {
    expect(parseInvoiceView({ f: '1', status: ['draft', 'void'] }, TODAY).statuses).toEqual([
      'draft',
      'void',
    ]);
    expect(parseInvoiceView({ f: '1' }, TODAY).statuses).toEqual([]);
    expect(parseInvoiceView({ status: 'none' }, TODAY).statuses).toEqual([]);
  });

  it('round-trips through the query string, leaving defaults out', () => {
    expect(viewQuery(parseInvoiceView({}, TODAY))).toBe('');
    const view = parseInvoiceView(
      { tab: 'monthly', range: 'this-month', status: 'draft,sent,void', q: 'abc' },
      TODAY,
    );
    const again = parseInvoiceView(Object.fromEntries(new URLSearchParams(viewQuery(view))), TODAY);
    expect(again).toEqual(view);
    expect(listHref(view, { page: 2 })).toContain('page=2');
  });

  it('knows the quick ranges (UK dates, Monday weeks)', () => {
    expect(quickRange('this-week', TODAY)).toEqual({ from: '2026-10-19', to: '2026-10-25' });
    expect(quickRange('last-week', TODAY)).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    expect(quickRange('this-month', TODAY)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(quickRange('last-month', TODAY)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(quickRange('last-month', '2026-01-15')).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
    expect(quickRange('quarter', TODAY)).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(quickRange('quarter', '2026-02-10')).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(quickRange('all', TODAY)).toEqual({ from: null, to: null });
  });
});

describe('statuses and Xero', () => {
  it('groups the five database states under the three chips', () => {
    expect(statusGroup('drawing')).toBe('draft');
    expect(statusGroup('failed')).toBe('draft');
    expect(statusGroup('generated')).toBe('draft');
    expect(statusGroup('queued')).toBe('sent');
    expect(statusGroup('void')).toBe('void');
    expect(statusesFor(['sent'])).toEqual(['queued']);
    expect(statusesFor(['draft', 'void'])).toEqual(['drawing', 'failed', 'generated', 'void']);
    expect(statusesFor([])).toEqual([]);
  });

  it('files syncing under pending, and skipped under nothing', () => {
    expect(xeroGroup('syncing')).toBe('pending');
    expect(xeroGroup('skipped')).toBe('');
    expect(xeroGroup(null)).toBe('');
    expect(xeroGroup('mismatch')).toBe('mismatch');
  });

  it('offers Try again for failed and mismatch only, and warns a voided Xero invoice', () => {
    expect(xeroRetryable('failed')).toBe(true);
    expect(xeroRetryable('mismatch')).toBe(true);
    expect(xeroRetryable('pending')).toBe(false);
    expect(xeroRetryable(null)).toBe(false);
    expect(voidXeroNote('synced')).toMatch(/void it in Xero too/);
    expect(voidXeroNote('mismatch')).not.toBeNull();
    expect(voidXeroNote('pending')).toBeNull();
    expect(voidXeroNote(null)).toBeNull();
  });

  it('says which buttons an invoice has', () => {
    expect(invoiceCan('generated', 'timesheet')).toEqual({
      void: true,
      email: true,
      redraw: false,
      files: true,
    });
    expect(invoiceCan('queued', 'timesheet')).toMatchObject({ void: true, email: true });
    expect(invoiceCan('failed', 'timesheet')).toMatchObject({
      redraw: true,
      void: false,
      email: false,
      files: false,
    });
    expect(invoiceCan('drawing', 'timesheet')).toMatchObject({ redraw: true });
    expect(invoiceCan('void', 'timesheet')).toMatchObject({
      void: false,
      email: false,
      files: true,
    });
    // an events invoice is emailed by the system (INV1) and is never re-drawn here
    expect(invoiceCan('queued', 'events')).toMatchObject({
      email: false,
      redraw: false,
      void: true,
    });
    expect(invoiceCan('failed', 'events')).toMatchObject({ redraw: false });
  });
});

describe('rows from the database', () => {
  const raw: RawInvoiceListRow = {
    id: 'i1',
    number: 4001,
    invoice_date: '2026-10-27',
    client_id: CLIENT_A,
    po_number: ' PO-9 ',
    source: 'timesheet',
    status: 'generated',
    payable_min: '186.0',
    net: '3530.28',
    vat: '706.06',
    total: '4236.34',
    sent_at: null,
    queued_at: null,
    bill_to: { name: 'Jurys Inn & Leonardo Hotels', venue: "St Paul's", format: 'aggregated' },
    clients: { name: "Leonardo Hotel St Paul's M&E" },
    xero_sync: [{ status: 'synced', xero_invoice_id: 'x-1' }],
    invoice_event_links: [],
  };

  it('reads a timesheet invoice: bill-to name, venue and format from the snapshot', () => {
    expect(toListRow(raw)).toMatchObject({
      number: 4001,
      clientName: 'Jurys Inn & Leonardo Hotels',
      venue: "St Paul's",
      format: 'aggregated',
      poNumber: 'PO-9',
      payableMin: 186,
      total: 4236.34,
      xero: 'synced',
      xeroInvoiceId: 'x-1',
    });
  });

  it('reads an events invoice: client name, the events’ venues, the sign-in log, queued_at as last sent', () => {
    const events = toListRow({
      ...raw,
      source: 'events',
      bill_to: { name: 'Anything' },
      queued_at: '2026-10-28T10:00:00Z',
      xero_sync: { status: 'pending', xero_invoice_id: null },
      invoice_event_links: [
        { events: { venue_name: 'Mandarin Oriental' } },
        { events: [{ venue_name: 'Mandarin Oriental' }] },
        { events: { venue_name: 'ExCeL' } },
      ],
    });
    expect(events).toMatchObject({
      clientName: "Leonardo Hotel St Paul's M&E",
      venue: 'Mandarin Oriental · ExCeL',
      format: 'log',
      lastSentAt: '2026-10-28T10:00:00Z',
      xero: 'pending',
    });
  });
});

describe('filters, search and sort', () => {
  const rows = [
    row({
      number: 4001,
      clientName: 'Taster Liverpool',
      clientId: 'c-t',
      poNumber: 'SBX-W42',
      status: 'queued',
      xero: 'synced',
      source: 'timesheet',
    }),
    row({
      number: 4002,
      clientName: 'Mandarin Oriental',
      clientId: 'c-m',
      source: 'events',
      status: 'generated',
      xero: 'failed',
      invoiceDate: '2026-09-30',
    }),
    row({
      number: 4003,
      clientName: 'Mandarin Oriental',
      clientId: 'c-m',
      source: 'events',
      status: 'void',
      xero: 'skipped',
    }),
    row({
      number: 4004,
      clientName: 'COMO The Halkin',
      clientId: 'c-c',
      status: 'drawing',
      xero: null,
      invoiceDate: '2026-10-21',
    }),
  ];
  const view = (params: Record<string, string>) => parseInvoiceView(params, TODAY);

  it('hides Void by default and shows it when the chip is ticked', () => {
    expect(filterRows(rows, view({})).map((r) => r.number)).toEqual([4001, 4002, 4004]);
    expect(filterRows(rows, view({ status: 'void' })).map((r) => r.number)).toEqual([4003]);
    expect(filterRows(rows, view({ status: 'draft,sent,void' }))).toHaveLength(4);
  });

  it('filters by source, Xero state, client and dates', () => {
    expect(
      filterRows(rows, view({ source: 'events', status: 'draft,sent,void' })).map((r) => r.number),
    ).toEqual([4002, 4003]);
    expect(filterRows(rows, view({ xero: 'failed' })).map((r) => r.number)).toEqual([4002]);
    expect(filterRows(rows, view({ xero: 'synced' })).map((r) => r.number)).toEqual([4001]);
    expect(filterRows(rows, view({ client: 'c-t' }))).toHaveLength(3); // not a uuid: ignored
    expect(filterRows(rows, { ...view({}), client: 'c-m' }).map((r) => r.number)).toEqual([4002]);
    expect(
      filterRows(rows, view({ from: '2026-10-01', to: '2026-10-31' })).map((r) => r.number),
    ).toEqual([4001, 4004]);
  });

  it('searches number, client and PO, every word', () => {
    expect(matchesSearch(rows[0]!, '#4001')).toBe(true);
    expect(matchesSearch(rows[0]!, 'taster sbx')).toBe(true);
    expect(matchesSearch(rows[0]!, 'taster mandarin')).toBe(false);
    expect(matchesSearch(rows[0]!, 'sbx-w42')).toBe(true);
    expect(matchesSearch(rows[0]!, '')).toBe(true);
    expect(filterRows(rows, view({ q: 'halkin' })).map((r) => r.number)).toEqual([4004]);
  });

  it('sorts by number, date, client and total with the number as the tiebreak', () => {
    expect(sortRows(rows, view({})).map((r) => r.number)).toEqual([4004, 4003, 4002, 4001]);
    expect(sortRows(rows, view({ sort: 'number', dir: 'asc' })).map((r) => r.number)).toEqual([
      4001, 4002, 4003, 4004,
    ]);
    expect(sortRows(rows, view({ sort: 'client', dir: 'asc' })).map((r) => r.number)).toEqual([
      4004, 4002, 4003, 4001,
    ]);
    expect(sortRows(rows, view({ sort: 'date', dir: 'asc' })).map((r) => r.number)[0]).toBe(4002);
  });

  it('pages 50 at a time and clamps a page past the end', () => {
    const many = Array.from({ length: 120 }, (_, n) => n);
    expect(PAGE_SIZE).toBe(50);
    expect(paginate(many, 1)).toMatchObject({ page: 1, pages: 3, total: 120 });
    expect(paginate(many, 3).rows).toHaveLength(20);
    expect(paginate(many, 9).page).toBe(3);
    expect(paginate([], 1)).toMatchObject({ page: 1, pages: 1, rows: [] });
  });
});

describe('KPI strip and summaries (audit §2.4, §8)', () => {
  it('adds up in whole pence, so 0.1 + 0.2 stays 0.30', () => {
    expect(pence(0.1) + pence(0.2)).toBe(30);
    const totals = totalsOf([row({ number: 1, total: 0.1 }), row({ number: 2, total: 0.2 })]);
    expect(totals.total).toBe(0.3);
    expect(totals.average).toBe(0.15);
  });

  it('counts invoices, totals, hours and the average', () => {
    const totals = totalsOf([
      row({ number: 1, total: 4236.34, payableMin: 11160 }),
      row({ number: 2, total: 204.98, payableMin: 600 }),
    ]);
    expect(totals).toEqual({ count: 2, total: 4441.32, hours: 196, average: 2220.66 });
    expect(totalsOf([])).toEqual({ count: 0, total: 0, hours: 0, average: 0 });
  });

  it('knows the ISO week, including a year boundary', () => {
    expect(isoWeek('2026-10-19')).toEqual({ year: 2026, week: 43 });
    expect(isoWeek('2026-10-25')).toEqual({ year: 2026, week: 43 });
    expect(isoWeek('2026-10-12')).toEqual({ year: 2026, week: 42 });
    expect(isoWeek('2027-01-01')).toEqual({ year: 2026, week: 53 });
    expect(isoWeek('2024-12-30')).toEqual({ year: 2025, week: 1 });
  });

  it('groups by ISO week of the INVOICE date, newest first, labelled in UK dates', () => {
    const groups = weeklySummary([
      row({ number: 1, invoiceDate: '2026-10-20', total: 100, payableMin: 60 }),
      row({ number: 2, invoiceDate: '2026-10-25', total: 300, payableMin: 120 }),
      row({ number: 3, invoiceDate: '2026-10-13', total: 50, payableMin: 30 }),
    ]);
    expect(groups.map((g) => g.label)).toEqual([
      'Week 43: 19 Oct – 25 Oct 2026',
      'Week 42: 12 Oct – 18 Oct 2026',
    ]);
    expect(groups[0]).toMatchObject({ count: 2, total: 400, hours: 3, average: 200 });
    expect(groups[1]).toMatchObject({ count: 1, total: 50 });
  });

  it('groups by month of the invoice date', () => {
    const groups = monthlySummary([
      row({ number: 1, invoiceDate: '2026-10-20', total: 100 }),
      row({ number: 2, invoiceDate: '2026-09-30', total: 40 }),
      row({ number: 3, invoiceDate: '2026-10-01', total: 60 }),
    ]);
    expect(groups.map((g) => [g.label, g.count, g.total])).toEqual([
      ['October 2026', 2, 160],
      ['September 2026', 1, 40],
    ]);
  });
});

describe('formatting', () => {
  it('writes UK dates and 24-hour UK stamps', () => {
    expect(ukDate('2026-10-20')).toBe('20/10/2026');
    expect(ukDate(null)).toBe('—');
    // 20:34 UTC on 20 Oct 2026 is 21:34 BST
    expect(ukStamp('2026-10-20T20:34:00Z')).toBe('20/10/2026 21:34');
    expect(ukStamp('2026-01-20T20:34:00Z')).toBe('20/01/2026 20:34');
    expect(ukStamp('nonsense')).toBe('—');
  });

  it('writes pounds and hours to the penny', () => {
    expect(pounds(588042.68)).toBe('£588,042.68');
    expect(pounds('12.5')).toBe('£12.50');
    expect(hoursFromMin(11160)).toBe(186);
  });
});

describe('Export as CSV (Back Office convention)', () => {
  const csv = invoicesCsv([
    row({
      number: 4001,
      clientName: '=cmd|calc',
      poNumber: 'A,B',
      payableMin: 90,
      net: 10,
      vat: 2,
      total: 12,
      lastSentAt: '2026-10-21T10:00:00Z',
      xero: 'synced',
      xeroInvoiceId: 'x-9',
    }),
  ]);

  it('starts with the BOM, one header row, CRLF line ends', () => {
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe(INVOICE_CSV_COLUMNS.join(','));
    expect(lines).toHaveLength(3); // header, one row, trailing empty
  });

  it('defuses a formula, quotes a comma, writes the money to two places', () => {
    const line = csv.slice(1).split('\r\n')[1]!;
    expect(line).toContain("'=cmd|calc");
    expect(line).toContain('"A,B"');
    expect(line).toContain(',10.00,2.00,12.00,');
    expect(line).toContain('1.50'); // 90 minutes
    expect(line).toContain('21/10/2026 11:00');
    expect(line).toContain('In Xero,x-9');
  });

  it('names the file by date', () => {
    expect(csvFileName(TODAY)).toBe('THC invoices 2026-10-22.csv');
  });
});
