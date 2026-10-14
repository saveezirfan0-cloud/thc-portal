import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@thc/db/server';
import { supabaseConfigured } from '../../data';
import { loadRosterPage } from '../data';
import {
  bySurname,
  filterRoster,
  parseRosterFilter,
  rosterCsv,
  rosterFileName,
  rosterIndex,
} from '../list';

/**
 * GET /staff/roster/export — the invite list as CSV, under the same filter
 * as the screen (`?grp=spudbros&status=waiting&q=…`), sorted by surname
 * (ADR-0138).
 *
 * Two gates, as /activity/export has. The session must be an admin's
 * (asked here, so a worker or a client who reaches this URL gets a 401 or
 * a 403 rather than an error message), and the read is the screen's own:
 * `invite_roster` has only `admin_read`, and `invite_roster_report()` asks
 * `assert_office_caller()`.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  if (!supabaseConfigured()) {
    return new Response('This environment has no Supabase project.', { status: 503 });
  }
  const supabase = createClient(await cookies()) as unknown as SupabaseClient;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return new Response('Sign in to export the invite list.', { status: 401 });
  if (auth.user.app_metadata?.['role'] !== 'admin') {
    return new Response('The invite list is for the office only.', { status: 403 });
  }

  const { waiting, report, problem } = await loadRosterPage();
  // Without the report nobody can be told apart by status (the Status
  // column would call everyone "Not applied"), so a file is not offered.
  if (problem) return new Response(problem, { status: 503 });
  const params = new URL(request.url).searchParams;
  const filter = parseRosterFilter({
    grp: params.get('grp'),
    status: params.get('status'),
    q: params.get('q'),
  });
  const index = rosterIndex(report);
  const rows = filterRoster(waiting, filter, index).sort(bySurname);
  return new Response(rosterCsv(rows, index, report), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${rosterFileName(filter)}"`,
      'cache-control': 'no-store',
    },
  });
}
