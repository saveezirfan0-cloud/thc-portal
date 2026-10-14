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
 * The read is the screen's own: `invite_roster` has only `admin_read`, and
 * `invite_roster_report()` asks `assert_office_caller()`, so a session that
 * is not the office gets nothing — the database is the gate, as on the
 * screen. The office middleware already turns such a session away first.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const { waiting, report, problem } = await loadRosterPage();
  // Without the report nobody can be told apart by standing (the Status
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
