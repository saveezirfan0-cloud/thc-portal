import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, KpiTile, Note, Panel, Pill, TableScroll, TileGrid } from '@thc/ui';
import { NotAvailable } from '../../../_components/NotAvailable';
import { OfficeShell } from '../../../_components/OfficeShell';
import { currentOfficeRole } from '../../../_components/officeUser';
import { officeCan } from '../../../_lib/permissions';
import { currentTimeFormat } from '../../../_lib/timeFormat';
import { VIOLATION_LABEL } from '../../../checkin/status';
import { ActualTime, ScheduledWindow, ViewerZone } from '../../_components/zone';
import { loadInvoiceEvent } from '../../data';
import type { InvoiceLine, InvoiceViolation } from '../../data';
import {
  INVOICE_STATUS_HINT,
  INVOICE_STATUS_LABEL,
  INVOICE_STATUS_TONE,
  breakLabel,
  dayLabel,
  employeeId,
  formatUkStamp,
  hours,
  invoiceEventExportHref,
  invoiceEmailState,
  invoicePdfHref,
  invoiceStatus,
  invoicedAmountChanged,
  pounds,
  reportHref,
  parseReportView,
  readyEventNote,
  weekStart,
  addDays,
} from '../../view-model';
import { ResendInvoice } from './ResendInvoice';
import { SignOffForm } from './SignOffForm';
import '../../reports.css';

export const metadata = { title: 'Invoicing · THC Back Office' };

// The status moves as workers check out and managers resolve violations.
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /reports/invoicing/:eventId — one event's invoice lines, every violation
 * on it, and the manager's sign-off (ADR-0172). Every figure and the
 * status come from the database (20261021150000); this page adds nothing up.
 */
