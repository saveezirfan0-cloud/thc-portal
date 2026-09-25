import { cookies } from 'next/headers';
import { rtwCheckWorkerLine } from '@thc/domain';
import { staffDb, supabaseConfigured } from '../db';
import { parseRtwCheck } from './rtwCheck';
import type { RtwCheckLine, WorkerRtwCheck } from './rtwCheck';

/**
 * The worker's gov.uk check line, read per request (ADR-0025).
 *
 * `my_rtw_check()` resolves the caller from the session, like every other
 * staff read, so nothing here names a worker. It is not in the generated
 * types; `staffDb()` is the untyped client the other loaders call RPCs on.
 * The pages that call this are `force-dynamic`, so a status that moved
 * while the page was open shows on the next navigation.
 *
 * Every failure — no project configured, the function not deployed yet, a
 * network error — answers null, and the screen shows what it did before.
 */
export async function loadRtwCheckLine(): Promise<RtwCheckLine | null> {
  if (!supabaseConfigured()) return null;
  try {
    const supabase = staffDb(await cookies());
    const { data, error } = await supabase.rpc('my_rtw_check');
    if (error) return null;
    return toRtwCheckLine(parseRtwCheck(data));
  } catch {
    return null;
  }
}

/** The domain's words for a check, with its stamp; null when there is nothing to say. */
export function toRtwCheckLine(check: WorkerRtwCheck | null): RtwCheckLine | null {
  const line = rtwCheckWorkerLine(check);
  return check && line ? { line, checkedAt: check.checkedAt } : null;
}
