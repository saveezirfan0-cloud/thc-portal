import { auditCsv, auditFileName } from '../auditCsv';
import { loadAuditTrail } from '../data';

/**
 * GET /compliance/export — the completion letter and opt-out audit trail as
 * CSV (completion letter requirement §4, acceptance criterion 7).
 *
 * The view is security_invoker over `audit_log`, which only an admin can read
 * (0004 admin_read), so a signed-in worker or client gets a file with a
 * header and no rows — the database is the gate, as for every other read on
 * this screen. The office middleware already turns away a session with no
 * admin role before this runs.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const { rows, problem } = await loadAuditTrail();
  if (problem) return new Response(problem, { status: 503 });
  return new Response(auditCsv(rows), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${auditFileName()}"`,
      'cache-control': 'no-store',
    },
  });
}
