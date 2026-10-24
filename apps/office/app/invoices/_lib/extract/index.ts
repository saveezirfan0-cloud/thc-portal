import { createAdminClient } from '@thc/db/admin';
import { toShiftInsert, type ShiftInsert } from './normalise';
import { createAnthropicScanReader, type ScanReader } from './scan';
import { parseWorkbook } from './sheets';
import type { ParsedRow } from './types';
import { readSpreadsheet, spreadsheetKind } from './workbook';

/**
 * ADR-0210 · timesheet extraction: uploaded files -> reviewable rows.
 *
 * Server-side, service role. Spreadsheets are parsed directly; scans
 * (PDF/JPG/PNG) are read by Claude vision. Rows land in `timesheet_shifts`
 * as 'extracted' (or 'flagged': low confidence or a problem; or 'rejected':
 * the client's non-THC staff). Pricing, hours from times and `issues` are
 * the database trigger's (timesheet_shift_compute) — nothing here prices.
 * The job goes uploaded|error -> extracting -> reviewing, or -> error with a
 * short code. Re-running replaces this job's un-invoiced, un-approved rows.
 * Needs ANTHROPIC_API_KEY for scans (not for spreadsheets).
 */

export const BATCH_SIZE = 200;

export interface JobRecord {
  id: string;
  client_id: string | null;
  status: string;
  notes: string | null;
}
export interface ClientRecord {
  timesheet_default_role: string | null;
  timesheet_excluded_staff: string[];
  invoice_format: string;
}
export interface FileRecord {
  id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
}
export interface InsertedRow {
  id: string;
  status: string;
  issues: string[];
}

/** The database seam; `supabaseStore()` is the real one, tests pass a fake. */
export interface ExtractStore {
  loadJob(jobId: string): Promise<JobRecord | null>;
  /** status -> 'extracting' through the legal transition; false when it lost a race. */
  claim(jobId: string, from: string): Promise<boolean>;
  loadClient(clientId: string): Promise<ClientRecord | null>;
  loadFiles(jobId: string): Promise<FileRecord[]>;
  download(path: string): Promise<Uint8Array>;
  deleteExtracted(jobId: string): Promise<void>;
  insert(rows: ShiftInsert[]): Promise<InsertedRow[]>;
  flag(ids: string[]): Promise<void>;
  finish(
    jobId: string,
    patch: { status: 'reviewing' | 'error'; notes?: string; error?: string },
  ): Promise<void>;
}

export interface ExtractDeps {
  store?: ExtractStore;
  scanReader?: ScanReader;
}

class ExtractionError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export async function runExtraction(jobId: string, deps: ExtractDeps = {}): Promise<void> {
  const store = deps.store ?? supabaseStore();
  const job = await store.loadJob(jobId);
  if (!job) throw new ExtractionError('job_not_found');
  if (job.status !== 'uploaded' && job.status !== 'error') {
    throw new ExtractionError('job_not_extractable');
  }
  if (!(await store.claim(job.id, job.status))) throw new ExtractionError('job_not_extractable');

  try {
    const client = job.client_id ? await store.loadClient(job.client_id) : null;
    const files = await store.loadFiles(job.id);
    if (!files.length) throw new ExtractionError('no_files');

    const parsed: { file: FileRecord; rows: ParsedRow[] }[] = [];
    let scanReader = deps.scanReader;
    for (const file of files) {
      parsed.push({
        file,
        rows: await readFile(store, file, () => (scanReader ??= createAnthropicScanReader())),
      });
    }

    const excluded = client?.timesheet_excluded_staff ?? [];
    const records: ShiftInsert[] = [];
    for (const { file, rows } of parsed) {
      for (const row of rows) {
        records.push(
          toShiftInsert(row, {
            jobId: job.id,
            fileId: file.id,
            sort: records.length,
            excludedStaff: excluded,
          }),
        );
      }
    }
    if (!records.length) throw new ExtractionError('no_rows_found');

    // Idempotent: only this job's un-approved, un-invoiced extraction rows go.
    await store.deleteExtracted(job.id);
    const toFlag: string[] = [];
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const inserted = await store.insert(records.slice(i, i + BATCH_SIZE));
      // The trigger found a problem (no_rate, no_hours ...): to review as flagged.
      for (const r of inserted) if (r.status === 'extracted' && r.issues.length) toFlag.push(r.id);
    }
    if (toFlag.length) await store.flag(toFlag);

