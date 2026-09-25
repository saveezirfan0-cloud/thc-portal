import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import type { NavCounts } from './OfficeSidebar';

/**
 * The sidebar's counters, read once per request in the root layout.
 *
 * Today that is one number: Compliance's "Needs review" queue (§4.1, "the
 * menu counter is this number" — wireframes/backoffice/compliance.html).
 * It is a HEAD request with `count: 'exact'` on the same view /compliance
 * lists, so no rows cross the wire and the menu and the tab cannot
 * disagree. The view is security_invoker over admin-only tables, so a
 * session that is not the office's counts nothing.
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
    const { count, error } = await supabase
      .from('compliance_review_queue_v')
      .select('*', { count: 'exact', head: true });
    if (error || !count) return {};
    return { '/compliance': count };
  } catch {
    return {};
  }
}
