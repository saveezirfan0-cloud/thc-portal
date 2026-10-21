import type { QueueRow } from './types';

/**
 * The holiday ranges each worker has on file now (staff.term_dates) — what
 * their previous verified term letter set, and what verifying a new one
 * replaces (ADR-0183). Read only for the workers with a term letter waiting
 * on Needs review, so the dialog can say so before the reviewer presses
 * Verify.
 *
 * Best-effort: a failed read returns no ranges, and the dialog simply does
 * not mention a previous letter. It never takes the queue down.
 */
interface Client {
  from(table: string): {
    select(columns: string): {
      in(column: string, values: readonly string[]): PromiseLike<{ data: unknown; error: unknown }>;
    };
  };
}

const CHUNK = 150;

/** The staff ids whose rows are a pending term letter. */
export function termLetterStaffIds(rows: readonly QueueRow[]): string[] {
  return [
    ...new Set(
      rows
        .filter(
          (row) => row.kind === 'document' && row.item_type === 'university_term_dates_letter',
        )
        .map((row) => row.staff_id),
    ),
  ];
}

export async function loadStaffTermDates(
  client: unknown,
  staffIds: readonly string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const ids = [...new Set(staffIds.filter(Boolean))];
  if (ids.length === 0) return map;
  try {
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
    const answers = await Promise.all(
      chunks.map((chunk) =>
        (client as Client).from('staff').select('id, term_dates').in('id', chunk),
      ),
    );
    for (const answer of answers) {
      if (answer.error) continue;
      for (const row of (answer.data as { id: string; term_dates: string[] | null }[] | null) ??
        []) {
        map.set(row.id, row.term_dates ?? []);
      }
    }
  } catch {
    return map;
  }
  return map;
}

/** The queue rows with `staff_term_dates` merged in on each term letter. */
export function withStaffTermDates(
  rows: readonly QueueRow[],
  onFile: ReadonlyMap<string, readonly string[]> | ((staffId: string) => readonly string[] | null),
): QueueRow[] {
  const read =
    typeof onFile === 'function' ? onFile : (staffId: string) => onFile.get(staffId) ?? null;
  return rows.map((row) =>
    row.kind === 'document' && row.item_type === 'university_term_dates_letter'
      ? { ...row, staff_term_dates: [...(read(row.staff_id) ?? [])] }
      : row,
  );
}
