import Link from 'next/link';
import { Alert, Panel, Pill } from '@thc/ui';
import { dayLabel, hours, periodLabel, timesheetState, timesheetsToSend } from '../view-model';
import type { InvoicingTimesheet, ReportView } from '../view-model';
import { SendTimesheet } from './SendTimesheet';

/**
 * Completed Timesheets · for invoicing (ADR-0081), under the Financial
 * report's breakdown.
 *
 * THC, 02.10.2026: the filled-in sheet "should not be emailed out to the
 * client yet — this needs to be linked into the invoicing part". So it no
 * longer goes the morning after (ADR-0074's D2 is off) and has no Send on
 * the event page: it goes from here, with the invoice. One row per
 * finished event in the period with staff on it (`invoicing_timesheets()`),
 * client by client — the order invoices are written in — with its Total
 * Hours, its PO number and where its sheet stands.
 *
 * A viewer reads the list and sends nothing (ADR-0060).
 */
export function InvoicingTimesheets({
  view,
  rows,
  problem,
  readOnly,
}: {
  view: ReportView;
  rows: InvoicingTimesheet[];
  problem: string | null;
  readOnly: boolean;
}) {
  const toSend = timesheetsToSend(rows);
  return (
    <Panel
      title={<>Completed Timesheets · for invoicing · {periodLabel(view.from, view.to)}</>}
      actions={
        rows.length > 0 ? (
          <Pill tone={toSend > 0 ? 'amber' : 'green'}>
            {toSend > 0 ? `${toSend} to send` : 'All sent'}
          </Pill>
        ) : null
      }
      flush
    >
      <div className="panel-b tight stack">
        <p className="sm muted">
          The Completed Allocation Timesheet goes to the client with the invoice, not after the
          event. Send it from here once the invoice is ready; the client can download it from the
          Client Portal only after that.
        </p>
        {problem ? <Alert tone="coral">{problem}</Alert> : null}
      </div>
      <div className="panel-b tight table-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>Client</th>
              <th>Event</th>
              <th>Date</th>
              <th>PO Number</th>
              <th className="money">Staff</th>
              <th className="money">Total hours</th>
              <th>Completed Timesheet</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="muted">
                  No event in this period has finished with staff on it yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => <TimesheetRow key={row.event_id} row={row} readOnly={readOnly} />)
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function TimesheetRow({ row, readOnly }: { row: InvoicingTimesheet; readOnly: boolean }) {
  const state = timesheetState(row);
  return (
    <tr>
      <td className="rp-nowrap">{row.client_name}</td>
      <td>
        <Link href={`/events/${row.event_id}`}>{row.event_title}</Link>
      </td>
      <td className="rp-nowrap">{dayLabel(row.event_date)}</td>
      <td>{row.po_number || <span className="muted">—</span>}</td>
      <td className="money">{row.confirmed}</td>
      <td className="money">
        {row.undetermined > 0 ? <span className="muted">—</span> : hours(row.worked_min)}
      </td>
      <td className="sm">
        <Pill tone={state.tone}>{state.text}</Pill>
      </td>
      <td>
        <span className="row" style={{ gap: 8, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
          <a className="btn sm" href={`/api/documents/${row.event_id}?kind=signout`}>
            Download
          </a>
          {readOnly ? null : (
            <SendTimesheet
              eventId={row.event_id}
              eventTitle={row.event_title}
              label={state.sendLabel}
              blocked={state.blocked}
            />
          )}
        </span>
      </td>
    </tr>
  );
}
