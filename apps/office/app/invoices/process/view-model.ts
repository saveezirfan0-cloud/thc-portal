/**
 * /invoices/process — what the screens decide from the data (ADR-0210).
 *
 * Pure. The stepper follows `timesheet_jobs.status`; the Review table's
 * counters, filter chips and "Approve all clean" are read off the rows the
 * database already priced; Confirm's groups are built here and checked by
 * `validators.ts`. Nothing in this file prices a row: hours, rate and amount
 * are the DB trigger's. The only arithmetic is the group summary, which adds
 * up the printed lines (ADR-0210 §4: round per line, VAT on the subtotal).
 */
import { isIsoDate } from './validators';
import type { ConfirmedGroup, InvoiceFormat, JobStatus, ShiftRow, ShiftStatus } from './types';

// ---------------------------------------------------------------------
// The stepper
// ---------------------------------------------------------------------

export const STEPS = [
  { key: 'Step 1', label: 'Upload' },
  { key: 'Step 2', label: 'Review' },
  { key: 'Step 3', label: 'Confirm' },
  { key: 'Step 4', label: 'Generate' },
] as const;

export type Phase = 'processing' | 'review' | 'confirm' | 'generate' | 'done' | 'error';

export interface StepState {
  /** Zero-based step in progress; 4 means every step is done. */
  current: number;
  phase: Phase;
}

/**
 * Where /invoices/process/[jobId] resumes. `view` is the `?step=` the URL
 * carries: Confirm is a view of a job that is still `reviewing` (the
 * database has no state between "reviewing" and "confirmed").
 */
export function stepFor(status: JobStatus, view?: string | null): StepState {
  switch (status) {
    case 'uploaded':
      return { current: 0, phase: 'processing' };
    case 'extracting':
      return { current: 1, phase: 'processing' };
    case 'error':
      return { current: 1, phase: 'error' };
    case 'reviewing':
      return view === 'confirm'
        ? { current: 2, phase: 'confirm' }
        : { current: 1, phase: 'review' };
    case 'confirmed':
      return { current: 3, phase: 'generate' };
    case 'complete':
      return { current: 4, phase: 'done' };
  }
}

/** The page refreshes itself while the server is still reading the files. */
export function isWorking(status: JobStatus): boolean {
  return status === 'uploaded' || status === 'extracting';
}

export const JOB_STATUS_LABEL: Readonly<Record<JobStatus, string>> = {
  uploaded: 'Uploaded',
  extracting: 'Reading files',
  reviewing: 'Needs review',
  confirmed: 'Ready to generate',
  complete: 'Complete',
  error: 'Could not read',
};

export const JOB_STATUS_TONE: Readonly<
  Record<JobStatus, 'neutral' | 'cyan' | 'green' | 'amber' | 'coral'>
> = {
  uploaded: 'neutral',
  extracting: 'cyan',
  reviewing: 'amber',
  confirmed: 'cyan',
  complete: 'green',
  error: 'coral',
};

// ---------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------

export type StatusFilter = 'all' | ShiftStatus;
export const FILTERS: readonly { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'extracted', label: 'Extracted' },
  { id: 'flagged', label: 'Flagged' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
];

export const CLEAN_CONFIDENCE = 0.75;

export const ISSUE_LABEL: Readonly<Record<string, string>> = {
  no_hours: 'No hours',
  no_rate: 'No rate for this role',
  no_name: 'No name',
  no_date: 'No date',
  no_quantity: 'No quantity',
  no_description: 'No description',
};

export const ISSUE_FIX: Readonly<Record<string, string>> = {
  no_hours: 'Add a start and end time, or the hours.',
  no_rate: 'Check the role matches this client’s rate card, or type the rate.',
  no_name: 'Type the staff member’s name.',
  no_date: 'Enter the date worked.',
  no_quantity: 'Enter a quantity.',
  no_description: 'Describe the expense.',
};

export function issueLabel(code: string): string {
  return ISSUE_LABEL[code] ?? code.replace(/_/g, ' ');
}