export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const role = await currentOfficeRole();
  if (role && !officeCan(role, 'finance')) {
    return <NotAvailable activeHref="/reports" title="Invoicing" role={role} needs="finance" />;
  }

  const { eventId } = await params;
  if (!UUID.test(eventId)) notFound();
  const [data, format] = await Promise.all([loadInvoiceEvent(eventId), currentTimeFormat()]);

  if (data.problem) {
    return (
      <OfficeShell activeHref="/reports" title="Invoicing">
        <Alert tone="coral">{data.problem}</Alert>
      </OfficeShell>
    );
  }
  const event = data.event;
  if (!event) notFound();

  const status = invoiceStatus(event.status);
  const from = weekStart(event.event_date);
  const back = reportHref(parseReportView({ tab: 'invoicing' }, event.event_date), {
    from,
    to: addDays(from, 6),
  });
  const canSign = officeCan(role, 'write') && officeCan(role, 'finance');
  const unresolved = data.violations.filter((v) => !v.resolved).length;

  return (
    <OfficeShell
      activeHref="/reports"
      title={event.event_title}
      crumbs={
        <>
          <Link href={back}>Reports · Invoicing</Link> · {event.client_name} ·{' '}
          {dayLabel(event.event_date)} · PO <b>{event.po_number ?? '—'}</b>
        </>
      }
      timezone={<ViewerZone />}
    >
      <div className="stack">
        <div className="rp-status">
          <Pill tone={INVOICE_STATUS_TONE[status]}>{INVOICE_STATUS_LABEL[status]}</Pill>
          <span className="muted">{INVOICE_STATUS_HINT[status]}</span>
        </div>

        {status === 'invoiced' && event.invoice_id ? (
          <InvoicePanel
            invoiceId={event.invoice_id}
            eventId={event.event_id}
            number={event.invoice_number ?? null}
            email={invoiceEmailState(event, format)}
            canResend={canSign}
            changed={invoicedAmountChanged(event.invoicing, event.invoiced_amount)}
            invoiced={event.invoiced_amount ?? null}
            live={event.invoicing}
          />
        ) : null}
        {status === 'ready' ? (
          <Alert tone="cyan">
            {readyEventNote(
              event.send_verdict ?? null,
              event.sends_at ?? null,
              format,
              event.invoicing,
            )}
            .
          </Alert>
        ) : null}

        <TileGrid columns={4}>
          <KpiTile
            label="Amount"
            tone={status === 'ready' || status === 'invoiced' ? 'ok' : 'default'}
            value={pounds(event.invoicing)}
            description={
              event.pending > 0
                ? `+ ${event.pending} pending — no amount until the finish time is entered`
                : 'payable hours × charge rate'
            }
          />
          <KpiTile
            label="Payable hours"
            value={hours(event.payable_min)}
            description="after unpaid breaks"
          />
          <KpiTile
            label="Shifts charged"
            value={event.billable_shifts}
            description={`${event.no_shows} no-show · ${event.turned_away} turned away · not charged`}
          />
          <KpiTile
            label="Violations"
            tone={unresolved > 0 ? 'warn' : 'default'}
            value={data.violations.length}
            description={`${unresolved} unresolved`}
          />
        </TileGrid>

        {event.signed_off_at ? (
          <Alert tone={event.signoff_stale ? 'amber' : 'green'}>
            {event.signoff_stale ? (
              <b>Changed since it was marked reviewed. Review it again. </b>
            ) : null}
            Marked reviewed by <b>{event.signed_off_by_name ?? 'a manager'}</b> on{' '}
            {formatUkStamp(event.signed_off_at, format)} UK for {pounds(event.signed_invoicing)}:{' '}
            &ldquo;{event.signoff_note}&rdquo;
          </Alert>
        ) : null}

        <Panel
          title="Violations on this event"
          actions={
            <Link className="btn sm" href="/checkin">
              Open Check-in to resolve
            </Link>
          }
          flush
        >
          <div className="panel-b tight">
            <TableScroll label="Violations" minWidth="44rem">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Staff</th>
                    <th>Role</th>
                    <th>Violation</th>
                    <th>Detected</th>
                    <th>Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {data.violations.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="muted">
                        No violations on this event.
                      </td>
                    </tr>
                  ) : (
                    data.violations.map((v) => <ViolationRow key={v.violation_id} v={v} />)
                  )}
                </tbody>
              </table>
            </TableScroll>
          </div>
        </Panel>

        <Panel
          title="Invoice lines"
          actions={
            status === 'ready' || status === 'invoiced' ? (
              <a
                className="btn sm primary"
                href={invoiceEventExportHref(event.event_id, event.event_date)}
              >
                Download CSV
              </a>
            ) : null
          }
          flush
        >
          <div className="panel-b tight">
            <TableScroll label="Invoice lines" minWidth="60rem">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Staff</th>
                    <th>Role</th>
                    <th>Scheduled</th>
                    <th>Check in</th>
                    <th>Check out</th>
                    <th className="money">Break</th>
                    <th className="money">Payable hours</th>
                    <th className="money">Charge rate</th>
                    <th className="money">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map((line) => (
                    <LineRow key={line.booking_id} line={line} />
                  ))}
                  <tr className="rp-total">
                    <td colSpan={6}>
                      <b>Total</b>
                    </td>
                    <td className="money">
                      <b>{hours(event.payable_min)}</b>
                    </td>
                    <td />
                    <td className="money">
                      <b>{pounds(event.invoicing)}</b>
                    </td>
                  </tr>
                </tbody>
              </table>
            </TableScroll>
          </div>
        </Panel>

        {status === 'review' ? (
          <Panel title="Mark reviewed for invoicing">
            {canSign ? (
              <div className="stack">
                <p className="muted">
                  Check every violation above, resolved or not, and the lines. A genuine no-show
                  stays unresolved and is not charged. Once marked, the event is ready and its
                  invoice is emailed with the sign-in and sign-out log at the next 10:00 UK.
                </p>
                <SignOffForm
                  eventId={event.event_id}
                  fingerprint={event.fingerprint}
                  again={Boolean(event.signed_off_at)}
                />
              </div>
            ) : (
              <p className="muted">Only an owner or a manager can mark an event reviewed.</p>
            )}
          </Panel>
        ) : null}

        <Note>
          The amount uses the same figures as the Financial tab: payable hours (check-in to
          check-out within the scheduled time, unpaid breaks deducted) × the role&apos;s charge
          rate. The system issues the invoice itself (ADR-0176) and emails it with the GPS-verified
          sign-in and sign-out log at 10:00 UK the morning after the last event on the PO; an event
          dated before 26/10/2026 is invoiced from the CSV instead.
        </Note>
      </div>
    </OfficeShell>
  );
}

