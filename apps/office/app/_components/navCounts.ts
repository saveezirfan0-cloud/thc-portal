import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { countPendingChangeRequests } from '../staff/requests/data';
import type { NavCounts } from './OfficeSidebar';

/**
 * The sidebar's counters, read once per request in the root layout.
 *
 * Compliance's "Needs review" queue (§4.1, "the menu counter is this
 * number" — wireframes/backoffice/compliance.html), and Staff's pending
 * name/photo change requests (ADR-0044, wireframes/backoffice/
 * change-requests.html — the same number as /staff's "Change requests (N)").
 * Each is a HEAD request with `count: 'exact'` on what the screen itself
 * lists, so no rows cross the wire and the menu and the screen cannot
 * disagree. Both read admin-only data, so a session that is not the
 * office's counts nothing.
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
      supabase.from('compliance_review_queue_v').select('*', { count: 'exact', head: true }),
      countPendingChangeRequests(supabase),
    ]);
    const counts: Record<string, number> = {};
    if (!compliance.error && compliance.count) counts['/compliance'] = compliance.count;
    if (requests !== null && requests > 0) counts['/staff'] = requests;
    return counts;
  } catch {
    return {};
  }
}
