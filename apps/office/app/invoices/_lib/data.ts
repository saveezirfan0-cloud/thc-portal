/* eslint-disable @typescript-eslint/no-explicit-any -- packages/db ships a
   placeholder Database type until `pnpm --filter @thc/db gen:types` runs
   against a linked project, so `from('invoices')` resolves to `never`. The
   other office loaders narrow the same way; the rows are typed on the way out. */

import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { readAllPages } from '@thc/db/paged';
import { readProblem } from '../../_lib/dbError';
import { num } from './format';
import type {
  AttachmentRef,
  ClientOption,
  InvoiceDetail,
  InvoiceLineRow,
  InvoiceListRow,
  InvoiceSendRow,
  InvoiceSource,
  InvoiceStatus,
  LinkedEvent,
  RawInvoiceListRow,
  XeroStatus,
  XeroSyncRow,
} from './types';
import { statusesFor, toListRow } from './view-model';
import type { InvoiceView } from './view-model';

/**
 * Reads for /invoices (ADR-0210). Everything goes through the caller's own
 * RLS client: the tables are finance-gated, so a scheduler is refused by the
 * database and the page has already said so.
 */

export function supabaseConfigured(): boolean {
  return Boolean(
    process.env['NEXT_PUBLIC_SUPABASE_URL'] && process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'],
  );
}

export const NOT_CONFIGURED =
  'This environment has no Supabase project, so invoices cannot be read. See docs/04-setup-github-vercel-supabase.md.';

/** The most invoices one screen reads to total and summarise (a year is a few hundred). */
export const LIST_CEILING = 20_000;

const LIST_COLUMNS =
  'id, number, invoice_date, client_id, po_number, source, status, payable_min, net, vat, total, ' +
  'sent_at, queued_at, bill_to, clients(name), xero_sync(status, xero_invoice_id), ' +
  'invoice_event_links(events(venue_name))';

export interface InvoiceListData {
  rows: InvoiceListRow[];
  clients: ClientOption[];
  problem: string | null;
}

/**
 * Every invoice the coarse filters keep (client, dates, status chips,
 * source), newest number first — read page by page past PostgREST's 1,000
 * and refused, never cut, if the count moves. The search and the Xero filter
 * are applied by `filterRows` in the view-model.
 */
export async function loadInvoiceList(view: InvoiceView): Promise<InvoiceListData> {
  if (!supabaseConfigured()) return { rows: [], clients: [], problem: NOT_CONFIGURED };
  const db = createClient(await cookies()) as any;
  const statuses = statusesFor(view.statuses);

  const [rows, clients] = await Promise.all([
    statuses.length === 0
      ? Promise.resolve({ data: [] as RawInvoiceListRow[], error: null })
      : readAllPages<RawInvoiceListRow>(
          (range) => {
            let query = db
              .from('invoices')
              .select(LIST_COLUMNS, range.first ? { count: 'exact' } : undefined)
              .in('status', statuses);
            if (view.client) query = query.eq('client_id', view.client);
            if (view.from) query = query.gte('invoice_date', view.from);
            if (view.to) query = query.lte('invoice_date', view.to);
            if (view.source) query = query.eq('source', view.source);
            return query.order('number', { ascending: false }).range(range.from, range.to);
          },
          { what: 'invoices', ceiling: LIST_CEILING, key: (row) => row.id },
        ),
    db.from('clients').select('id, name').order('name'),
  ]);

  const error = rows.error ?? clients.error;
  if (error) return { rows: [], clients: [], problem: readProblem(error) };
  return {
    rows: (rows.data ?? []).map(toListRow),
    clients: ((clients.data ?? []) as ClientOption[]).map((c) => ({ id: c.id, name: c.name })),
    problem: null,
  };
}

// ---------------------------------------------------------------------------
// one invoice
// ---------------------------------------------------------------------------

export interface InvoiceDetailData {
  invoice: InvoiceDetail | null;
  problem: string | null;
}

function refOf(value: unknown): AttachmentRef | null {
  if (!value || typeof value !== 'object') return null;
  const { path, name, size } = value as { path?: unknown; name?: unknown; size?: unknown };
  if (typeof path !== 'string' || path === '') return null;
  return {
    path,
    name: typeof name === 'string' && name !== '' ? name : (path.split('/').pop() ?? path),
    size: typeof size === 'number' ? size : null,
  };
}

