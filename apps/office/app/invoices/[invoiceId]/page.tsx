import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DEFAULT_SENDER_ADDRESSES } from '@thc/notifications';
import { Alert, Note, Panel, Pill, TableScroll } from '@thc/ui';
import { NotAvailable } from '../../_components/NotAvailable';
import { OfficeShell } from '../../_components/OfficeShell';
import { currentOfficeRole, officeUser } from '../../_components/officeUser';
import { officeCan } from '../../_lib/permissions';
import { ScheduledWindow, ViewerZone } from '../../reports/_components/zone';
import { ResendInvoice } from '../../reports/invoicing/[eventId]/ResendInvoice';
import { InvoiceActions } from '../_components/InvoiceActions';
import { XeroRetry } from '../_components/XeroRetry';
import type { EmailInit } from '../_components/EmailModal';
import { defaultInvoiceEmail } from '../_lib/compose';
import { loadComposer, loadInvoiceDetail } from '../_lib/data';
import { employeeIdLabel, hours, hoursFromMin, pounds, ukDate, ukStamp } from '../_lib/format';
import type { InvoiceDetail, InvoiceLineRow } from '../_lib/types';
import {
  FORMAT_LABEL,
  SOURCE_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  XERO_LABEL,
  XERO_TONE,
  invoiceCan,
  jobHref,
  voidXeroNote,
  xeroRetryable,
} from '../_lib/view-model';
import '../../reports/reports.css';
import '../invoices.css';

export const metadata = { title: 'Invoice · THC Back Office' };

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /invoices/:invoiceId — `wireframes/backoffice/invoice-detail.html`
 * (ADR-0210; audit §2.5): the summary card with Xero's state, the line
 * items, what the invoice covers, the timeline and the send history. Every
 * figure was fixed when the number was taken; this page adds nothing up and
 * rewrites nothing. Finance only; a viewer sees all of it and writes
 * nothing (ADR-0060).
 */
