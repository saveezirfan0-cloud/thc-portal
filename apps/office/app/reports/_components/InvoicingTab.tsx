import Link from 'next/link';
import { Alert, KpiTile, Note, Panel, Pill, TableScroll, TileGrid } from '@thc/ui';
import type { InvoiceEvent } from '../data';
import {
  INVOICE_STATUS_LABEL,
  INVOICE_STATUS_TONE,
  dayLabel,
  exportHref,
  hours,
  invoiceEventHref,
  invoiceStatus,
  lastWeek,
  num,
  periodLabel,
  pounds,
  poundsWhole,
  reportHref,
  thisWeek,
} from '../view-model';
import type { InvoiceStatus, ReportView } from '../view-model';
import { RangeForm } from './RangeForm';

/**
 * Tab 4 · Invoicing (ADR-0168) — not in §9.9, which leaves invoicing to
 * THC's own process. This tab does not invoice either: it says which
 * events are safe to invoice and hands over their lines.
 *
 * One row per event dated in the range. The status is the database's
 * (`invoice_events`): Check-out open → Missing check-out → Needs review →
 * Ready to invoice. "Export ready CSV" carries the Ready events only.
 */
export function InvoicingTab({
  view,
  events,
  today,
}: {
  view: ReportView;
  events: InvoiceEvent[];
  today: string;
}) {
  const last = lastWeek(today);
  const current = thisWeek(today);
  const onLast = view.from === last.from && view.to === last.to;
  const onThis = view.from === current.from && view.to === current.to;

  const by = (status: InvoiceStatus) => events.filter((e) => invoiceStatus(e.status) === status);
  const ready = by('ready');
  const review = by('review');
  const missing = by('missing');
  const open = by('open');
  const sum = (list: InvoiceEvent[]) => list.reduce((total, e) => total + num(e.invoicing), 0);

  return (
    <div className="stack">
      <div className="rp-toolbar filters">
        <Link className={`btn sm${onLast ? ' primary' : ''}`} href={reportHref(view, last)}>
          Last week
        </Link>
        <Link className={`btn sm${onThis ? ' primary' : ''}`} href={reportHref(view, current)}>
          This week
        </Link>
        <RangeForm view={view} />
        <div className="right">
          <a className="btn sm primary" href={exportHref(view)}>
            Export ready CSV
          </a>
        </div>
      </div>

      <TileGrid columns={4}>
        <KpiTile
          label="Ready to invoice"
          tone="ok"
          value={poundsWhole(sum(ready))}
          description={`${ready.length} ${ready.length === 1 ? 'event' : 'events'} · signed off`}
        />
        <KpiTile
          label="Needs review"
          tone={review.length > 0 ? 'warn' : 'default'}
          value={review.length}
          description={`${pounds(sum(review))} waiting for a manager's sign-off`}
        />
        <KpiTile
          label="Missing check-out"
          tone={missing.length > 0 ? 'danger' : 'default'}
          value={missing.length}
          description="resolve the No check-out with the actual finish time"
        />
        <KpiTile
          label="Check-out open"
          value={open.length}
          description="until 4 hours after the last shift ends"
        />
      </TileGrid>

      <Alert tone="cyan">
        <b>This list does not send invoices.</b> THC invoices from its own accounting tool. An event
        is ready once every worker has checked out (or a manager has entered their finish time) and
        a manager has reviewed its violations and marked it reviewed for invoicing. If anything
        changes after that, it goes back to Needs review.
      </Alert>

      <Panel title={<>Events · {periodLabel(view.from, view.to)}</>} flush>
        <div className="panel-b tight">
          <TableScroll label="Events to invoice" minWidth="58rem">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Event</th>
                  <th>Client</th>
                  <th>PO Number</th>
                  <th className="money">Shifts</th>
                  <th className="money">Payable hours</th>
                  <th className="money">Amount</th>
                  <th>Violations</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {events.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="muted">
                      No event in this period has shifts to invoice.
                    </td>
                  </tr>
                ) : (
                  events.map((event) => <EventRow key={event.event_id} event={event} />)
                )}
              </tbody>
            </table>
          </TableScroll>
        </div>
      </Panel>

      <div className="grid c2">
        <Note>
          <b>Amount</b> = payable hours × the role&apos;s charge rate, the same figure as the
          Financial tab. Unpaid breaks are deducted; buffer staff turned away and no-shows are never
          charged; an event cancelled on the day is charged in full.
        </Note>
        <Note>
          <b>Export ready CSV</b> has one row per shift of every Ready event in the period, with the
          PO Number and a total row per event. Events that are not ready are left out.
        </Note>
      </div>
    </div>
  );
}

function EventRow({ event }: { event: InvoiceEvent }) {
  const status = invoiceStatus(event.status);
  return (
    <tr>
      <td className="rp-nowrap">{dayLabel(event.event_date)}</td>
      <td>
        <Link href={invoiceEventHref(event.event_id)}>{event.event_title}</Link>
        {event.cancelled ? <div className="muted sm">cancelled on the day</div> : null}
      </td>
      <td>{event.client_name}</td>
      <td className="mono">{event.po_number ?? <span className="muted">—</span>}</td>
      <td className="money">{event.billable_shifts}</td>
      <td className="money">{hours(event.payable_min)}</td>
      <td className="money">
        {pounds(event.invoicing)}
        {event.pending > 0 ? <div className="sub">+ {event.pending} pending</div> : null}
      </td>
      <td>
        {event.violations === 0 ? (
          <span className="muted">none</span>
        ) : (
          <span className="rp-nowrap">
            {event.violations}
            {event.unresolved > 0 ? (
              <span className="rp-amber"> · {event.unresolved} unresolved</span>
            ) : null}
          </span>
        )}
      </td>
      <td>
        <div className="rp-status">
          <Pill tone={INVOICE_STATUS_TONE[status]}>{INVOICE_STATUS_LABEL[status]}</Pill>
          {event.signoff_stale ? <span className="muted sm">changed since sign-off</span> : null}
        </div>
      </td>
    </tr>
  );
}
