import Link from 'next/link';
import { Alert, EmptyState, Panel, Pill } from '@thc/ui';
import { OfficeShell } from '../../_components/OfficeShell';
import type { MonthReport } from '../data';
import {
  SCOPE_LABELS,
  SCOPE_SHORT,
  SCOPE_TONE,
  WORKER_LABEL,
  formatHours,
  formatMinutes,
  monthLabel,
  shiftMonth,
  summariseTime,
  ticketRef,
} from '../view-model';
import '../tickets.css';

/**
 * The month's time, grouped for an invoice (ADR-0202): billable and total
 * hours, by scope label, by who did the work, and ticket by ticket, with a
 * CSV of every entry. Dates are UK days. Timers still running are counted
 * once stopped.
 */
export function TimeReportScreen({ month, report }: { month: string; report: MonthReport }) {
  const summary = summariseTime(report.rows);
  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  return (
    <OfficeShell
      activeHref="/tickets"
      title="Time report"
      crumbs={<Link href="/tickets">← All tickets</Link>}
    >
      <div className="tk-monthbar">
        <Link className="btn sm" href={`/tickets/time?month=${prev}`}>
          ← {monthLabel(prev)}
        </Link>
        <h2 className="tk-h2">{monthLabel(month)}</h2>
        <Link className="btn sm" href={`/tickets/time?month=${next}`}>
          {monthLabel(next)} →
        </Link>
        {report.rows.length > 0 ? (
          <a className="btn sm primary" href={`/tickets/time/export?month=${month}`}>
            Download CSV
          </a>
        ) : null}
      </div>

      {report.problem ? <Alert tone="coral">{report.problem}</Alert> : null}
      {report.running > 0 ? (
        <Alert tone="amber">
          {report.running === 1 ? 'A timer is' : `${report.running} timers are`} still running and
          not counted below until stopped.
        </Alert>
      ) : null}

      {report.rows.length === 0 && !report.problem ? (
        <EmptyState>No time was logged in {monthLabel(month)}.</EmptyState>
      ) : null}

      {report.rows.length > 0 ? (
        <>
          <div className="tk-totals">
            <Panel title="Billable">
              <div className="tk-big">{formatHours(summary.billableMinutes)} h</div>
              <div className="tk-meta">{formatMinutes(summary.billableMinutes)}</div>
            </Panel>
            <Panel title="All time logged">
              <div className="tk-big">{formatHours(summary.minutes)} h</div>
              <div className="tk-meta">
                Me {formatMinutes(summary.byWorker.owner)} · {WORKER_LABEL.claude}{' '}
                {formatMinutes(summary.byWorker.claude)}
              </div>
            </Panel>
          </div>

          <Panel title="By scope label">
            <table className="tk-time">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Time</th>
                  <th>Billable</th>
                </tr>
              </thead>
              <tbody>
                {[...SCOPE_LABELS, 'unlabelled' as const].map((key) => {
                  const row = summary.byLabel[key];
                  if (row.minutes === 0) return null;
                  return (
                    <tr key={key}>
                      <td>
                        {key === 'unlabelled' ? (
                          <Pill tone="neutral">Not labelled</Pill>
                        ) : (
                          <Pill tone={SCOPE_TONE[key]}>{SCOPE_SHORT[key]}</Pill>
                        )}
                      </td>
                      <td>
                        {formatHours(row.minutes)} h{' '}
                        <span className="hint">({formatMinutes(row.minutes)})</span>
                      </td>
                      <td>{formatHours(row.billableMinutes)} h</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>

          <Panel title="By ticket">
            <table className="tk-time">
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Label</th>
                  <th>Time</th>
                  <th>Billable</th>
                </tr>
              </thead>
              <tbody>
                {summary.tickets.map((t) => (
                  <tr key={t.ticketNo}>
                    <td>
                      {ticketRef(t.ticketNo)} · {t.title}
                    </td>
                    <td>
                      {t.label ? (
                        <Pill tone={SCOPE_TONE[t.label]}>{SCOPE_SHORT[t.label]}</Pill>
                      ) : (
                        <Pill tone="neutral">Not labelled</Pill>
                      )}
                    </td>
                    <td>{formatHours(t.minutes)} h</td>
                    <td>{formatHours(t.billableMinutes)} h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </>
      ) : null}
    </OfficeShell>
  );
}