/** `attachments` is `{excel: {path, name}, sources: [{path, name}]}` on a timesheet invoice. */
export function attachmentsOf(attachments: unknown): {
  excel: AttachmentRef | null;
  sources: AttachmentRef[];
} {
  const a = (attachments && typeof attachments === 'object' ? attachments : {}) as {
    excel?: unknown;
    sources?: unknown;
  };
  const sources = Array.isArray(a.sources)
    ? a.sources.map(refOf).filter((r): r is AttachmentRef => r !== null)
    : [];
  return { excel: refOf(a.excel), sources };
}

const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

export async function loadInvoiceDetail(id: string): Promise<InvoiceDetailData> {
  if (!supabaseConfigured()) return { invoice: null, problem: NOT_CONFIGURED };
  const db = createClient(await cookies()) as any;

  const head = await db.from('invoices').select('*').eq('id', id).maybeSingle();
  if (head.error) return { invoice: null, problem: readProblem(head.error) };
  const inv = head.data as Record<string, any> | null;
  if (!inv) return { invoice: null, problem: null };

  const [client, lines, xero, sends, links, files] = await Promise.all([
    db
      .from('clients')
      .select('name, invoice_cc_emails, omit_event_dates_in_subject')
      .eq('id', inv['client_id'])
      .maybeSingle(),
    readAllPages<any>(
      (range) =>
        db
          .from('invoice_lines')
          .select(
            'id, sort, line_date, staff_name, employee_id, role_name, break_min, payable_min, hours, ' +
              'staff_count, quantity, rate, amount, kind, starts_at, ends_at',
          )
          .eq('invoice_id', id)
          .order('sort')
          .order('id')
          .range(range.from, range.to),
      { what: 'invoice lines', key: (row) => String(row.id) },
    ),
    db
      .from('xero_sync')
      .select('status, attempts, xero_invoice_id, xero_status, xero_total, last_error, synced_at')
      .eq('invoice_id', id)
      .maybeSingle(),
    db
      .from('invoice_sends')
      .select('id, created_at, sent_by, to_emails, cc_emails, bcc_emails, subject')
      .eq('invoice_id', id)
      .order('created_at', { ascending: false }),
    db
      .from('invoice_event_links')
      .select('events(id, title, event_date, venue_name)')
      .eq('invoice_id', id),
    inv['timesheet_job_id']
      ? db
          .from('timesheet_files')
          .select('storage_path, file_name, size_bytes')
          .eq('job_id', inv['timesheet_job_id'])
          .order('created_at')
      : Promise.resolve({ data: [], error: null }),
  ]);

  const error =
    client.error ?? lines.error ?? xero.error ?? sends.error ?? links.error ?? files.error;
  if (error) return { invoice: null, problem: readProblem(error) };

  // The sender's name: best effort — a profile the caller cannot read is just "Office".
  const senderIds = [
    ...new Set(((sends.data ?? []) as any[]).map((s) => s.sent_by).filter(Boolean)),
  ];
  const names = new Map<string, string>();
  if (senderIds.length > 0) {
    const profiles = await db.from('profiles').select('id, full_name').in('id', senderIds);
    for (const p of (profiles.data ?? []) as { id: string; full_name: string | null }[]) {
      if (p.full_name) names.set(p.id, p.full_name);
    }
  }

  const { excel, sources: fromAttachments } = attachmentsOf(inv['attachments']);
  const jobFiles: AttachmentRef[] = ((files.data ?? []) as any[]).map((f) => ({
    path: f.storage_path,
    name: f.file_name,
    size: f.size_bytes === null ? null : num(f.size_bytes),
  }));
  const sizeOf = new Map(jobFiles.map((f) => [f.path, f.size ?? null]));
  const sources = (fromAttachments.length > 0 ? fromAttachments : jobFiles).map((s) => ({
    ...s,
    size: s.size ?? sizeOf.get(s.path) ?? null,
  }));

  const billTo = (inv['bill_to'] ?? {}) as Record<string, unknown>;
  const lineRows: InvoiceLineRow[] = ((lines.data ?? []) as any[]).map((l) => ({
    id: Number(l.id),
    sort: l.sort,
    lineDate: l.line_date ?? null,
    staffName: l.staff_name ?? '',
    employeeId: l.employee_id ?? null,
    roleName: l.role_name ?? '',
    breakMin: l.break_min ?? 0,
    payableMin: l.payable_min ?? 0,
    hours: l.hours === null || l.hours === undefined ? null : num(l.hours),
    staffCount: l.staff_count ?? null,
    quantity: l.quantity === null || l.quantity === undefined ? null : num(l.quantity),
    rate: num(l.rate),
    amount: num(l.amount),
    kind: l.kind,
    startsAt: l.starts_at ?? null,
    endsAt: l.ends_at ?? null,
  }));
  const sendRows: InvoiceSendRow[] = ((sends.data ?? []) as any[]).map((s) => ({
    id: Number(s.id),
    at: s.created_at,
    by: s.sent_by ? (names.get(s.sent_by) ?? 'Office') : null,
    to: asStrings(s.to_emails),
    cc: asStrings(s.cc_emails),
    bcc: asStrings(s.bcc_emails),
    subject: s.subject,
  }));
  const events: LinkedEvent[] = ((links.data ?? []) as any[])
    .map((l) => (Array.isArray(l.events) ? l.events[0] : l.events))
    .filter(Boolean)
    .map((e: any) => ({
      id: e.id,
      title: e.title,
      date: e.event_date,
      venue: e.venue_name ?? null,
    }))
    .sort(
      (a: LinkedEvent, b: LinkedEvent) =>
        a.date.localeCompare(b.date) || a.title.localeCompare(b.title),
    );
  const x = xero.data as Record<string, any> | null;
  const xeroRow: XeroSyncRow | null = x
    ? {
        status: x['status'] as XeroStatus,
        attempts: x['attempts'] ?? 0,
        xeroInvoiceId: x['xero_invoice_id'] ?? null,
        xeroStatus: x['xero_status'] ?? null,
        xeroTotal:
          x['xero_total'] === null || x['xero_total'] === undefined ? null : num(x['xero_total']),
        lastError: x['last_error'] ?? null,
        syncedAt: x['synced_at'] ?? null,
      }
    : null;

  const format = billTo['format'];
  return {
    problem: null,
    invoice: {
      id: inv['id'],
      number: inv['number'],
      source: inv['source'] as InvoiceSource,
      status: inv['status'] as InvoiceStatus,
      invoiceDate: inv['invoice_date'],
      dueDate: inv['due_date'],
      periodFrom: inv['period_from'],
      periodTo: inv['period_to'],
      poNumber: inv['po_number'] ?? null,
      net: num(inv['net']),
      vat: num(inv['vat']),
      vatRate: num(inv['vat_rate']),
      total: num(inv['total']),
      payableMin: num(inv['payable_min']),
      termsDays: num(inv['terms_days']),
      createdAt: inv['created_at'],
      sentAt: inv['sent_at'] ?? inv['queued_at'] ?? null,
      voidedAt: inv['voided_at'] ?? null,
      voidReason: inv['void_reason'] ?? null,
      lastError: inv['last_error'] ?? null,
      timesheetJobId: inv['timesheet_job_id'] ?? null,
      clientId: inv['client_id'],
      clientName: (client.data as any)?.name ?? '—',
      billTo: {
        name: String(billTo['name'] ?? ''),
        contact: String(billTo['contact'] ?? ''),
        emails: asStrings(billTo['emails']),
        address: String(billTo['address'] ?? ''),
        venue: String(billTo['venue'] ?? ''),
        format: format === 'aggregated' || format === 'named' ? format : null,
        dateLabel: typeof billTo['dateLabel'] === 'string' ? (billTo['dateLabel'] as string) : null,
      },
      clientCcEmails: asStrings((client.data as any)?.invoice_cc_emails),
      omitEventDates: (client.data as any)?.omit_event_dates_in_subject === true,
      recipients: asStrings(inv['recipients']),
      hasPdf: Boolean(inv['storage_path']),
      fileName: inv['file_name'] ?? null,
      excel,
      sources,
      pdfPath: inv['storage_path'] ?? null,
      xero: xeroRow,
      lines: lineRows,
      sends: sendRows,
      events,
    },
  };
}

/** Who is composing (for From / Reply-To and the per-user Bcc memory). */
export async function loadComposer(): Promise<{ userId: string; email: string | null }> {
  if (!supabaseConfigured()) return { userId: 'anonymous', email: null };
  try {
    const db = createClient(await cookies()) as any;
    const { data } = await db.auth.getClaims();
    const claims = data?.claims as { sub?: string; email?: string } | undefined;
    return { userId: claims?.sub ?? 'anonymous', email: claims?.email ?? null };
  } catch {
    return { userId: 'anonymous', email: null };
  }
}
