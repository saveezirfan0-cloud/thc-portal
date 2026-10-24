/**
 * Row shapes for /invoices and /invoices/:invoiceId (ADR-0210).
 *
 * Read through the caller's own RLS client: `invoices`, `invoice_lines`,
 * `invoice_sends` and `xero_sync` all carry the `admin_finance_read` policy
 * (20261022100000, 20261027100000), so a scheduler reads nothing and the
 * page says so before it asks.
 */

export type InvoiceSource = 'events' | 'timesheet';
export type InvoiceStatus = 'drawing' | 'failed' | 'generated' | 'queued' | 'void';
export type XeroStatus = 'pending' | 'syncing' | 'synced' | 'mismatch' | 'failed' | 'skipped';
export type ClientActionResult = { ok: true } | { ok: false; message: string };

/** One row of the list: the columns the table, the KPIs and the summaries need. */
export interface InvoiceListRow {
  id: string;
  number: number;
  invoiceDate: string;
  clientId: string;
  clientName: string;
  venue: string;
  poNumber: string | null;
  source: InvoiceSource;
  /** Timesheet invoices: named | aggregated. Event invoices: the sign-in log. */
  format: 'named' | 'aggregated' | 'log';
  status: InvoiceStatus;
  payableMin: number;
  net: number;
  vat: number;
  total: number;
  /** When it was emailed: `sent_at` (timesheet) or `queued_at` (events). */
  lastSentAt: string | null;
  xero: XeroStatus | null;
  xeroInvoiceId: string | null;
}

export interface ClientOption {
  id: string;
  name: string;
}

/** The raw shape PostgREST returns for the list read (embedded one-to-one / one-to-many). */
export interface RawInvoiceListRow {
  id: string;
  number: number;
  invoice_date: string;
  client_id: string;
  po_number: string | null;
  source: InvoiceSource;
  status: InvoiceStatus;
  payable_min: number | string | null;
  net: number | string;
  vat: number | string;
  total: number | string;
  sent_at: string | null;
  queued_at: string | null;
  bill_to: { name?: string; venue?: string; format?: string } | null;
  clients: { name: string } | { name: string }[] | null;
  xero_sync:
    | { status: XeroStatus; xero_invoice_id: string | null }
    | { status: XeroStatus; xero_invoice_id: string | null }[]
    | null;
  invoice_event_links?: { events: { venue_name: string | null } | { venue_name: string | null }[] | null }[] | null;
}

export interface InvoiceLineRow {
  id: number;
  sort: number;
  lineDate: string | null;
  staffName: string;
  employeeId: number | null;
  roleName: string;
  breakMin: number;
  payableMin: number;
  hours: number | null;
  staffCount: number | null;
  quantity: number | null;
  rate: number;
  amount: number;
  kind: string;
  startsAt: string | null;
  endsAt: string | null;
}

export interface InvoiceSendRow {
  id: number;
  at: string;
  by: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
}

export interface LinkedEvent {
  id: string;
  title: string;
  date: string;
  venue: string | null;
}

export interface AttachmentRef {
  path: string;
  name: string;
  /** Bytes, when known (timesheet_files). */
  size?: number | null;
}

export interface XeroSyncRow {
  status: XeroStatus;
  attempts: number;
  xeroInvoiceId: string | null;
  xeroStatus: string | null;
  xeroTotal: number | null;
  lastError: string | null;
  syncedAt: string | null;
}

export interface InvoiceDetail {
  id: string;
  number: number;
  source: InvoiceSource;
  status: InvoiceStatus;
  invoiceDate: string;
  dueDate: string;
  periodFrom: string;
  periodTo: string;
  poNumber: string | null;
  net: number;
  vat: number;
  vatRate: number;
  total: number;
  payableMin: number;
  termsDays: number;
  createdAt: string;
  sentAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  lastError: string | null;
  timesheetJobId: string | null;
  clientId: string;
  clientName: string;
  billTo: {
    name: string;
    contact: string;
    emails: string[];
    address: string;
    venue: string;
    format: 'named' | 'aggregated' | null;
    dateLabel: string | null;
  };
  /** The client card's CC list and the "omit event dates" tick (for the email's defaults). */
  clientCcEmails: string[];
  omitEventDates: boolean;
  recipients: string[];
  hasPdf: boolean;
  fileName: string | null;
  /** Excel (timesheet invoices): `attachments.excel`. */
  excel: AttachmentRef | null;
  /** The original timesheet files, `attachments.sources` or the job's files. */
  sources: AttachmentRef[];
  pdfPath: string | null;
  xero: XeroSyncRow | null;
  lines: InvoiceLineRow[];
  sends: InvoiceSendRow[];
  events: LinkedEvent[];
}
