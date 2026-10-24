'use server';

/* eslint-disable @typescript-eslint/no-explicit-any -- see _lib/db.ts */
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { currentOfficeRole } from '../../_components/officeUser';
import { explainDbError } from '../../_lib/dbError';
import { officeCan } from '../../_lib/permissions';
import { READ_ONLY_MESSAGE } from '../../_lib/sessionRole';
import { drawInvoice, runExtraction } from './_lib/bridges';
import { BUCKET, officeDb, storageAdmin, supabaseConfigured } from './_lib/db';
import { SHIFT_COLUMNS, loadShiftRows, toClient, toShift } from './data';
import {
  blockers,
  buildShiftUpdate,
  isCleanForApproval,
  issuedGroupIndexes,
  issueLabel,
  nextSort,
} from './view-model';
import type { ShiftPatch } from './view-model';
import {
  MAX_FILE_BYTES,
  mimeFor,
  parseGroups,
  safeFileName,
  storagePathFor,
  validateFiles,
  validateGroups,
} from './validators';
import type { FileMeta } from './validators';
import type { ConfirmedGroup, PoDuplicate, ShiftRow, ShiftStatus, TimesheetClient } from './types';

type Failure = { error: string };

const NO_PROJECT = 'This environment has no Supabase project.';
const NOT_FINANCE =
  'Timesheet invoicing is for owners and managers. Ask an owner if you need it.';

/** Words for the codes `20261027100000_timesheet_invoicing.sql` raises. */
const CODES: Readonly<Record<string, string>> = {
  shift_invoiced: 'That row is already on an invoice and cannot change.',
  job_not_reviewing: 'This job is no longer in review. Refresh the page to see where it is.',
  job_not_confirmed: 'This job is not waiting to be generated. Refresh the page.',
  job_not_found: 'That job no longer exists.',
  job_has_no_client: 'Choose a client for this job first.',
  client_not_timesheet: 'This client is not set up for timesheet invoicing (client card, Invoicing).',
  po_required: 'This client needs a PO number on every invoice.',
  no_invoice_groups: 'There is nothing to invoice: approve at least one row.',
  empty_invoice_group: 'An invoice has no rows. Move rows into it or remove it.',
  shift_in_two_groups: 'A row is in two invoices. Each row belongs to one.',
  shift_not_approved: 'A row in this invoice is no longer approved. Refresh the page and check.',
  group_not_confirmed: 'That invoice was not part of the confirmed set. Go back and confirm again.',
  illegal_timesheet_job_transition: 'The job cannot move to that step from where it is. Refresh the page.',
  invalid_invoice_format: 'Choose Named staff or Role aggregated.',
  not_permitted: 'Your office role does not allow this. Ask an owner.',
};

function explain(error: { code?: string | null; message: string; details?: string | null }): string {
  return explainDbError(error, { codes: CODES, log: '[invoices/process]' });
}