export default async function Page({ params }: { params: Promise<{ invoiceId: string }> }) {
  const role = await currentOfficeRole();
  if (role && !officeCan(role, 'finance')) {
    return <NotAvailable activeHref="/invoices" title="Invoice" role={role} needs="finance" />;
  }
  const { invoiceId } = await params;
  if (!UUID.test(invoiceId)) notFound();

  const data = await loadInvoiceDetail(invoiceId);
  if (data.problem) {
    return (
      <OfficeShell activeHref="/invoices" title="Invoice">
        <Alert tone="coral">{data.problem}</Alert>
      </OfficeShell>
    );
  }
  const invoice = data.invoice;
  if (!invoice) notFound();

  const canWrite = officeCan(role, 'write');
  const can = invoiceCan(invoice.status, invoice.source);
  const xeroNote = voidXeroNote(invoice.xero?.status);

  let mail: EmailInit | null = null;
  if (can.email) {
    const [composer, user] = await Promise.all([loadComposer(), officeUser()]);
    const email = defaultInvoiceEmail(invoice);
    mail = {
      userId: composer.userId,
      userName: user?.name ?? composer.email ?? 'You',
      userEmail: composer.email,
      platformSender: DEFAULT_SENDER_ADDRESSES.timesheets,
      to: invoice.billTo.emails.length > 0 ? invoice.billTo.emails : invoice.recipients,
      cc: invoice.clientCcEmails,
      subject: email.subject,
      bodyHtml: email.bodyHtml,
      attachments: [
        ...(invoice.pdfPath
          ? [
              {
                path: invoice.pdfPath,
                label: invoice.fileName ?? `Invoice ${invoice.number}.pdf`,
                size: null,
              },
            ]
          : []),
        ...(invoice.excel
          ? [{ path: invoice.excel.path, label: invoice.excel.name, size: invoice.excel.size ?? null }]
          : []),
        ...invoice.sources.map((source) => ({
          path: source.path,
          label: source.name,
          size: source.size ?? null,
        })),
      ],
    };
  }

  return (
    <OfficeShell
      activeHref="/invoices"
      title={`Invoice #${invoice.number}`}
      crumbs={
        <>
          <Link href="/invoices">← Back to Invoices</Link> · {invoice.billTo.name || invoice.clientName}
        </>
      }
      timezone={<ViewerZone />}
    >
      <div className="stack">
        <div className="inv-head">
          <Pill tone={STATUS_TONE[invoice.status]} large>
            {STATUS_LABEL[invoice.status]}
          </Pill>
          <span className="muted">Created {ukStamp(invoice.createdAt)} UK</span>
          <div className="right">
            <InvoiceActions
              invoiceId={invoice.id}
              number={invoice.number}
              source={invoice.source}
              can={can}
              hasExcel={invoice.excel !== null}
              canWrite={canWrite}
              xeroNote={xeroNote}
              mail={mail}
            />
          </div>
        </div>

        {invoice.status === 'void' ? (
          <Alert tone="coral">
            <b>Void.</b> This invoice was voided {invoice.voidedAt ? `on ${ukStamp(invoice.voidedAt)} UK` : ''}
            {invoice.voidReason ? <>: &ldquo;{invoice.voidReason}&rdquo;</> : null}. Its number is
            retired and never reused.
            {xeroNote ? <> {xeroNote}</> : null}
          </Alert>
        ) : null}
        {invoice.status === 'failed' || invoice.status === 'drawing' ? (
          <Alert tone={invoice.status === 'failed' ? 'coral' : 'amber'}>
            {invoice.status === 'failed' ? (
              <>
                <b>The PDF could not be drawn.</b> {invoice.lastError ?? ''}{' '}
              </>
            ) : (
              <>
                <b>The PDF is still being drawn.</b>{' '}
              </>
            )}
            {invoice.source === 'timesheet'
              ? 'Re-draw it: the number and the lines are final already.'
              : 'The next run prepares and emails it by itself.'}
          </Alert>
        ) : null}

        <Panel title="Summary">
          <div className="inv-summary">
            <div className="kv">
              <span className="k">Client</span>
              <span>
                <Link href={`/clients/${invoice.clientId}`}>{invoice.billTo.name || invoice.clientName}</Link>
              </span>
              <span className="k">Contact</span>
              <span>{invoice.billTo.contact || <span className="muted">—</span>}</span>
              <span className="k">Contact email</span>
              <span className="mono">
                {invoice.billTo.emails.length > 0 ? invoice.billTo.emails.join(', ') : '—'}
              </span>
              <span className="k">Venue</span>
              <span>{invoice.billTo.venue || invoice.events[0]?.venue || '—'}</span>
              <span className="k">Event</span>
              <span>
                {ukDate(invoice.periodFrom)}
                {invoice.periodTo !== invoice.periodFrom ? ` – ${ukDate(invoice.periodTo)}` : ''}
              </span>
              <span className="k">PO</span>
              <span className="mono">{invoice.poNumber ?? '—'}</span>
              <span className="k">Type</span>
              <span className="row wrap">
                <Pill tone={invoice.source === 'timesheet' ? 'purple' : 'neutral'}>
                  {SOURCE_LABEL[invoice.source]}
                </Pill>
                <Pill tone={invoice.billTo.format === 'named' ? 'cyan' : 'neutral'}>
                  {FORMAT_LABEL[invoice.source === 'events' ? 'log' : (invoice.billTo.format ?? 'named')]}
                </Pill>
              </span>
              <span className="k">Invoice date</span>
              <span>
                {ukDate(invoice.invoiceDate)}{' '}
                <span className="muted">· due {ukDate(invoice.dueDate)} ({invoice.termsDays} days)</span>
              </span>
              <span className="k">Xero</span>
              <XeroLine invoice={invoice} canWrite={canWrite} />
            </div>
            <div className="inv-money" aria-label="Totals">
              <div className="line">
                <span className="muted">Subtotal</span>
                <span>{pounds(invoice.net)}</span>
              </div>
              <div className="line">
                <span className="muted">VAT ({invoice.vatRate}%)</span>
                <span>{pounds(invoice.vat)}</span>
              </div>
              <div className="line due">
                <span>Amount due</span>
                <span>{pounds(invoice.total)}</span>
              </div>
              <div className="muted xs">{hours(hoursFromMin(invoice.payableMin))} payable hours</div>
            </div>
          </div>
          {invoice.source === 'events' && canWrite && invoice.events[0] ? (
            <div className="rp-status" style={{ justifyContent: 'flex-start', marginTop: 12 }}>
              {invoice.status === 'queued' || invoice.status === 'failed' || invoice.status === 'drawing' ? (
                <ResendInvoice
                  invoiceId={invoice.id}
                  eventId={invoice.events[0].id}
                  retry={invoice.status !== 'queued'}
                />
              ) : null}
            </div>
          ) : null}
        </Panel>

        <Panel title={`Line items (${invoice.lines.length})`} flush>
          <div className="panel-b tight">
            <LineItems invoice={invoice} />
          </div>
        </Panel>

        <Panel title="Linked shifts">
          {invoice.source === 'timesheet' ? (
            <div className="stack tight">
              <span>
                {invoice.lines.length} {invoice.lines.length === 1 ? 'row' : 'rows'} from the uploaded timesheet.
              </span>
              {invoice.timesheetJobId ? (
                <span>
                  From job: <Link href={jobHref(invoice.timesheetJobId)}>View Processing Job</Link>
                </span>
              ) : null}
            </div>
          ) : invoice.events.length === 0 ? (
            <span className="muted">No events are linked to this invoice.</span>
          ) : (
            <ul className="stack tight" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {invoice.events.map((event) => (
                <li key={event.id}>
                  <Link href={`/reports/invoicing/${event.id}`}>{event.title}</Link>{' '}
                  <span className="muted">
                    · {ukDate(event.date)}
                    {event.venue ? ` · ${event.venue}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="grid c2">
          <Panel title="Timeline">
            <ul className="inv-timeline">
              <li>
                <span className="when">{ukStamp(invoice.createdAt)} UK</span>
                <span>
                  <b>Generated</b> · number {invoice.number} taken
                </span>
              </li>
              <li>
                <span className="when">{invoice.sentAt ? `${ukStamp(invoice.sentAt)} UK` : '—'}</span>
                <span>{invoice.sentAt ? <b>Sent</b> : <span className="muted">Not sent yet</span>}</span>
              </li>
              {invoice.voidedAt ? (
                <li>
                  <span className="when">{ukStamp(invoice.voidedAt)} UK</span>
                  <span>
                    <b>Voided</b>
                    {invoice.voidReason ? <> · {invoice.voidReason}</> : null}
                  </span>
                </li>
              ) : null}
            </ul>
          </Panel>

          <Panel title="Send history" flush>
            <div className="panel-b tight">
              <TableScroll label="Send history" minWidth="28rem">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>When (UK)</th>
                      <th>By</th>
                      <th>To</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.sends.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="muted">
                          {invoice.source === 'events' && invoice.sentAt
                            ? 'Emailed by the system with the sign-in log (INV1).'
                            : 'Not sent yet.'}
                        </td>
                      </tr>
                    ) : (
                      invoice.sends.map((send) => (
                        <tr key={send.id}>
                          <td className="rp-nowrap">{ukStamp(send.at)}</td>
                          <td>{send.by ?? 'Office'}</td>
                          <td>
                            {send.to.join(', ')}
                            {send.cc.length > 0 ? <div className="muted xs">Cc {send.cc.join(', ')}</div> : null}
                            {send.bcc.length > 0 ? <div className="muted xs">Bcc {send.bcc.join(', ')}</div> : null}
                            <div className="muted xs">{send.subject}</div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </TableScroll>
            </div>
          </Panel>
        </div>

        {can.void && canWrite ? (
          <Note tone="coral">
            <b>Danger zone.</b> Voiding keeps the invoice and its number, which is never reused;
            {invoice.source === 'timesheet' ? ' the timesheet rows go back to review.' : ''} A
            correction is a void and a new invoice, or a credit note raised in Xero.
          </Note>
        ) : null}
      </div>
    </OfficeShell>
  );
}

function XeroLine({ invoice, canWrite }: { invoice: InvoiceDetail; canWrite: boolean }) {
  const x = invoice.xero;
  if (!x) return <span className="muted">Not queued for Xero (queued once the invoice is generated)</span>;
  return (
    <span className="stack tight">
      <span className="row wrap">
        <Pill tone={XERO_TONE[x.status]}>{XERO_LABEL[x.status]}</Pill>
        {x.xeroInvoiceId ? (
          <a
            className="mono xs"
            href={`https://go.xero.com/app/invoicing/view/${encodeURIComponent(x.xeroInvoiceId)}`}
            target="_blank"
            rel="noreferrer"
          >
            {x.xeroInvoiceId}
          </a>
        ) : null}
        {x.xeroStatus ? <span className="muted xs">Xero status {x.xeroStatus}</span> : null}
        {canWrite && xeroRetryable(x.status) ? <XeroRetry invoiceId={invoice.id} /> : null}
      </span>
      {x.status === 'mismatch' && x.xeroTotal !== null ? (
        <span className="rp-coral sm">
          Xero total {pounds(x.xeroTotal)} differs from ours {pounds(invoice.total)}. Check it in Xero.
        </span>
      ) : null}
      {x.lastError && x.status !== 'synced' ? <span className="muted sm">{x.lastError}</span> : null}
      {x.syncedAt ? <span className="muted xs">Pushed as a Draft {ukStamp(x.syncedAt)} UK</span> : null}
    </span>
  );
}

function lineHours(line: InvoiceLineRow): number {
  return line.hours ?? hoursFromMin(line.payableMin);
}

function LineItems({ invoice }: { invoice: InvoiceDetail }) {
  const timesheet = invoice.source === 'timesheet';
  const aggregated = timesheet && invoice.billTo.format === 'aggregated';
  const dateLabel = invoice.billTo.dateLabel || 'Date';

  return (
    <TableScroll label="Line items" minWidth="46rem">
      <table className="tbl">
        <thead>
          <tr>
            <th>{timesheet ? dateLabel : 'Date'}</th>
            {timesheet ? null : <th>Staff</th>}
            <th>Role</th>
            {timesheet && !aggregated ? <th>Staff</th> : null}
            {aggregated ? <th className="money">No. of staff</th> : null}
            {timesheet ? null : <th>Scheduled</th>}
            {timesheet ? null : <th className="money">Break</th>}
            <th className="money">Hours</th>
            <th className="money">Rate</th>
            <th className="money">Total</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.length === 0 ? (
            <tr>
              <td colSpan={9} className="muted">
                This invoice has no lines.
              </td>
            </tr>
          ) : (
            invoice.lines.map((line) => (
              <tr key={line.id}>
                <td className="rp-nowrap">{ukDate(line.lineDate)}</td>
                {timesheet ? null : (
                  <td>
                    {line.staffName}{' '}
                    {line.employeeId !== null ? (
                      <span className="muted mono">{employeeIdLabel(line.employeeId)}</span>
                    ) : null}
                  </td>
                )}
                <td>{line.roleName}</td>
                {timesheet && !aggregated ? (
                  <td>
                    {line.kind === 'custom' ? <span className="muted">Expense</span> : line.staffName}{' '}
                    {line.employeeId !== null ? (
                      <span className="muted mono">{employeeIdLabel(line.employeeId)}</span>
                    ) : null}
                  </td>
                ) : null}
                {aggregated ? <td className="money">{line.kind === 'custom' ? '' : (line.staffCount ?? 1)}</td> : null}
                {timesheet ? null : (
                  <td>
                    {line.startsAt && line.endsAt ? (
                      <ScheduledWindow startsAt={line.startsAt} endsAt={line.endsAt} />
                    ) : (
                      '—'
                    )}
                  </td>
                )}
                {timesheet ? null : (
                  <td className="money">{line.breakMin > 0 ? `${line.breakMin} min` : '—'}</td>
                )}
                <td className="money">
                  {line.kind === 'custom' ? `${hours(line.quantity ?? 0)} ×` : hours(lineHours(line))}
                </td>
                <td className="money">{pounds(line.rate)}</td>
                <td className="money">{pounds(line.amount)}</td>
              </tr>
            ))
          )}
          <tr className="rp-total">
            <td colSpan={timesheet ? (aggregated ? 5 : 5) : 7}>
              <b>Subtotal</b>
            </td>
            <td className="money">
              <b>{pounds(invoice.net)}</b>
            </td>
          </tr>
        </tbody>
      </table>
    </TableScroll>
  );
}
