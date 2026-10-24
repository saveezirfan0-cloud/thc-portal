import type { ParsedRow } from './types';

/** Below this a row goes to review as 'flagged' (ADR-0210). */
export const FLAG_BELOW_CONFIDENCE = 0.75;

export interface ShiftInsert {
  job_id: string;
  file_id: string | null;
  sort: number;
  kind: 'shift';
  status: 'extracted' | 'flagged' | 'rejected';
  staff_name: string;
  staff_ref: string | null;
  work_date: string | null;
  role_name: string | null;
  start_time: string | null;
  end_time: string | null;
  break_min: number;
  hours: number | null;
  confidence: number | null;
  original: Record<string, unknown>;
  source: ParsedRow['source'];
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * The client's non-THC staff, matched case-insensitively. An entry matches
 * the whole name or the leading words of it ("Ingrid" matches "Ingrid
 * Larsen" but not "Ingrida Z").
 */
export function isExcluded(staffName: string, excluded: readonly string[]): boolean {
  const name = norm(staffName);
  if (!name) return false;
  return excluded.some((e) => {
    const x = norm(e);
    return x !== '' && (name === x || name.startsWith(`${x} `));
  });
}

/**
 * Parsed row -> insert record. Does NOT price: hours (for rows with times),
 * rate, amount and issues are the database trigger's. A missing role stays
 * null (the trigger uses the client's default role).
 */
export function toShiftInsert(
  row: ParsedRow,
  ctx: { jobId: string; fileId: string | null; sort: number; excludedStaff: readonly string[] },
): ShiftInsert {
  const hasTimes = row.startTime !== null && row.endTime !== null;
  const lowConfidence = row.confidence !== null && row.confidence < FLAG_BELOW_CONFIDENCE;
  const status = isExcluded(row.staffName, ctx.excludedStaff)
    ? 'rejected'
    : lowConfidence || row.problems.length > 0 || !row.staffName.trim() || !row.workDate
      ? 'flagged'
      : 'extracted';
  return {
    job_id: ctx.jobId,
    file_id: ctx.fileId,
    sort: ctx.sort,
    kind: 'shift',
    status,
    staff_name: row.staffName,
    staff_ref: row.staffRef,
    work_date: row.workDate,
    role_name: row.roleName,
    start_time: row.startTime,
    end_time: row.endTime,
    break_min: row.breakMin,
    // weekly rows: set directly; rows with times: the trigger computes it
    hours: hasTimes ? null : row.hours,
    confidence: row.confidence,
    original: row.original,
    source: row.source,
  };
}