/** shift_incomplete carries the reasons in `details`: "no_hours,no_rate". */
function incompleteMessage(details: string | null | undefined, verb: string): string {
  const reasons = (details ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(issueLabel);
  return reasons.length > 0
    ? `${verb}: ${reasons.join(', ').toLowerCase()}. Fix the highlighted cells first.`
    : `${verb}: the row is incomplete. Fix the highlighted cells first.`;
}

const isIncomplete = (e: { message: string }) => e.message.includes('shift_incomplete');

async function guard(): Promise<Failure | null> {
  if (!supabaseConfigured()) return { error: NO_PROJECT };
  const role = await currentOfficeRole();
  if (role && !officeCan(role, 'finance')) return { error: NOT_FINANCE };
  if (role && !officeCan(role, 'write')) return { error: READ_ONLY_MESSAGE };
  return null;
}

function refresh(jobId?: string): void {
  revalidatePath('/invoices/process');
  if (jobId) revalidatePath(`/invoices/process/${jobId}`);
}

/** Reads after the response; outside a request scope `after()` throws, so run it plainly. */
function extractLater(jobId: string): void {
  const run = () =>
    runExtraction(jobId).catch((e: unknown) => {
      console.error('[invoices/process] extraction failed', jobId, e);
    });
  try {
    after(run);
  } catch {
    void run();
  }
}

// ---------------------------------------------------------------------
// 1 · Upload
//
// The files go straight from the browser to the private `timesheets`
// bucket on signed upload URLs: 10 × 25 MB cannot pass through a server
// action (Vercel's body limit is 4.5 MB). The server still decides
// everything — it validates the declared files before signing, and checks
// what actually arrived (kind of object, real size) before the job exists.
// ---------------------------------------------------------------------

export interface UploadPlan {
  jobId: string;
  uploads: { fileId: string; name: string; path: string; token: string }[];
}

async function timesheetClient(db: any, clientId: string): Promise<TimesheetClient | Failure> {
  const res = await db
    .from('clients')
    .select('id,name,invoice_format,po_required,timesheet_default_role,invoicing_mode,archived_at')
    .eq('id', clientId)
    .maybeSingle();
  if (res.error) return { error: explain(res.error) };
  if (!res.data) return { error: 'Choose a client.' };
  if (res.data.invoicing_mode !== 'timesheet') {
    return { error: CODES['client_not_timesheet']! };
  }
  return toClient(res.data);
}

export async function startUpload(input: {
  clientId: string;
  files: FileMeta[];
}): Promise<UploadPlan | Failure> {
  const denied = await guard();
  if (denied) return denied;
  if (!input.clientId) return { error: 'Choose a client.' };
  const problems = validateFiles(input.files);
  if (problems.length > 0) return { error: problems.join(' ') };

  const db = await officeDb();
  const client = await timesheetClient(db, input.clientId);
  if ('error' in client) return client;

  const jobId = randomUUID();
  const storage = storageAdmin().storage.from(BUCKET);
  const uploads: UploadPlan['uploads'] = [];
  for (const file of input.files) {
    const fileId = randomUUID();
    const path = storagePathFor(jobId, fileId, file.name);
    const signed = await storage.createSignedUploadUrl(path);
    if (signed.error || !signed.data?.token) {
      return { error: 'The upload could not be started. Try again in a minute.' };
    }
    uploads.push({ fileId, name: file.name, path, token: signed.data.token });
  }
  return { jobId, uploads };
}

export interface UploadedFile extends FileMeta {
  fileId: string;
}

/**
 * The browser has put the files in the bucket: check them, create the job
 * and its file rows, read the files after the response, and go to the job.
 */
export async function finishUpload(input: {
  jobId: string;
  clientId: string;
  notes: string;
  files: UploadedFile[];
}): Promise<Failure> {
  const denied = await guard();
  if (denied) return denied;
  const problems = validateFiles(input.files);
  if (problems.length > 0) return { error: problems.join(' ') };
  if (!/^[0-9a-f-]{36}$/i.test(input.jobId)) return { error: 'That upload was not recognised.' };

  const db = await officeDb();
  const storage = storageAdmin().storage.from(BUCKET);
  const folder = `timesheet-jobs/${input.jobId}`;
  const remove = async () => {
    await storage
      .remove(input.files.map((f) => storagePathFor(input.jobId, f.fileId, f.name)))
      .catch(() => undefined);
  };

  const client = await timesheetClient(db, input.clientId);
  if ('error' in client) {
    await remove();
    return client;
  }

  // What actually arrived, by the bucket's own account.
  const listed = await storage.list(folder, { limit: 100 });
  const actual = new Map<string, number>();
  for (const obj of (listed.data ?? []) as { name: string; metadata?: { size?: number } }[]) {
    actual.set(obj.name, Number(obj.metadata?.size ?? 0));
  }
  const rows = [];
  for (const file of input.files) {
    const path = storagePathFor(input.jobId, file.fileId, file.name);
    const size = actual.get(path.slice(folder.length + 1));
    if (size === undefined || size <= 0) {
      await remove();
      return { error: `${file.name} did not finish uploading. Try again.` };
    }
    if (size > MAX_FILE_BYTES) {
      await remove();
      return { error: `${file.name} is over the 25 MB limit.` };
    }
    rows.push({
      id: file.fileId,
      job_id: input.jobId,
      storage_path: path,
      file_name: safeFileName(file.name),
      mime_type: mimeFor(file.name),
      size_bytes: size,
    });
  }

  const notes = input.notes.trim().slice(0, 1000);
  const job = await db
    .from('timesheet_jobs')
    .insert({ id: input.jobId, client_id: input.clientId, notes: notes || null })
    .select('id')
    .maybeSingle();
  if (job.error) {
    await remove();
    return { error: explain(job.error) };
  }
  const files = await db.from('timesheet_files').insert(rows);
  if (files.error) {
    await db
      .from('timesheet_jobs')
      .update({ status: 'error', error: 'The uploaded files could not be recorded.' })
      .eq('id', input.jobId);
    await remove();
    return { error: explain(files.error) };
  }

  extractLater(input.jobId);
  refresh();
  redirect(`/invoices/process/${input.jobId}`);
}

/** The browser could not finish: clear what it left in the bucket (never a real job's files). */
export async function abandonUpload(jobId: string, paths: string[]): Promise<{ ok: true } | Failure> {
  const denied = await guard();
  if (denied) return denied;
  const db = await officeDb();
  const exists = await db.from('timesheet_jobs').select('id').eq('id', jobId).maybeSingle();
  if (exists.data) return { ok: true };
  const prefix = `timesheet-jobs/${jobId}/`;
  const mine = paths.filter((p) => p.startsWith(prefix) && !p.includes('..'));
  if (mine.length > 0) await storageAdmin().storage.from(BUCKET).remove(mine).catch(() => undefined);
  return { ok: true };
}

/** Error → read the files again. runExtraction() makes the error → extracting move itself. */
export async function retryExtraction(jobId: string): Promise<{ ok: true } | Failure> {
  const denied = await guard();
  if (denied) return denied;
  const db = await officeDb();
  const job = await db.from('timesheet_jobs').select('id,status').eq('id', jobId).maybeSingle();
  if (job.error) return { error: explain(job.error) };
  if (!job.data) return { error: CODES['job_not_found']! };
  if (job.data.status !== 'error') {
    return { error: 'This job is not in an error state, so there is nothing to retry.' };
  }
  extractLater(jobId);
  refresh(jobId);
  return { ok: true };
}

// ---------------------------------------------------------------------
// 2 · Review
// ---------------------------------------------------------------------

export type RowResult = { ok: true; row: ShiftRow; notice?: string } | (Failure & { row?: ShiftRow });

async function readShift(db: any, jobId: string, shiftId: string) {
  const res = await db
    .from('timesheet_shifts')
    .select(SHIFT_COLUMNS)
    .eq('id', shiftId)
    .eq('job_id', jobId)
    .maybeSingle();
  return res as { data: any; error: any };
}

/** Edit one cell(s). The trigger recomputes hours, rate, amount and issues; the row is read back. */
export async function updateShift(jobId: string, shiftId: string, patch: ShiftPatch): Promise<RowResult> {
  const denied = await guard();
  if (denied) return denied;
  const db = await officeDb();
  const current = await readShift(db, jobId, shiftId);
  if (current.error) return { error: explain(current.error) };
  if (!current.data) return { error: 'That row no longer exists. Refresh the page.' };
  const before = toShift(current.data);

  const built = buildShiftUpdate(before, patch);
  if (!built.ok) return { error: built.error, row: before };

  const write = (set: Record<string, unknown>) =>
    db.from('timesheet_shifts').update(set).eq('id', shiftId).eq('job_id', jobId).select(SHIFT_COLUMNS).maybeSingle();

  let res = await write(built.set);
  let notice: string | undefined;
  if (res.error && isIncomplete(res.error) && before.status === 'approved') {
    // The correction leaves an approved row incomplete: it goes back to Extracted, not lost.
    res = await write({ ...built.set, status: 'extracted' });
    if (!res.error) notice = 'That change left the row incomplete, so it is back to Extracted.';
  }
  if (res.error) {
    return {
      error: isIncomplete(res.error) ? incompleteMessage(res.error.details, 'That leaves the row incomplete') : explain(res.error),
      row: before,
    };
  }
  if (!res.data) return { error: 'That row no longer exists. Refresh the page.', row: before };
  return { ok: true, row: toShift(res.data), ...(notice ? { notice } : {}) };
}

export async function setShiftStatus(
  jobId: string,
  shiftId: string,
  status: Extract<ShiftStatus, 'approved' | 'rejected' | 'extracted'>,
): Promise<RowResult> {
  const denied = await guard();
  if (denied) return denied;
  if (!['approved', 'rejected', 'extracted'].includes(status)) return { error: 'Unknown status.' };
  const db = await officeDb();
  const current = await readShift(db, jobId, shiftId);
  if (current.error) return { error: explain(current.error) };
  if (!current.data) return { error: 'That row no longer exists. Refresh the page.' };
  const before = toShift(current.data);
  if (before.invoiceId) return { error: CODES['shift_invoiced']!, row: before };

  const res = await db
    .from('timesheet_shifts')
    .update({ status })
    .eq('id', shiftId)
    .eq('job_id', jobId)
    .select(SHIFT_COLUMNS)
    .maybeSingle();
  if (res.error) {
    if (isIncomplete(res.error)) {
      const why = res.error.details ? incompleteMessage(res.error.details, 'Cannot approve this row') : null;
      return {
        error: why ?? `Cannot approve this row: ${blockers(before).join(', ').toLowerCase() || 'it is incomplete'}.`,
        row: before,
      };
    }
    return { error: explain(res.error), row: before };
  }
  if (!res.data) return { error: 'That row no longer exists. Refresh the page.', row: before };
  return { ok: true, row: toShift(res.data) };
}

export async function approveAllClean(
  jobId: string,
): Promise<{ ok: true; approved: number; rows: ShiftRow[] } | Failure> {
  const denied = await guard();
  if (denied) return denied;
  const db = await officeDb();
  const read = await loadShiftRows(db, jobId);
  if (read.error) return { error: explain(read.error) };
  const ids = read.rows.filter(isCleanForApproval).map((r) => r.id);
  for (let i = 0; i < ids.length; i += 100) {
    const res = await db
      .from('timesheet_shifts')
      .update({ status: 'approved' })
      .eq('job_id', jobId)
      .in('id', ids.slice(i, i + 100));
    if (res.error) {
      return { error: isIncomplete(res.error) ? incompleteMessage(res.error.details, 'A row is incomplete') : explain(res.error) };
    }
  }
  const after = await loadShiftRows(db, jobId);
  if (after.error) return { error: explain(after.error) };
  return { ok: true, approved: ids.length, rows: after.rows };
}

export async function addRow(
  jobId: string,
  kind: 'shift' | 'custom',
  fileId?: string | null,
): Promise<RowResult> {
  const denied = await guard();
  if (denied) return denied;
  const db = await officeDb();
  const read = await loadShiftRows(db, jobId);
  if (read.error) return { error: explain(read.error) };
  const base =
    kind === 'custom'
      ? { kind, quantity: 1, description: null, staff_name: '' }
      : { kind, staff_name: '' };
  const res = await db
    .from('timesheet_shifts')
    .insert({
      ...base,
      job_id: jobId,
      file_id: fileId ?? null,
      sort: nextSort(read.rows),
      status: 'extracted',
      source: { type: 'manual' },
    })
    .select(SHIFT_COLUMNS)
    .maybeSingle();
  if (res.error) return { error: explain(res.error) };
  if (!res.data) return { error: 'The row could not be added.' };
  return { ok: true, row: toShift(res.data) };
}

export async function deleteRow(jobId: string, shiftId: string): Promise<{ ok: true } | Failure> {
  const denied = await guard();
  if (denied) return denied;
  const db = await officeDb();
  const res = await db.from('timesheet_shifts').delete().eq('id', shiftId).eq('job_id', jobId);
  if (res.error) return { error: explain(res.error) };
  return { ok: true };
}

/**
 * Change the job's client and price its rows again: the rate is cleared and
 * the database trigger finds the new client's rate for each role. A row that
 * is approved and cannot be priced for the new client goes back to Extracted.
 */
export async function changeClient(
  jobId: string,
  clientId: string,
): Promise<{ ok: true; client: TimesheetClient; rows: ShiftRow[]; demoted: number } | Failure> {
  const denied = await guard();
  if (denied) return denied;
  const db = await officeDb();
  const job = await db.from('timesheet_jobs').select('id,status').eq('id', jobId).maybeSingle();
  if (job.error) return { error: explain(job.error) };
  if (!job.data) return { error: CODES['job_not_found']! };
  if (job.data.status !== 'reviewing') return { error: CODES['job_not_reviewing']! };

  const client = await timesheetClient(db, clientId);
  if ('error' in client) return client;

  const set = await db.from('timesheet_jobs').update({ client_id: clientId }).eq('id', jobId);
  if (set.error) return { error: explain(set.error) };

  // Rows nobody has approved cannot refuse the clearing.
  const open = await db
    .from('timesheet_shifts')
    .update({ rate: null })
    .eq('job_id', jobId)
    .eq('kind', 'shift')
    .is('invoice_id', null)
    .in('status', ['extracted', 'flagged', 'rejected']);
  if (open.error) return { error: explain(open.error) };

  const approved = await db
    .from('timesheet_shifts')
    .select('id')
    .eq('job_id', jobId)
    .eq('kind', 'shift')
    .eq('status', 'approved')
    .is('invoice_id', null);
  let demoted = 0;
  for (const row of (approved.data ?? []) as { id: string }[]) {
    let res = await db.from('timesheet_shifts').update({ rate: null }).eq('id', row.id);
    if (res.error && isIncomplete(res.error)) {
      res = await db.from('timesheet_shifts').update({ rate: null, status: 'extracted' }).eq('id', row.id);
      if (!res.error) demoted += 1;
    }
    if (res.error) return { error: explain(res.error) };
  }

  const read = await loadShiftRows(db, jobId);
  if (read.error) return { error: explain(read.error) };
  refresh(jobId);
  return { ok: true, client, rows: read.rows, demoted };
}

/**
 * Throw a job away. Only a job in review, and only when nothing approved or
 * invoiced would be lost — approved rows are work the office has signed off.
 */
export async function discardJob(jobId: string): Promise<{ ok: true } | Failure> {
  const denied = await guard();
  if (denied) return denied;
  const db = await officeDb();
  const job = await db.from('timesheet_jobs').select('id,status').eq('id', jobId).maybeSingle();
  if (job.error) return { error: explain(job.error) };
  if (!job.data) return { error: CODES['job_not_found']! };
  if (job.data.status !== 'reviewing') {
    return { error: 'Only a job that is waiting for review can be discarded.' };
  }
  const read = await loadShiftRows(db, jobId);
  if (read.error) return { error: explain(read.error) };
  const approved = read.rows.filter((r) => r.status === 'approved').length;
  const invoiced = read.rows.filter((r) => r.invoiceId).length;
  if (invoiced > 0) {
    return { error: `${invoiced} row${invoiced === 1 ? ' is' : 's are'} already on an invoice, so this job cannot be discarded.` };
  }
  if (approved > 0) {
    return {
      error: `${approved} approved row${approved === 1 ? '' : 's'} would be lost. Reject ${approved === 1 ? 'it' : 'them'} first, or continue to invoice.`,
    };
  }
  const res = await db
    .from('timesheet_jobs')
    .update({ status: 'complete' })
    .eq('id', jobId)
    .eq('status', 'reviewing')
    .select('id')
    .maybeSingle();
  if (res.error) return { error: explain(res.error) };
  if (!res.data) return { error: CODES['job_not_reviewing']! };
  refresh(jobId);
  return { ok: true };
}

// ---------------------------------------------------------------------
// 3 · Confirm
// ---------------------------------------------------------------------

export async function checkPoDuplicates(
  clientId: string,
  pos: string[],
): Promise<{ ok: true; duplicates: PoDuplicate[] } | Failure> {
  if (!supabaseConfigured()) return { error: NO_PROJECT };
  const wanted = [...new Set(pos.map((p) => p.trim()).filter(Boolean))].slice(0, 50);
  if (wanted.length === 0) return { ok: true, duplicates: [] };
  const db = await officeDb();
  const res = await db.rpc('timesheet_po_duplicates', { p_client: clientId, p_pos: wanted });
  if (res.error) return { error: explain(res.error) };
  return {
    ok: true,
    duplicates: ((res.data ?? []) as any[]).map((r) => ({
      poNumber: r.po_number,
      invoiceNumber: r.invoice_number,
      invoiceDate: r.invoice_date,
      status: r.status,
    })),
  };
}

export async function confirmJob(
  jobId: string,
  groupsInput: unknown,
): Promise<{ ok: true } | (Failure & { problems?: string[] })> {
  const denied = await guard();
  if (denied) return denied;
  const db = await officeDb();
  const job = await db.from('timesheet_jobs').select('id,status,client_id').eq('id', jobId).maybeSingle();
  if (job.error) return { error: explain(job.error) };
  if (!job.data) return { error: CODES['job_not_found']! };
  if (!job.data.client_id) return { error: CODES['job_has_no_client']! };
  const client = await timesheetClient(db, job.data.client_id);
  if ('error' in client) return client;

  const groups = parseGroups(groupsInput, client.invoiceFormat);
  if (!groups) return { error: 'The invoices could not be read. Refresh the page and try again.' };
  const read = await loadShiftRows(db, jobId);
  if (read.error) return { error: explain(read.error) };
  const approvedIds = read.rows
    .filter((r) => r.status === 'approved' && r.invoiceId === null)
    .map((r) => r.id);
  const problems = validateGroups(groups, { poRequired: client.poRequired, approvedIds });
  if (problems.length > 0) {
    return { error: problems[0]!.message, problems: problems.map((p) => p.message) };
  }

  const res = await db.rpc('timesheet_job_confirm', { p_job: jobId, p_groups: groups });
  if (res.error) return { error: explain(res.error) };
  refresh(jobId);
  return { ok: true };
}

/** Confirmed → back to Review, while no invoice has been issued from it. */
export async function backToReview(jobId: string): Promise<{ ok: true } | Failure> {
  const denied = await guard();
  if (denied) return denied;
  const db = await officeDb();
  const inv = await db
    .from('invoices')
    .select('id')
    .eq('timesheet_job_id', jobId)
    .neq('status', 'void')
    .limit(1);
  if (inv.error) return { error: explain(inv.error) };
  if ((inv.data ?? []).length > 0) {
    return { error: 'An invoice has already been issued from this job, so it cannot go back to review.' };
  }
  const res = await db
    .from('timesheet_jobs')
    .update({ status: 'reviewing' })
    .eq('id', jobId)
    .eq('status', 'confirmed')
    .select('id')
    .maybeSingle();
  if (res.error) return { error: explain(res.error) };
  if (!res.data) return { error: 'This job is not waiting to be generated any more. Refresh the page.' };
  refresh(jobId);
  return { ok: true };
}

// ---------------------------------------------------------------------
// 4 · Generate
// ---------------------------------------------------------------------

export interface GenerateResult {
  ok: true;
  /** Invoices numbered by this call. */
  issued: number;
  /** Numbered, but the PDF did not draw: the number is taken, Re-draw retries. */
  drawFailed: { invoiceId: string; number: number; error: string }[];
}

/** A concurrent click got there first: the group is issued, which is what was wanted. */
const BENIGN = ['shift_not_approved', 'job_not_confirmed'];

/**
 * Issue every confirmed group that has no invoice yet, then draw each. Safe
 * to press twice or refresh: a group is issued when any of its rows carries
 * an invoice (`invoices.timesheet_job_id`), the database serialises on the
 * job row, and a "row no longer approved" from a second click means the
 * first one already did it.
 */
export async function generateInvoices(jobId: string): Promise<GenerateResult | Failure> {
  const denied = await guard();
  if (denied) return denied;
  const db = await officeDb();
  const job = await db
    .from('timesheet_jobs')
    .select('id,status,confirmed_groups')
    .eq('id', jobId)
    .maybeSingle();
  if (job.error) return { error: explain(job.error) };
  if (!job.data) return { error: CODES['job_not_found']! };
  if (job.data.status !== 'confirmed' && job.data.status !== 'complete') {
    return { error: CODES['job_not_confirmed']! };
  }
  const groups = (Array.isArray(job.data.confirmed_groups) ? job.data.confirmed_groups : []) as ConfirmedGroup[];
  if (groups.length === 0) return { error: 'No invoices were confirmed for this job.' };

  const issuedMap = async (): Promise<Map<string, string>> => {
    const map = new Map<string, string>();
    for (let from = 0; ; from += 1000) {
      const page = await db
        .from('timesheet_shifts')
        .select('id,invoice_id')
        .eq('job_id', jobId)
        .not('invoice_id', 'is', null)
        .order('id')
        .range(from, from + 999);
      if (page.error) throw new Error(page.error.message);
      const data = (page.data ?? []) as { id: string; invoice_id: string }[];
      for (const r of data) map.set(r.id, r.invoice_id);
      if (data.length < 1000) break;
    }
    return map;
  };

  let issued = 0;
  const drawFailed: GenerateResult['drawFailed'] = [];
  let done: Set<number>;
  try {
    done = issuedGroupIndexes(groups, await issuedMap());
  } catch (e) {
    return { error: explain({ message: e instanceof Error ? e.message : String(e) }) };
  }

  for (let i = 0; i < groups.length; i += 1) {
    if (done.has(i)) continue;
    const res = await db.rpc('issue_timesheet_invoice', { p_job: jobId, p_group: groups[i] });
    if (res.error) {
      if (BENIGN.some((c) => res.error.message.includes(c))) continue;
      if (issued === 0 && drawFailed.length === 0) return { error: explain(res.error) };
      refresh(jobId);
      return { error: `${explain(res.error)} (Invoices already numbered are kept.)` };
    }
    issued += 1;
    const { id, number } = res.data as { id: string; number: number };
    try {
      const drawn = await drawInvoice(id);
      if (!drawn.ok) drawFailed.push({ invoiceId: id, number, error: drawn.error });
    } catch (e) {
      drawFailed.push({ invoiceId: id, number, error: e instanceof Error ? e.message : String(e) });
    }
  }
  refresh(jobId);
  revalidatePath('/invoices');
  return { ok: true, issued, drawFailed };
}

/** Re-draw an invoice whose PDF failed (or whose drawing stalled). The number is never lost. */
export async function redrawInvoice(invoiceId: string): Promise<{ ok: true } | Failure> {
  const denied = await guard();
  if (denied) return denied;
  const db = await officeDb();
  const res = await db
    .from('invoices')
    .select('id,source,status,created_at,timesheet_job_id')
    .eq('id', invoiceId)
    .maybeSingle();
  if (res.error) return { error: explain(res.error) };
  const inv = res.data;
  if (!inv || inv.source !== 'timesheet') return { error: 'That invoice was not found.' };
  const stalled = inv.status === 'drawing' && Date.now() - Date.parse(inv.created_at) > 2 * 60_000;
  if (inv.status !== 'failed' && !stalled) {
    return { error: 'This invoice is not waiting for a re-draw.' };
  }
  try {
    const drawn = await drawInvoice(invoiceId);
    if (!drawn.ok) return { error: drawn.error };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  if (inv.timesheet_job_id) refresh(inv.timesheet_job_id);
  revalidatePath('/invoices');
  return { ok: true };
}
