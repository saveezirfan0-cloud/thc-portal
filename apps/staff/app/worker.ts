import { cookies } from 'next/headers';
import { staffDb, supabaseConfigured } from './db';
import type { BlockKind, StaffStatus, WorkerLockFacts } from './lock';

/**
 * The signed-in worker's own row — §10.1.
 *
 * Read through their own RLS policy (`staff_self`, 0001 + 20260921123503),
 * with an explicit and deliberately short column list: `block_reason` is
 * the manager's internal note (§9.6) and is NOT fetched here, so no render
 * path in this app can put it on a screen by accident.
 *
 * Separate from `lock.ts` so the four-case decision stays a pure function
 * that can be tested without a database or a request context.
 */
export interface Worker extends WorkerLockFacts {
  id: string;
  firstName: string;
  lastName: string;
  employeeId: number | null;
  photoPath: string | null;
}

export async function loadWorker(): Promise<Worker | null> {
  if (!supabaseConfigured()) return null;
  const supabase = staffDb(await cookies());
  const { data } = await supabase
    .from('staff')
    .select(
      'id, first_name, last_name, employee_id, photo_path, status, block_kind, quiz_attempts, left_at',
    )
    .maybeSingle();

  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    id: row['id'] as string,
    firstName: (row['first_name'] as string) ?? '',
    lastName: (row['last_name'] as string) ?? '',
    employeeId: row['employee_id'] === null ? null : Number(row['employee_id']),
    photoPath: (row['photo_path'] as string) ?? null,
    status: row['status'] as StaffStatus,
    blockKind: (row['block_kind'] as BlockKind) ?? null,
    quizAttempts: Number(row['quiz_attempts'] ?? 0),
    leftAt: (row['left_at'] as string) ?? null,
  };
}