    const flagged = records.filter((r) => r.status === 'flagged').length + toFlag.length;
    const rejected = records.filter((r) => r.status === 'rejected').length;
    const note = `Extracted ${records.length} row${records.length === 1 ? '' : 's'} from ${files.length} file${files.length === 1 ? '' : 's'}; ${flagged} need${flagged === 1 ? 's' : ''} a look${rejected ? `, ${rejected} excluded staff` : ''}.`;
    await store.finish(job.id, {
      status: 'reviewing',
      ...(job.notes && job.notes.trim() ? {} : { notes: note }),
    });
  } catch (error) {
    const code = error instanceof ExtractionError ? error.code : 'unexpected_error';
    console.warn('timesheet extraction did not complete:', code);
    await store.finish(job.id, { status: 'error', error: code });
  }
}

async function readFile(
  store: ExtractStore,
  file: FileRecord,
  scanReader: () => ScanReader,
): Promise<ParsedRow[]> {
  const kind = spreadsheetKind(file.file_name, file.mime_type);
  let bytes: Uint8Array;
  try {
    bytes = await store.download(file.storage_path);
  } catch {
    throw new ExtractionError('file_unavailable');
  }
  if (kind) {
    try {
      const grids = await readSpreadsheet(kind, bytes, file.file_name);
      return parseWorkbook(grids, file.file_name).rows;
    } catch (error) {
      throw new ExtractionError(
        error instanceof Error && error.message === 'unsupported_xls'
          ? 'unsupported_xls'
          : 'unreadable_spreadsheet',
      );
    }
  }
  const ext = file.file_name.toLowerCase().split('.').pop() ?? '';
  const scan =
    /pdf|image\/(jpe?g|png)/i.test(file.mime_type) || ['pdf', 'jpg', 'jpeg', 'png'].includes(ext);
  if (!scan) throw new ExtractionError('unsupported_file_type');
  const res = await scanReader().read({
    bytes,
    mimeType: file.mime_type,
    fileName: file.file_name,
  });
  if (!res.ok) throw new ExtractionError(`scan_${res.code}`.slice(0, 60));
  return res.rows;
}

// ---------------------------------------------------------------------
// Supabase store (service role). Table types are not generated yet for the
// timesheet tables, so the client is used untyped here.
// ---------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
export function supabaseStore(): ExtractStore {
  const db: any = createAdminClient();
  const fail = (label: string, error: { message?: string } | null) => {
    if (error) throw new ExtractionError(`db_${label}`);
  };
  return {
    async loadJob(jobId) {
      const { data, error } = await db
        .from('timesheet_jobs')
        .select('id, client_id, status, notes')
        .eq('id', jobId)
        .maybeSingle();
      fail('job', error);
      return (data as JobRecord | null) ?? null;
    },
    async claim(jobId, from) {
      const { data, error } = await db
        .from('timesheet_jobs')
        .update({ status: 'extracting', error: null })
        .eq('id', jobId)
        .eq('status', from)
        .select('id');
      fail('claim', error);
      return Array.isArray(data) && data.length === 1;
    },
    async loadClient(clientId) {
      const { data, error } = await db
        .from('clients')
        .select('timesheet_default_role, timesheet_excluded_staff, invoice_format')
        .eq('id', clientId)
        .maybeSingle();
      fail('client', error);
      return (data as ClientRecord | null) ?? null;
    },
    async loadFiles(jobId) {
      const { data, error } = await db
        .from('timesheet_files')
        .select('id, storage_path, file_name, mime_type')
        .eq('job_id', jobId)
        .order('created_at', { ascending: true });
      fail('files', error);
      return (data as FileRecord[] | null) ?? [];
    },
    async download(path) {
      const { data, error } = await db.storage.from('timesheets').download(path);
      if (error || !data) throw new ExtractionError('file_unavailable');
      return new Uint8Array(await (data as Blob).arrayBuffer());
    },
    async deleteExtracted(jobId) {
      const { error } = await db
        .from('timesheet_shifts')
        .delete()
        .eq('job_id', jobId)
        .eq('kind', 'shift')
        .is('invoice_id', null)
        .in('status', ['extracted', 'flagged', 'rejected']);
      fail('clear', error);
    },
    async insert(rows) {
      const { data, error } = await db
        .from('timesheet_shifts')
        .insert(rows)
        .select('id, status, issues');
      fail('insert', error);
      return (data as InsertedRow[] | null) ?? [];
    },
    async flag(ids) {
      for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const { error } = await db
          .from('timesheet_shifts')
          .update({ status: 'flagged' })
          .in('id', ids.slice(i, i + BATCH_SIZE))
          .eq('status', 'extracted');
        fail('flag', error);
      }
    },
    async finish(jobId, patch) {
      const { error } = await db
        .from('timesheet_jobs')
        .update({
          status: patch.status,
          ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
          error: patch.status === 'error' ? (patch.error ?? 'unexpected_error') : null,
        })
        .eq('id', jobId)
        .eq('status', 'extracting');
      fail('finish', error);
    },
  };
}
