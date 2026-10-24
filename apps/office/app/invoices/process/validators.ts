/**
 * Upload and Confirm validation (ADR-0210 · audit §2.2). Pure: the same
 * functions run in the browser (so the person is told before anything is
 * sent) and in the server actions (which never trust the browser).
 */
import type { ConfirmedGroup, InvoiceFormat } from './types';

export const MAX_FILES = 10;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const ACCEPTED_EXTENSIONS = ['xlsx', 'xls', 'csv', 'pdf', 'jpg', 'jpeg', 'png'] as const;
export const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.map((e) => `.${e}`).join(',');
export const FILE_HELP = 'Excel (.xlsx, .xls, .csv), PDF, or image (JPG, PNG) — max 25 MB each, up to 10 files.';

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

export interface FileMeta {
  name: string;
  size: number;
  type?: string;
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** The type we store: from the extension (browsers send '' or octet-stream for .csv/.xls). */
export function mimeFor(name: string): string {
  return MIME_BY_EXTENSION[extensionOf(name)] ?? 'application/octet-stream';
}

export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** One sentence per problem; an empty array means the files may be sent. */
export function validateFiles(files: readonly FileMeta[]): string[] {
  const errors: string[] = [];
  if (files.length === 0) errors.push('Choose at least one timesheet file.');
  if (files.length > MAX_FILES) {
    errors.push(`Upload up to ${MAX_FILES} files at a time (you chose ${files.length}).`);
  }
  for (const file of files) {
    const ext = extensionOf(file.name);
    if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(ext)) {
      errors.push(`${file.name}: only Excel, CSV, PDF, JPG and PNG files can be processed.`);
    } else if (file.size <= 0) {
      errors.push(`${file.name}: the file is empty.`);
    } else if (file.size > MAX_FILE_BYTES) {
      errors.push(`${file.name}: ${sizeLabel(file.size)} is over the 25 MB limit.`);
    }
  }
  return errors;
}

/** A storage-safe file name: no path, no spaces or odd characters, extension kept. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const ext = extensionOf(base);
  const stem = ext ? base.slice(0, -(ext.length + 1)) : base;
  const clean = stem
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 100);
  return `${clean || 'file'}${ext ? `.${ext}` : ''}`;
}

export function storagePathFor(jobId: string, fileId: string, fileName: string): string {
  return `timesheet-jobs/${jobId}/${fileId}-${safeFileName(fileName)}`;
}

// ---------------------------------------------------------------------
// Confirm
// ---------------------------------------------------------------------

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export interface GroupRules {
  poRequired: boolean;
  /** Every approved, not yet invoiced row of the job. */
  approvedIds: readonly string[];
}

export interface GroupProblem {
  /** Index into the groups array, or null for a problem with the set. */
  group: number | null;
  message: string;
}

/**
 * Mirrors `timesheet_job_confirm()` so the person is told which group is
 * wrong; the database still decides. Every approved row must be in exactly
 * one group — a row left out would keep the job open for ever.
 */
export function validateGroups(
  groups: readonly ConfirmedGroup[],
  rules: GroupRules,
): GroupProblem[] {
  const problems: GroupProblem[] = [];
  if (groups.length === 0) {
    return [{ group: null, message: 'There is nothing to invoice: approve at least one row.' }];
  }
  const seen = new Set<string>();
  const approved = new Set(rules.approvedIds);
  groups.forEach((g, i) => {
    const label = `Invoice ${i + 1}`;
    if (g.shiftIds.length === 0) {
      problems.push({ group: i, message: `${label} has no rows. Move rows into it or remove it.` });
    }
    if (rules.poRequired && g.poNumber.trim() === '') {
      problems.push({ group: i, message: `${label} needs a PO number — this client requires one.` });
    }
    if (!isIsoDate(g.invoiceDate)) {
      problems.push({ group: i, message: `${label}: enter the invoice date as dd/mm/yyyy.` });
    }
    if (!isIsoDate(g.eventDateStart) || !isIsoDate(g.eventDateEnd)) {
      problems.push({ group: i, message: `${label}: enter both event dates as dd/mm/yyyy.` });
    } else if (g.eventDateStart > g.eventDateEnd) {
      problems.push({ group: i, message: `${label}: the event dates run backwards.` });
    }
    if (g.format !== 'named' && g.format !== 'aggregated') {
      problems.push({ group: i, message: `${label}: choose a format.` });
    }
    for (const id of g.shiftIds) {
      if (seen.has(id)) {
        problems.push({ group: i, message: `${label}: a row is in two invoices.` });
      }
      seen.add(id);
      if (!approved.has(id)) {
        problems.push({ group: i, message: `${label} holds a row that is no longer approved.` });
      }
    }
  });
  const missing = rules.approvedIds.filter((id) => !seen.has(id)).length;
  if (missing > 0) {
    problems.push({
      group: null,
      message: `${missing} approved row${missing === 1 ? ' is' : 's are'} not in any invoice. Move ${
        missing === 1 ? 'it' : 'them'
      } into one.`,
    });
  }
  return problems;
}

export function asFormat(value: unknown, fallback: InvoiceFormat): InvoiceFormat {
  return value === 'named' || value === 'aggregated' ? value : fallback;
}

/** Normalises whatever the client sent into the shape the RPC takes. */
export function parseGroups(input: unknown, fallbackFormat: InvoiceFormat): ConfirmedGroup[] | null {
  if (!Array.isArray(input)) return null;
  const out: ConfirmedGroup[] = [];
  for (const raw of input) {
    if (typeof raw !== 'object' || raw === null) return null;
    const r = raw as Record<string, unknown>;
    if (!Array.isArray(r['shiftIds']) || !r['shiftIds'].every((x) => typeof x === 'string')) {
      return null;
    }
    out.push({
      poNumber: typeof r['poNumber'] === 'string' ? r['poNumber'].trim().slice(0, 100) : '',
      invoiceDate: typeof r['invoiceDate'] === 'string' ? r['invoiceDate'] : '',
      eventDateStart: typeof r['eventDateStart'] === 'string' ? r['eventDateStart'] : '',
      eventDateEnd: typeof r['eventDateEnd'] === 'string' ? r['eventDateEnd'] : '',
      format: asFormat(r['format'], fallbackFormat),
      shiftIds: r['shiftIds'] as string[],
    });
  }
  return out;
}