export interface Counts {
  total: number;
  extracted: number;
  flagged: number;
  approved: number;
  rejected: number;
  approvedHours: number;
  approvedTotal: number;
  /** Rows "Approve all clean" would approve. */
  clean: number;
}

export function countRows(rows: readonly ShiftRow[]): Counts {
  const counts: Counts = {
    total: rows.length,
    extracted: 0,
    flagged: 0,
    approved: 0,
    rejected: 0,
    approvedHours: 0,
    approvedTotal: 0,
    clean: 0,
  };
  let totalPence = 0;
  for (const row of rows) {
    counts[row.status] += 1;
    if (row.status === 'approved') {
      if (row.kind === 'shift') counts.approvedHours += (row.hours ?? 0) * row.staffCount;
      totalPence += toPence(row.amount ?? 0);
    }
    if (isCleanForApproval(row)) counts.clean += 1;
  }
  counts.approvedHours = Math.round(counts.approvedHours * 100) / 100;
  counts.approvedTotal = totalPence / 100;
  return counts;
}

/** No issues, confident (or read exactly) and still waiting for a decision. */
export function isCleanForApproval(row: ShiftRow): boolean {
  return (
    row.invoiceId === null &&
    (row.status === 'extracted' || row.status === 'flagged') &&
    row.issues.length === 0 &&
    (row.confidence === null || row.confidence >= CLEAN_CONFIDENCE)
  );
}

export function filterRows(rows: readonly ShiftRow[], filter: StatusFilter): ShiftRow[] {
  return filter === 'all' ? [...rows] : rows.filter((r) => r.status === filter);
}

/** A weekly total: a person and hours, no clock times (Taster's export). */
export function isWeekly(row: ShiftRow): boolean {
  return row.kind === 'shift' && row.startTime === null && row.endTime === null;
}

export function hasWeeklyRows(rows: readonly ShiftRow[]): boolean {
  return rows.some(isWeekly);
}

export const WEEKLY_BANNER =
  'This timesheet has summary hours only — no per-shift start or end times. Rows show the weekly hours as given; add start and end times where you have them.';

/** The database recomputes hours from start and end, so they are typed only when there are none. */
export function hoursEditable(row: ShiftRow): boolean {
  return isWeekly(row) && row.invoiceId === null;
}

export function canApprove(row: ShiftRow): boolean {
  return row.invoiceId === null && row.issues.length === 0;
}

/** A row that cannot be approved, and why — in words, in the order the DB lists them. */
export function blockers(row: ShiftRow): string[] {
  return row.issues.map(issueLabel);
}

export function sortRows(rows: readonly ShiftRow[]): ShiftRow[] {
  return [...rows].sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
}

export function nextSort(rows: readonly ShiftRow[]): number {
  return rows.reduce((max, r) => Math.max(max, r.sort), 0) + 1;
}

// ---------------------------------------------------------------------
// Editing a row (validated again in the server action)
// ---------------------------------------------------------------------

export interface ShiftPatch {
  staffName?: string;
  staffRef?: string | null;
  workDate?: string | null;
  roleName?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  breakMin?: number;
  hours?: number | null;
  staffCount?: number;
  quantity?: number | null;
  description?: string | null;
  rate?: number | null;
}

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

export type PatchResult = { ok: true; set: Record<string, unknown> } | { ok: false; error: string };

/**
 * Turns a patch into the columns to write. A changed role clears the rate
 * (so the trigger prices it again against the rate card) unless the patch
 * also states one.
 */
