/**
 * ADR-0210 · /invoices/process — the shapes the screens share.
 *
 * Plain data, no React: server loaders build these from the database rows
 * (timesheet_jobs / _files / _shifts, supabase/migrations/20261027100000)
 * and the client components receive them as props. Nothing here prices a
 * row — hours, rate, amount and issues are the database's
 * (`timesheet_shift_compute()`).
 */

export type JobStatus =
  'uploaded' | 'extracting' | 'reviewing' | 'confirmed' | 'complete' | 'error';
export type ShiftStatus = 'extracted' | 'flagged' | 'approved' | 'rejected';
export type ShiftKind = 'shift' | 'custom';
export type InvoiceFormat = 'named' | 'aggregated';

export interface TimesheetClient {
  id: string;
  name: string;
  invoiceFormat: InvoiceFormat;
  poRequired: boolean;
  defaultRole: string | null;
}

/** One group Confirm records (`timesheet_jobs.confirmed_groups`). */
export interface ConfirmedGroup {
  poNumber: string;
  /** yyyy-mm-dd */
  invoiceDate: string;
  eventDateStart: string;
  eventDateEnd: string;
  format: InvoiceFormat;
  shiftIds: string[];
}

export interface JobSummary {
  id: string;
  clientId: string | null;
  clientName: string;
  status: JobStatus;
  error: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  fileNames: string[];
  rowCount: number | null;
  approvedCount: number | null;
}

export interface FileRow {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
}

export interface ShiftRow {
  id: string;
  fileId: string | null;
  sort: number;
  kind: ShiftKind;
  status: ShiftStatus;
  staffName: string;
  staffRef: string | null;
  /** yyyy-mm-dd */
  workDate: string | null;
  roleName: string | null;
  /** HH:MM (24-hour), the way the database stores a `time` once trimmed. */
  startTime: string | null;
  endTime: string | null;
  breakMin: number;
  hours: number | null;
  staffCount: number;
  quantity: number | null;
  description: string | null;
  rate: number | null;
  amount: number | null;
  issues: string[];
  confidence: number | null;
  source: ShiftSource | null;
  invoiceId: string | null;
}

export type ShiftSource =
  | { type: 'excel'; sheet: string; row: number }
  | { type: 'pdf-table'; page: number }
  | { type: 'manual' };

/** A worksheet shown read-only beside the rows. */
export interface SheetPreview {
  name: string;
  rows: string[][];
  truncated: boolean;
}

export interface SourceFile {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  kind: 'pdf' | 'image' | 'sheet' | 'other';
  /** Short-lived signed URL (download / inline viewer). Null when it could not be made. */
  url: string | null;
  sheets: SheetPreview[];
  /** Why there is no table to show (an .xls, a file too big, a read error). */
  previewNote: string | null;
}

export interface IssuedInvoice {
  id: string;
  number: number;
  status: string;
  source: string;
  poNumber: string | null;
  total: number;
  net: number;
  vat: number;
  invoiceDate: string;
  format: InvoiceFormat;
  clientName: string;
  lastError: string | null;
  /** A 'drawing' invoice nobody is drawing any more (lease gone). */
  stale: boolean;
}

export interface PoDuplicate {
  poNumber: string;
  invoiceNumber: number;
  invoiceDate: string;
  status: string;
}

export interface JobDetail {
  job: {
    id: string;
    clientId: string | null;
    status: JobStatus;
    error: string | null;
    notes: string | null;
    createdAt: string;
    confirmedGroups: ConfirmedGroup[] | null;
  };
  client: TimesheetClient | null;
  files: FileRow[];
  shifts: ShiftRow[];
}
