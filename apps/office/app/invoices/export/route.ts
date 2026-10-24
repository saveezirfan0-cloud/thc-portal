import { currentOfficeRole } from '../../_components/officeUser';
import { officeCan } from '../../_lib/permissions';
import { todayInUk } from '../../reports/view-model';
import { invoicesCsv } from '../_lib/csv';
import { loadInvoiceList } from '../_lib/data';
import { csvFileName, filterRows, parseInvoiceView, sortRows } from '../_lib/view-model';

/**
 * "Export as CSV" on /invoices (ADR-0210): the invoices the filters keep, one
 * row each, in the Back Office CSV form (`@thc/pdf/csv`: BOM, CRLF, text
 * cells defused against formulas). Runs as the signed-in user, so the
 * finance-gated tables decide who may read.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const role = await currentOfficeRole();
  if (role && !officeCan(role, 'finance')) {
    return new Response('Invoices are for the finance office only.', { status: 403 });
  }
  const today = todayInUk();
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const view = parseInvoiceView(params, today);
  const data = await loadInvoiceList(view);
  if (data.problem) return new Response(data.problem, { status: 500 });

  const rows = sortRows(filterRows(data.rows, view), view);
  return new Response(invoicesCsv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${csvFileName(today)}"`,
      'Cache-Control': 'no-store',
    },
  });
}