export function buildShiftUpdate(row: ShiftRow, patch: ShiftPatch): PatchResult {
  const set: Record<string, unknown> = {};
  const fail = (error: string): PatchResult => ({ ok: false, error });

  if (row.invoiceId) return fail('This row is already on an invoice and cannot change.');

  if ('staffName' in patch) {
    const v = (patch.staffName ?? '').trim();
    if (v.length > 120) return fail('A name can be up to 120 characters.');
    set['staff_name'] = v;
  }
  if ('staffRef' in patch) {
    const v = (patch.staffRef ?? '').trim();
    if (v.length > 40) return fail('A staff ID can be up to 40 characters.');
    set['staff_ref'] = v === '' ? null : v;
  }
  if ('workDate' in patch) {
    if (patch.workDate !== null && patch.workDate !== undefined && patch.workDate !== '') {
      if (!isIsoDate(patch.workDate)) return fail('Enter the date as dd/mm/yyyy.');
      set['work_date'] = patch.workDate;
    } else {
      set['work_date'] = null;
    }
  }
  if ('roleName' in patch) {
    const v = (patch.roleName ?? '').trim();
    if (v.length > 80) return fail('A role can be up to 80 characters.');
    set['role_name'] = v === '' ? null : v;
    if (row.kind === 'shift' && !('rate' in patch)) set['rate'] = null;
  }
  for (const [key, column] of [
    ['startTime', 'start_time'],
    ['endTime', 'end_time'],
  ] as const) {
    if (key in patch) {
      const v = patch[key];
      if (v === null || v === undefined || v === '') set[column] = null;
      else if (!CLOCK.test(v)) return fail('Enter a time such as 17:30.');
      else set[column] = v;
    }
  }
  if ('breakMin' in patch) {
    const v = patch.breakMin;
    if (v === undefined || !Number.isInteger(v) || v < 0 || v > 720) {
      return fail('A break is a whole number of minutes, 0 to 720.');
    }
    set['break_min'] = v;
  }
  if ('staffCount' in patch) {
    const v = patch.staffCount;
    if (v === undefined || !Number.isInteger(v) || v < 1 || v > 999) {
      return fail('The number of staff is a whole number from 1.');
    }
    set['staff_count'] = v;
  }
  if ('quantity' in patch) {
    const v = patch.quantity;
    if (v !== null && v !== undefined && (!Number.isFinite(v) || v <= 0 || v > 100000)) {
      return fail('A quantity must be more than zero.');
    }
    set['quantity'] = v ?? null;
  }
  if ('description' in patch) {
    const v = (patch.description ?? '').trim();
    if (v.length > 200) return fail('A description can be up to 200 characters.');
    set['description'] = v === '' ? null : v;
  }
  if ('rate' in patch) {
    const v = patch.rate;
    if (v !== null && v !== undefined && (!Number.isFinite(v) || v < 0 || v > 1000)) {
      return fail('A rate is a price per hour of £0 to £1,000.');
    }
    set['rate'] = v ?? null;
  }
  if ('hours' in patch) {
    const v = patch.hours;
    if (v !== null && v !== undefined && (!Number.isFinite(v) || v < 0 || v > 200)) {
      return fail('Hours must be between 0 and 200.');
    }
    const start = 'start_time' in set ? set['start_time'] : row.startTime;
    const end = 'end_time' in set ? set['end_time'] : row.endTime;
    if (row.kind !== 'shift' || start !== null || end !== null) {
      return fail('Hours are worked out from the start and end times — change those instead.');
    }
    set['hours'] = v ?? null;
  }
  if (Object.keys(set).length === 0) return fail('Nothing to change.');
  return { ok: true, set };
}

// ---------------------------------------------------------------------
// Dates and money (display only)
// ---------------------------------------------------------------------

/** 2026-10-26 → 26/10/2026 (§1.8). */
export function ukDate(iso: string | null): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
}

export function ukDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return fmt.format(d).replace(',', '');
}

