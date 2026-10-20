import Link from 'next/link';
import { Alert, KpiTile, Note, Panel, Pill, TableScroll, TileGrid } from '@thc/ui';
import type { TimeFormat } from '@thc/domain';
import type { InvoiceEvent } from '../data';
import {
  INVOICE_STATUS_LABEL,
  INVOICE_STATUS_TONE,
  dayLabel,
  exportHref,
  hours,
  invoiceEventHref,
  invoicePdfHref,
  invoiceEmailState,
  invoiceSendNote,
  readyEventNote,
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
 * Tab 4 · Invoicing (ADR-0172, ADR-0176) — not in §9.9. Since ADR-0176 the
 * system issues the invoices itself: one per PO, emailed at 10:00 UK the
 * morning after the last event on it, with the sign-in and sign-out log.
 *
 * One row per event dated in the range. The status is the database's
 * (`invoice_events`): Check-out open → Missing check-out → Needs review
 * (only an event with a violation) → Ready to invoice → Invoiced.
 */
export function InvoicingTab({
  view,
  events,
  today,
  format,
}: {
  view: ReportView;
  events: InvoiceEvent[];
  today: string;
  format?: TimeFormat;
}) {
  const last = lastWeek(today);
  const current = thisWeek(today);
  const onLast = view.from === last.from && view.to === last.to;
  const onThis = view.from === current.from && view.to === current.to;

  const by = (status: InvoiceStatus) => events.filter((e) => invoiceStatus(e.status) === status);
  const invoiced = by('invoiced');
  const ready = by('ready');
  const review = by('review');
  const missing = by('missing');
  const sum = (list: InvoiceEvent[]) => list.reduce((total, e) => total + num(e.invoicing), 0);
  // What was invoiced, not today's live lines (ADR-0176: an issued invoice is never re-priced).
  const sumInvoiced = (list: InvoiceEvent[]) =>
    list.reduce((total, e) => total + num(e.invoiced_amount ?? e.invoicing), 0);

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
          label="Invoiced"
          tone="ok"
          value={poundsWhole(sumInvoiced(invoiced))}
          description={`${invoiced.length} ${invoiced.length === 1 ? 'event' : 'events'} · final; emailed with the sign-in log`}
        />
        <KpiTile
          label="Ready to invoice"
          value={poundsWhole(sum(ready))}
          description={`${ready.length} ${ready.length === 1 ? 'event' : 'events'} · each row says when it sends`}
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
      </TileGrid>

      <Alert tone="cyan">
        <b>Invoices go out by themselves.</b> One invoice per PO Number (an event without one is
        invoiced on its own), emailed to the client&apos;s accounts contact with the sign-in and
        sign-out log attached (GPS-verified times), at 10:00 UK the morning after the last event on
        the PO. An event is ready once every worker has checked out (or a manager has entered their
        finish time); an event with any violation also needs a manager to mark it reviewed. Events
        before 26/10/2026 are not invoiced by the system: invoice them from the CSV.
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
                  events.map((event) => (
                    <EventRow key={event.event_id} event={event} format={format} />
                  ))
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
          <b>Export ready CSV</b> has one row per shift of every Ready event the system does not
          invoice itself (events before 26/10/2026), with the PO Number and a total row per event,
          for your accounting tool. Every other event is invoiced by the system, so it is never in
          the CSV: keying it in as well would bill it twice.
        </Note>
      </div>
    </div>
  );
}

function EventRow({ event, format }: { event: InvoiceEvent; format?: TimeFormat }) {
  const status = invoiceStatus(event.status);
  const note =
    status === 'ready'
      ? readyEventNote(event.send_verdict ?? null, event.sends_at ?? null, format, event.invoicing)
      : status === 'invoiced'
        ? null
        : invoiceSendNote(event.send_verdict ?? null, event.sends_at ?? null, format);
  const email = status === 'invoiced' ? invoiceEmailState(event, format) : null;
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
          {status === 'invoiced' && event.invoice_id ? (
            <a href={invoicePdfHref(event.invoice_id)} className="rp-nowrap">
              <Pill tone="green">Invoice {event.invoice_number}</Pill>
            </a>
          ) : (
            <Pill tone={INVOICE_STATUS_TONE[status]}>{INVOICE_STATUS_LABEL[status]}</Pill>
          )}
          {email && email.tone !== 'green' ? (
            <span className={email.tone === 'coral' ? 'rp-coral sm' : 'muted sm'}>
              {email.text}
            </span>
          ) : null}
          {event.signoff_stale ? <span className="muted sm">changed since sign-off</span> : null}
          {note && (status === 'ready' || status === 'review' || status === 'missing') ? (
            <span className="muted sm">{note}</span>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
