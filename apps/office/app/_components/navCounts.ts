import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { countPendingChangeRequests } from '../staff/requests/data';
import type { NavCounts } from './OfficeSidebar';

/** The one call `countComplianceQueue` makes; supabase-js's `rpc` fits it. */
export interface QueueCountClient {
  rpc(fn: 'compliance_review_queue_count'): PromiseLike<{
    data: number | null;
    error: { message: string } | null;
  }>;
}

/** "Needs review": the exact number of queue items, or null when it could not be read. */
export async function countComplianceQueue(supabase: QueueCountClient): Promise<number | null> {
  try {
    const { data, error } = await supabase.rpc('compliance_review_queue_count');
    return error || typeof data !== 'number' ? null : data;
  } catch {
    return null;
  }
}

/**
 * The sidebar's counters, read once per request in the root layout.
 *
 * Compliance's "Needs review" queue (§4.1, "the menu counter is this
 * number" — wireframes/backoffice/compliance.html), and Staff's pending
 * name/photo change requests (ADR-0045, wireframes/backoffice/
 * change-requests.html — the same number as /staff's "Change requests (N)").
 * Each is an exact count of what the screen itself lists, so no rows cross
 * the wire and the menu and the screen cannot disagree. Both read
 * admin-only data, so a session that is not the office's counts nothing.
 *
 * The queue is counted by `compliance_review_queue_count()` (ADR-0160),
 * `count(*)` over compliance_review_queue_v under the caller's rights. A
 * HEAD `select=*&count=exact` on the view made PostgREST build every column
 * of every item (block reasons, previous rejections, the gov.uk checks) just
 * to count them, on every Back Office request.
 *
 * Every failure — no project, no session, a refused read — is "no counter",
 * never a broken page: the sidebar is chrome.
 */
function supabaseConfigured(): boolean {
  return Boolean(
    process.env['NEXT_PUBLIC_SUPABASE_URL'] && process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'],
  );
}

export async function officeNavCounts(): Promise<NavCounts> {
  if (!supabaseConfigured()) return {};
  try {
    const supabase = createClient(await cookies());
    const [compliance, requests] = await Promise.all([
      countComplianceQueue(supabase as unknown as QueueCountClient),
      countPendingChangeRequests(supabase),
    ]);
    const counts: Record<string, number> = {};
    if (compliance !== null && compliance > 0) counts['/compliance'] = compliance;
    if (requests !== null && requests > 0) counts['/staff'] = requests;
    return counts;
  } catch {
    return {};
  }
}
