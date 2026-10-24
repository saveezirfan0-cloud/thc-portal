/* eslint-disable @typescript-eslint/no-explicit-any -- see _lib/db.ts */
import { readProblem } from '../../_lib/dbError';
import { BUCKET, officeDb, storageAdmin } from './_lib/db';
import { readSheets } from './_lib/sheets';
import { extensionOf } from './validators';
import type {
  ConfirmedGroup,
  FileRow,
  InvoiceFormat,
  IssuedInvoice,
  JobDetail,
  JobStatus,
  JobSummary,
  ShiftRow,
  SourceFile,
  TimesheetClient,
} from './types';

/** Mapping, kept out of the loaders so the tests can feed rows straight in. */
export function toClient(r: any): TimesheetClient {
  return {
    id: r.id,
    name: r.name,
    invoiceFormat: r.invoice_format === 'aggregated' ? 'aggregated' : 'named',
    poRequired: Boolean(r.po_required),
    defaultRole: r.timesheet_default_role ?? null,
  };
}

const clock = (v: unknown): string | null =>
  typeof v === 'string' && v.length >= 5 ? v.slice(0, 5) : null;
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export function toShift(r: any): ShiftRow {
  return {
    id: r.id,
    fileId: r.file_id ?? null,
    sort: r.sort ?? 0,
    kind: r.kind === 'custom' ? 'custom' : 'shift',
    status: r.status,
    staffName: r.staff_name ?? '',
    staffRef: r.staff_ref ?? null,
    workDate: r.work_date ?? null,
    roleName: r.role_name ?? null,
    startTime: clock(r.start_time),
    endTime: clock(r.end_time),
    breakMin: r.break_min ?? 0,
    hours: num(r.hours),
    staffCount: r.staff_count ?? 1,
    quantity: num(r.quantity),
    description: r.description ?? null,
    rate: num(r.rate),
    amount: num(r.amount),
    issues: Array.isArray(r.issues) ? r.issues : [],
    confidence: num(r.confidence),
    source: r.source && typeof r.source === 'object' ? r.source : null,
    invoiceId: r.invoice_id ?? null,
  };
}

export const SHIFT_COLUMNS =
  'id,file_id,sort,kind,status,staff_name,staff_ref,work_date,role_name,start_time,end_time,break_min,hours,staff_count,quantity,description,rate,amount,issues,confidence,source,invoice_id';

const CLIENT_COLUMNS = 'id,name,invoice_format,po_required,timesheet_default_role';

// ---------------------------------------------------------------------
// /invoices/process
// ---------------------------------------------------------------------

export interface HomeData {
  clients: TimesheetClient[];
  needsReview: JobSummary[];
  recent: JobSummary[];
  problem: string | null;
}

const JOB_LIST =
  'id,client_id,status,error,notes,created_at,updated_at,clients(name),timesheet_files(file_name),rows:timesheet_shifts(count),approved:timesheet_shifts(count)';

export function toJobSummary(r: any): JobSummary {
  const count = (v: any): number | null =>
    Array.isArray(v) && v[0] && typeof v[0].count === 'number' ? v[0].count : null;
  return {
    id: r.id,
    clientId: r.client_id ?? null,
    clientName: r.clients?.name ?? 'No client',
    status: r.status as JobStatus,
    error: r.error ?? null,
    notes: r.notes ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    fileNames: Array.isArray(r.timesheet_files)
      ? r.timesheet_files.map((f: any) => f.file_name)
      : [],
    rowCount: count(r.rows),
    approvedCount: count(r.approved),
  };
}

export async function loadHome(): Promise<HomeData> {
  const db = await officeDb();
  const [clients, review, recent] = await Promise.all([
    db
      .from('clients')
      .select(CLIENT_COLUMNS)
      .eq('invoicing_mode', 'timesheet')
      .is('archived_at', null)
      .order('name'),
    db
      .from('timesheet_jobs')
      .select(JOB_LIST)
      .eq('status', 'reviewing')
      .eq('approved.status', 'approved')
      .order('created_at', { ascending: true })
      .limit(100),
    db
      .from('timesheet_jobs')
      .select(JOB_LIST)
      .neq('status', 'reviewing')
      .eq('approved.status', 'approved')
      .order('created_at', { ascending: false })
      .limit(15),
  ]);
  const error = clients.error ?? review.error ?? recent.error;
  return {
    clients: ((clients.data ?? []) as any[]).map(toClient),
    needsReview: ((review.data ?? []) as any[]).map(toJobSummary),
    recent: ((recent.data ?? []) as any[]).map(toJobSummary),
    problem: readProblem(error, 'Timesheet jobs could not be read'),
  };
}

// ---------------------------------------------------------------------
// /invoices/process/[jobId]
// ---------------------------------------------------------------------

const PAGE = 1000;
const ROW_CEILING = 5000;

/** Every row of a job, page by page (PostgREST answers at most 1000). */
export async function loadShiftRows(
  db: any,
  jobId: string,
): Promise<{ rows: ShiftRow[]; error: { message: string } | null }> {
  const rows: ShiftRow[] = [];
  for (let from = 0; from < ROW_CEILING; from += PAGE) {
    const page = await db
      .from('timesheet_shifts')
      .select(SHIFT_COLUMNS)
      .eq('job_id', jobId)
      .order('sort')
      .order('id')
      .range(from, from + PAGE - 1);
    if (page.error) return { rows, error: page.error };
    const data = (page.data ?? []) as any[];
    rows.push(...data.map(toShift));
    if (data.length < PAGE) break;
  }
  return { rows, error: null };
}