export function todayInUk(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function toPence(amount: number): number {
  return Math.round(amount * 100);
}

export function gbp(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  return `£${amount.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function hoursLabel(hours: number | null | undefined): string {
  if (hours === null || hours === undefined) return '—';
  return hours.toFixed(2);
}

// ---------------------------------------------------------------------
// Confirm: groups
// ---------------------------------------------------------------------

export interface DraftGroup extends ConfirmedGroup {
  /** Stable key for React; never sent. */
  key: string;
  /** The event dates were typed by the person: stop following the rows. */
  datesEdited: boolean;
}

export interface GroupDefaults {
  invoiceDate: string;
  format: InvoiceFormat;
}

let keySeed = 0;
function newKey(): string {
  keySeed += 1;
  return `g${keySeed}`;
}

export function dateRange(rows: readonly ShiftRow[]): { start: string; end: string } {
  const dates = rows
    .map((r) => r.workDate)
    .filter((d): d is string => d !== null)
    .sort();
  return { start: dates[0] ?? '', end: dates[dates.length - 1] ?? '' };
}

function draft(rows: readonly ShiftRow[], defaults: GroupDefaults): DraftGroup {
  const { start, end } = dateRange(rows);
  return {
    key: newKey(),
    poNumber: '',
    invoiceDate: defaults.invoiceDate,
    eventDateStart: start,
    eventDateEnd: end,
    format: defaults.format,
    shiftIds: rows.map((r) => r.id),
    datesEdited: false,
  };
}

/** The default: everything approved becomes ONE invoice. */
export function singleGroup(rows: readonly ShiftRow[], defaults: GroupDefaults): DraftGroup[] {
  return rows.length === 0 ? [] : [draft(rows, defaults)];
}

/** Monday of the week a yyyy-mm-dd falls in (Taster's weeks run Monday–Sunday). */
export function weekStart(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** One invoice per Monday–Sunday week; rows with no date join the first week. */
export function splitByWeek(rows: readonly ShiftRow[], defaults: GroupDefaults): DraftGroup[] {
  const weeks = new Map<string, ShiftRow[]>();
  const undated: ShiftRow[] = [];
  for (const row of rows) {
    if (!row.workDate) undated.push(row);
    else {
      const key = weekStart(row.workDate);
      weeks.set(key, [...(weeks.get(key) ?? []), row]);
    }
  }
  const keys = [...weeks.keys()].sort();
  if (keys.length === 0) return singleGroup(rows, defaults);
  const first = keys[0]!;
  weeks.set(first, [...undated, ...(weeks.get(first) ?? [])]);
  return keys.map((k) => draft(weeks.get(k)!, defaults));
}

/**
 * Split one group after a date: rows worked on or before it stay, the rest
 * go to a new invoice straight after. The "event date range" split.
 */
export function splitGroupAfter(
  groups: readonly DraftGroup[],
  index: number,
  after: string,
  byId: ReadonlyMap<string, ShiftRow>,
  defaults: GroupDefaults,
): DraftGroup[] {
  const group = groups[index];
  if (!group || !isIsoDate(after)) return [...groups];
  const rows = group.shiftIds.map((id) => byId.get(id)).filter((r): r is ShiftRow => !!r);
  const keep = rows.filter((r) => !r.workDate || r.workDate <= after);
  const move = rows.filter((r) => r.workDate && r.workDate > after);
  if (keep.length === 0 || move.length === 0) return [...groups];
  const head: DraftGroup = { ...group, ...rangeOf(keep, group), shiftIds: keep.map((r) => r.id) };
  const tail = draft(move, {
    invoiceDate: group.invoiceDate,
    format: group.format ?? defaults.format,
  });
  return [...groups.slice(0, index), head, tail, ...groups.slice(index + 1)];
}

function rangeOf(rows: readonly ShiftRow[], group: DraftGroup) {
  if (group.datesEdited) {
    return { eventDateStart: group.eventDateStart, eventDateEnd: group.eventDateEnd };
  }
  const { start, end } = dateRange(rows);
  return { eventDateStart: start, eventDateEnd: end };
}

/** "Split by PO": another, empty invoice to move rows into. */
export function addEmptyGroup(
  groups: readonly DraftGroup[],
  defaults: GroupDefaults,
): DraftGroup[] {
  return [...groups, draft([], defaults)];
}

export function moveRow(
  groups: readonly DraftGroup[],
  shiftId: string,
  toKey: string,
  byId: ReadonlyMap<string, ShiftRow>,
): DraftGroup[] {
  const moved = groups.map((g) => ({
    ...g,
    shiftIds:
      g.key === toKey
        ? [...g.shiftIds.filter((id) => id !== shiftId), shiftId]
        : g.shiftIds.filter((id) => id !== shiftId),
  }));
  return moved.map((g) => {
    if (g.datesEdited) return g;
    const rows = g.shiftIds.map((id) => byId.get(id)).filter((r): r is ShiftRow => !!r);
    const { start, end } = dateRange(rows);
    return { ...g, eventDateStart: start, eventDateEnd: end };
  });
}

export function removeGroup(groups: readonly DraftGroup[], key: string): DraftGroup[] {
  return groups.filter((g) => g.key !== key || g.shiftIds.length > 0);
}

export function toConfirmed(groups: readonly DraftGroup[]): ConfirmedGroup[] {
  return groups.map(
    ({ poNumber, invoiceDate, eventDateStart, eventDateEnd, format, shiftIds }) => ({
      poNumber: poNumber.trim(),
      invoiceDate,
      eventDateStart,
      eventDateEnd,
      format,
      shiftIds,
    }),
  );
}

export interface GroupSummary {
  rows: number;
  hours: number;
  /** £ — the sum of the printed lines. */
  subtotal: number;
  vat: number;
  total: number;
}

/**
 * ADR-0210 §4: each line is already rounded to the penny by the database;
 * the subtotal is their sum and VAT is round(subtotal × rate, 2). Done in
 * whole pence so the sum cannot drift. (The platform helper
 * `invoiceTotals` is the same arithmetic; this is display only — the
 * invoice is priced by issue_timesheet_invoice().)
 */
export function summariseGroup(rows: readonly ShiftRow[], vatRatePercent: number): GroupSummary {
  let pence = 0;
  let hours = 0;
  for (const row of rows) {
    pence += toPence(row.amount ?? 0);
    if (row.kind === 'shift') hours += (row.hours ?? 0) * row.staffCount;
  }
  const vatPence = Math.round((pence * vatRatePercent) / 100);
  return {
    rows: rows.length,
    hours: Math.round(hours * 100) / 100,
    subtotal: pence / 100,
    vat: vatPence / 100,
    total: (pence + vatPence) / 100,
  };
}

// ---------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------

/** A confirmed group is issued once any of its rows carries an invoice. */
export function issuedGroupIndexes(
  groups: readonly ConfirmedGroup[],
  invoiceByShift: ReadonlyMap<string, string>,
): Set<number> {
  const done = new Set<number>();
  groups.forEach((g, i) => {
    if (g.shiftIds.some((id) => invoiceByShift.has(id))) done.add(i);
  });
  return done;
}

export function invoiceTotalValue(invoices: readonly { total: number; status: string }[]): number {
  return (
    invoices.filter((i) => i.status !== 'void').reduce((sum, i) => sum + toPence(i.total), 0) / 100
  );
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Whole days since a timestamp, for the stale-jobs marker (audit §10.12). */
export function ageDays(iso: string, now: number = Date.now()): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86_400_000)) : 0;
}

export const STALE_AFTER_DAYS = 7;

/** The codes `runExtraction()` leaves in `timesheet_jobs.error`, in words. */
const EXTRACTION_ERRORS: Readonly<Record<string, string>> = {
  no_files: 'The job has no files to read. Upload the timesheet again.',
  no_rows_found:
    'No timesheet rows could be found in the files. Check it is the right file, or upload a clearer copy.',
  job_not_extractable: 'The files are already being read.',
  unexpected_error: 'The files could not be read. Retry, or upload a clearer copy.',
};

export function extractionErrorText(error: string | null): string {
  if (!error) return 'The timesheet could not be read.';
  return (
    EXTRACTION_ERRORS[error] ??
    (/^[a-z0-9_]+$/.test(error) ? EXTRACTION_ERRORS['unexpected_error']! : error)
  );
}
