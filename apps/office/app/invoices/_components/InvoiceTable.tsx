import Link from 'next/link';
import { Pill, TableScroll } from '@thc/ui';
import { hours, hoursFromMin, pounds, ukDate, ukStamp } from '../_lib/format';
import type { InvoiceListRow } from '../_lib/types';
import {
  FORMAT_LABEL,
  SOURCE_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  XERO_LABEL,
  XERO_TONE,
  excelHref,
  invoiceHref,
  listHref,
  pdfHref,
} from '../_lib/view-model';
import type { InvoiceView, SortKey } from '../_lib/view-model';

const SORTABLE: Record<SortKey, string> = {
  number: '#',
  date: 'Date',
  client: 'Client',
  total: 'Amount due',
};

function Head({ view, column, className }: { view: InvoiceView; column: SortKey; className?: string }) {
  const on = view.sort === column;
  const nextDir = on && view.dir === 'desc' ? 'asc' : 'desc';
  return (
    <th className={className} aria-sort={on ? (view.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <Link
        className={`sort${on ? ' on' : ''}${on && view.dir === 'asc' ? ' asc' : ''}`}
        href={listHref(view, { sort: column, dir: nextDir, page: 1 })}
      >
        {SORTABLE[column]}
      </Link>
    </th>
  );
}

/** "Last sent" — the date of the email, or a dash while nothing has gone. */
function lastSent(row: InvoiceListRow): string {
  return row.lastSentAt ? ukStamp(row.lastSentAt).slice(0, 10) : '—';
}

/**
 * The invoices table (audit §2.4, columns of the old tool plus Source and
 * Xero). One row per invoice; the # links to the invoice, the client to its
 * card. PDF and Excel are plain links to the stored files.
 */
export function InvoiceTable({ rows, view }: { rows: InvoiceListRow[]; view: InvoiceView }) {
  return (
    <TableScroll label="Invoices" minWidth="78rem">
      <table className="tbl">
        <thead>
          <tr>
            <Head view={view} column="number" />
            <Head view={view} column="date" />
            <Head view={view} column="client" />
            <th>Venue</th>
            <th>PO</th>
            <th>Source</th>
            <th>Format</th>
            <th className="money">Hours</th>
            <th className="money">Subtotal</th>
            <th className="money">VAT</th>
            <Head view={view} column="total" className="money" />
            <th>Status</th>
            <th>Last sent</th>
            <th>Xero</th>
            <th>Files</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={15} className="muted">
                No invoice matches these filters.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id} className={row.status === 'void' ? 'muted' : undefined}>
                <td className="mono rp-nowrap">
                  <Link href={invoiceHref(row.id)}>#{row.number}</Link>
                </td>
                <td className="rp-nowrap">{ukDate(row.invoiceDate)}</td>
                <td>
                  <Link href={`/clients/${row.clientId}`}>{row.clientName}</Link>
                </td>
                <td>{row.venue || <span className="muted">—</span>}</td>
                <td className="mono">{row.poNumber ?? <span className="muted">—</span>}</td>
                <td>
                  <Pill tone={row.source === 'timesheet' ? 'purple' : 'neutral'}>
                    {SOURCE_LABEL[row.source]}
                  </Pill>
                </td>
                <td>
                  <Pill tone={row.format === 'named' ? 'cyan' : 'neutral'}>
                    {FORMAT_LABEL[row.format]}
                  </Pill>
                </td>
                <td className="money">{hours(hoursFromMin(row.payableMin))}</td>
                <td className="money">{pounds(row.net)}</td>
                <td className="money">{pounds(row.vat)}</td>
                <td className="money">
                  <b>{pounds(row.total)}</b>
                </td>
                <td>
                  <Pill tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Pill>
                </td>
                <td className="rp-nowrap">{lastSent(row)}</td>
                <td>
                  {row.xero ? (
                    <Pill tone={XERO_TONE[row.xero]}>{XERO_LABEL[row.xero]}</Pill>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  {row.status === 'drawing' || row.status === 'failed' ? (
                    <span className="muted">—</span>
                  ) : (
                    <span className="inv-icons">
                      <a href={pdfHref(row.id)} aria-label={`Download PDF for invoice ${row.number}`}>
                        PDF
                      </a>
                      {row.source === 'timesheet' ? (
                        <a href={excelHref(row.id)} aria-label={`Download Excel for invoice ${row.number}`}>
                          Excel
                        </a>
                      ) : null}
                    </span>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </TableScroll>
  );
}