export async function loadJob(
  jobId: string,
): Promise<{ detail: JobDetail | null; problem: string | null }> {
  const db = await officeDb();
  const jobRes = await db
    .from('timesheet_jobs')
    .select('id,client_id,status,notes,error,confirmed_groups,created_at')
    .eq('id', jobId)
    .maybeSingle();
  if (jobRes.error)
    return { detail: null, problem: readProblem(jobRes.error, 'The job could not be read') };
  if (!jobRes.data) return { detail: null, problem: null };
  const job = jobRes.data;

  const [clientRes, filesRes] = await Promise.all([
    job.client_id
      ? db.from('clients').select(CLIENT_COLUMNS).eq('id', job.client_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db
      .from('timesheet_files')
      .select('id,file_name,mime_type,size_bytes,storage_path')
      .eq('job_id', jobId)
      .order('created_at')
      .order('id'),
  ]);

  let shifts: ShiftRow[] = [];
  let shiftError: { message: string } | null = null;
  // Only a job past extraction has rows worth reading.
  if (job.status !== 'uploaded') {
    const read = await loadShiftRows(db, jobId);
    shifts = read.rows;
    shiftError = read.error;
  }

  const files: FileRow[] = ((filesRes.data ?? []) as any[]).map((f) => ({
    id: f.id,
    fileName: f.file_name,
    mimeType: f.mime_type,
    sizeBytes: Number(f.size_bytes),
    storagePath: f.storage_path,
  }));

  return {
    detail: {
      job: {
        id: job.id,
        clientId: job.client_id ?? null,
        status: job.status as JobStatus,
        error: job.error ?? null,
        notes: job.notes ?? null,
        createdAt: job.created_at,
        confirmedGroups: Array.isArray(job.confirmed_groups)
          ? (job.confirmed_groups as ConfirmedGroup[])
          : null,
      },
      client: clientRes.data ? toClient(clientRes.data) : null,
      files,
      shifts,
    },
    problem: readProblem(
      clientRes.error ?? filesRes.error ?? shiftError,
      'The job could not be read',
    ),
  };
}

/** Signed for half an hour: long enough to review, short enough to expire. */
const SIGNED_SECONDS = 30 * 60;

function kindOf(mime: string, ext: string): SourceFile['kind'] {
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (['xlsx', 'xls', 'csv'].includes(ext)) return 'sheet';
  return 'other';
}

export async function loadSources(files: readonly FileRow[]): Promise<SourceFile[]> {
  const storage = storageAdmin().storage.from(BUCKET);
  return Promise.all(
    files.map(async (file): Promise<SourceFile> => {
      const ext = extensionOf(file.fileName);
      const kind = kindOf(file.mimeType, ext);
      let url: string | null = null;
      try {
        const signed = await storage.createSignedUrl(file.storagePath, SIGNED_SECONDS, {
          download: false,
        });
        url = signed.data?.signedUrl ?? null;
      } catch {
        url = null;
      }
      let sheets: SourceFile['sheets'] = [];
      let previewNote: string | null = null;
      if (kind === 'sheet') {
        try {
          const blob = await storage.download(file.storagePath);
          if (blob.error || !blob.data) {
            previewNote = 'The file could not be opened for a preview — use Download.';
          } else {
            const read = await readSheets(Buffer.from(await blob.data.arrayBuffer()), ext);
            if (read.ok) sheets = read.sheets;
            else previewNote = read.note;
          }
        } catch {
          previewNote = 'The file could not be opened for a preview — use Download.';
        }
      }
      return {
        id: file.id,
        fileName: file.fileName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        kind,
        url,
        sheets,
        previewNote,
      };
    }),
  );
}

export function toInvoice(r: any, now: number = Date.now()): IssuedInvoice {
  const created = Date.parse(r.created_at ?? '');
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    source: r.source,
    poNumber: r.po_number ?? null,
    total: Number(r.total ?? 0),
    net: Number(r.net ?? 0),
    vat: Number(r.vat ?? 0),
    invoiceDate: r.invoice_date,
    format: (r.bill_to?.format === 'aggregated' ? 'aggregated' : 'named') as InvoiceFormat,
    clientName: r.bill_to?.name ?? '',
    lastError: r.last_error ?? null,
    stale: r.status === 'drawing' && Number.isFinite(created) && now - created > 2 * 60_000,
  };
}

export async function loadJobInvoices(
  jobId: string,
): Promise<{ invoices: IssuedInvoice[]; problem: string | null }> {
  const db = await officeDb();
  const res = await db
    .from('invoices')
    .select(
      'id,number,status,source,po_number,total,net,vat,invoice_date,bill_to,last_error,created_at',
    )
    .eq('timesheet_job_id', jobId)
    .order('number');
  return {
    invoices: ((res.data ?? []) as any[]).map((r) => toInvoice(r)),
    problem: readProblem(res.error, 'The invoices could not be read'),
  };
}

export async function loadVatRate(): Promise<number> {
  const db = await officeDb();
  const res = await db.from('settings').select('value').eq('key', 'invoicing').maybeSingle();
  const rate = Number(res.data?.value?.vat_rate);
  return Number.isFinite(rate) && rate >= 0 ? rate : 20;
}

/** Every client set up for timesheet invoicing (the picker, Change client). */
export async function loadTimesheetClients(): Promise<{
  clients: TimesheetClient[];
  problem: string | null;
}> {
  const db = await officeDb();
  const res = await db
    .from('clients')
    .select(CLIENT_COLUMNS)
    .eq('invoicing_mode', 'timesheet')
    .is('archived_at', null)
    .order('name');
  return {
    clients: ((res.data ?? []) as any[]).map(toClient),
    problem: readProblem(res.error, 'Clients could not be read'),
  };
}