function ViolationRow({ v }: { v: InvoiceViolation }) {
  return (
    <tr>
      <td>
        {v.staff_name} <span className="muted mono">{employeeId(v.employee_id)}</span>
      </td>
      <td>{v.role_name}</td>
      <td>
        {VIOLATION_LABEL[v.type]}
        {v.type === 'late' && v.minutes_late ? (
          <span className="muted"> · {v.minutes_late} min</span>
        ) : null}
      </td>
      <td>
        <ActualTime at={v.detected_at} className="mono" />
      </td>
      <td>
        {v.resolved ? (
          <>
            <Pill tone="green">Resolved</Pill>{' '}
            <span className="muted">
              {v.resolved_by_name ?? 'a manager'}: &ldquo;{v.resolution_note}&rdquo;
            </span>
          </>
        ) : (
          <Pill tone={v.type === 'no_checkout' ? 'coral' : 'amber'}>Unresolved</Pill>
        )}
      </td>
    </tr>
  );
}

function LineRow({ line }: { line: InvoiceLine }) {
  const pending = line.status === 'pending';
  return (
    <tr className={pending ? 'rp-pending' : undefined}>
      <td>
        {line.staff_name} <span className="muted mono">{employeeId(line.employee_id)}</span>
      </td>
      <td>{line.role_name}</td>
      <td>
        <ScheduledWindow startsAt={line.starts_at} endsAt={line.ends_at} />
      </td>
      {line.kind === 'worked' ? (
        <>
          <td className={line.late_check_in ? 'rp-amber' : undefined}>
            <ActualTime at={line.check_in_at} className="mono" />
          </td>
          <td className={line.early_check_out ? 'rp-amber' : undefined}>
            {pending && !line.check_out_at ? (
              <Pill tone="coral">No check-out</Pill>
            ) : (
              <ActualTime at={line.check_out_at} className="mono" />
            )}
            {line.no_check_out_unresolved && line.check_out_at ? (
              <div>
                <Pill tone="coral">No check-out · unresolved</Pill>
              </div>
            ) : null}
          </td>
        </>
      ) : (
        <td colSpan={2}>
          <Pill>{KIND_LABEL[line.kind]}</Pill>
        </td>
      )}
      <td className="money">
        {line.unpaid_break_min > 0 ? breakLabel(line.unpaid_break_min) : '—'}
      </td>
      <td className="money">{pending ? 'Pending' : hours(line.payable_min)}</td>
      <td className="money">{pounds(line.charge_rate)}</td>
      <td className="money">{pending ? '—' : pounds(line.invoicing)}</td>
    </tr>
  );
}

const KIND_LABEL: Record<Exclude<InvoiceLine['kind'], 'worked'>, string> = {
  no_show: 'No-show · not charged',
  turned_away: 'Turned away · not charged',
  cancelled_on_day: 'Cancelled on the day · charged in full',
};

/** The issued invoice (ADR-0176): its PDF, where its email is, Send again. */
function InvoicePanel({
  invoiceId,
  eventId,
  number,
  email,
  canResend,
  changed,
  invoiced,
  live,
}: {
  invoiceId: string;
  eventId: string;
  number: number | null;
  email: ReturnType<typeof invoiceEmailState>;
  canResend: boolean;
  changed: boolean;
  invoiced: number | string | null;
  live: number | string;
}) {
  return (
    <Panel title={<>Invoice {number}</>}>
      <div className="stack" style={{ gap: 10 }}>
        <div className="rp-status">
          <Pill tone={email.tone}>{email.text}</Pill>
          <a href={invoicePdfHref(invoiceId)}>Download the invoice PDF</a>
        </div>
        {changed ? (
          <Alert tone="amber">
            <b>Changed since it was invoiced.</b> This event was invoiced at {pounds(invoiced ?? 0)}
            ; its lines now come to {pounds(live)}. An issued invoice is never corrected: raise a
            credit note or a further invoice in your accounting tool.
          </Alert>
        ) : null}
        {canResend && email.resendable ? (
          <ResendInvoice invoiceId={invoiceId} eventId={eventId} retry={email.retry === true} />
        ) : null}
      </div>
    </Panel>
  );
}
