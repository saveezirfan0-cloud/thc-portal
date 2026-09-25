import { cookies } from 'next/headers';
import { isRtwCheckStatus } from '@thc/domain';
import type { RtwCheckStatus } from '@thc/domain';
import { staffDb, supabaseConfigured } from '../db';

/**
 * The worker's own automated gov.uk checks (§2.6, ADR-0025), read through
 * `my_rtw_checks()` — a definer function that answers the signed-in worker
 * with status and outcome only: never the name gov.uk holds, the
 * conditions, the report or the office's reason.
 */
export interface MyRtwCheck {
  documentId: string;
  status: RtwCheckStatus;
  outcome: string | null;
  /** The N8 reason when the check asked them to re-enter the code. */
  workerReason: string | null;
  checkedAt: string | null;
}

/** Keyed by the share-code document's id. */
export type MyRtwChecks = Record<string, MyRtwCheck>;

export function parseMyRtwChecks(rows: unknown): MyRtwChecks {
  const out: MyRtwChecks = {};
  if (!Array.isArray(rows)) return out;
  for (const raw of rows as Record<string, unknown>[]) {
    if (!isRtwCheckStatus(raw['status']) || typeof raw['document_id'] !== 'string') continue;
    out[raw['document_id']] = {
      documentId: raw['document_id'],
      status: raw['status'],
      outcome: typeof raw['outcome'] === 'string' ? raw['outcome'] : null,
      workerReason: typeof raw['worker_reason'] === 'string' ? raw['worker_reason'] : null,
      checkedAt: typeof raw['checked_at'] === 'string' ? raw['checked_at'] : null,
    };
  }
  return out;
}

/** Best-effort: a failed read shows the documents as they were before the check existed. */
export async function loadMyRtwChecks(): Promise<MyRtwChecks> {
  if (!supabaseConfigured()) return {};
  try {
    const { data, error } = await staffDb(await cookies()).rpc('my_rtw_checks');
    return error ? {} : parseMyRtwChecks(data);
  } catch {
    return {};
  }
}

/** Whether a share code filed now is checked automatically (settings.rtw_check.enabled). */
export async function loadRtwCheckEnabled(): Promise<boolean> {
  if (!supabaseConfigured()) return false;
  try {
    const { data, error } = await staffDb(await cookies()).rpc('rtw_check_enabled');
    return !error && data === true;
  } catch {
    return false;
  }
}
