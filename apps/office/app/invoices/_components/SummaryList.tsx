import Link from 'next/link';
import { Pill } from '@thc/ui';
import { hours, pounds, hoursFromMin, ukDate } from '../_lib/format';
import type { SummaryGroup } from '../_lib/view-model';
import { STATUS_LABEL, STATUS_TONE, invoiceHref } from '../_lib/view-model';

/**
 * Weekly and Monthly Summary (audit §2.4, §8): one collapsible group per ISO
 * week (or month) of the INVOICE date — count, hours, total, average — with
 * the invoices underneath. Native `<details>`, so it needs no script.
 */
export function SummaryList({ groups, empty }: { groups: SummaryGroup[]; empty: string }) {
  if (groups.length === 0) return <p className="muted">{empty}</p>;
  return (
    <div>
      {groups.map((group) => (
        <details key={group.key} className="inv-group">
          <summary>
            <span className="what">{group.label}</span>
            <span className="fig">
              {group.count}
              <small>{group.count === 1 ? 'invoice' : 'invoices'}</small>
            </span>
            <span className="fig">
              {hours(group.hours)}
              <small>hours</small>
            </span>
            <span className="fig">
              {pounds(group.total)}
              <small>total</small>
            </span>
            <span className="fig">
              {pounds(group.average)}
              <small>average</small>
            </span>
          </summary>
          <div className="body">
            <table className="tbl">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Date</th>
                  <th>Client</th>
                  <th>PO</th>
                  <th className="money">Hours</th>
                  <th className="money">Amount due</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => (
                  <tr key={row.id}>
                    <td className="mono">
                      <Link href={invoiceHref(row.id)}>#{row.number}</Link>
                    </td>
                    <td className="rp-nowrap">{ukDate(row.invoiceDate)}</td>
                    <td>{row.clientName}</td>
                    <td className="mono">{row.poNumber ?? '—'}</td>
                    <td className="money">{hours(hoursFromMin(row.payableMin))}</td>
                    <td className="money">{pounds(row.total)}</td>
                    <td>
                      <Pill tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </div>
  );
}
