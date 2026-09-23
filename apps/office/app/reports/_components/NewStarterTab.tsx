import { Alert, Avatar, Panel, Pill } from '@thc/ui';
import type { NewStarter } from '../data';
import {
  dottedDate,
  employeeId,
  exportHref,
  formatUkStamp,
  maskNi,
  newStarterPeriod,
  periodLabel,
  sendStatus,
} from '../view-model';
import type { ReportSend, ReportView } from '../view-model';
import { RetrySend } from './RetrySend';
import { SendStatus } from './SendStatus';

/**
 * Tab 3 · New Starter (HMRC) report (§9.9). Pick a date, see who will be in
 * the report, export. "Entirely different" from payroll — separate columns,
 * separate CSV, never merged — and only NEW workers who ACTUALLY WORKED a
 * shift in the week before the picked date's week.
 */
export function NewStarterTab({
  view,
  starters,
  sends,
}: {
  view: ReportView;
  starters: NewStarter[];
  sends: ReportSend[];
}) {
  const period = newStarterPeriod(view.date);
  const latest = sends[0] ?? null;

  return (
    <div className="stack">
      <div className="rp-toolbar">
        <form method="get" action="/reports" className="daterange">
          <input type="hidden" name="tab" value="newstarter" />
          <span className="label">Pick a date</span>
          <input
            className="input"
            type="date"
            name="date"
            defaultValue={view.date}
            aria-label="Pick a date"
            required
          />
          <button type="submit" className="btn sm">
            Preview
          </button>
        </form>
        <span className="muted sm">
          → new workers who <b>actually worked</b> a shift in the week before that date (
          {periodLabel(period.from, period.to)})
        </span>
        <div className="right">
          <SendStatus
            send={latest}
            detail={latest?.status === 'sent' ? `${latest.row_count ?? 0} new starters` : undefined}
          />
          <a className="btn sm primary" href={exportHref(view)}>
            Export CSV
          </a>
        </div>
      </div>

      <Alert tone="cyan">
        Only NEW workers who actually worked a shift last week — not every new starter, only those
        who need to be paid. Onboarded on a Friday, first shift two weeks later → they appear in
        that Monday&apos;s report (§9.9). Columns and data are entirely different from
        payroll&apos;s and are never merged. Role and a title / salutation field are explicitly
        excluded.
      </Alert>

      <Panel
        title={
          <>
            Preview · {starters.length} {starters.length === 1 ? 'person' : 'people'} will be in the
            report
          </>
        }
        actions={
          <span className="muted sm">
            HMRC Statement is the letter derived from the three routed questions (§2.8); the worker
            never saw it
          </span>
        }
        flush
      >
        <div className="panel-b tight table-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Staff</th>
                <th>Employee ID</th>
                <th>NI Number</th>
                <th>Home address</th>
                <th>Postcode</th>
                <th>Country</th>
                <th>Date of birth</th>
                <th>Gender</th>
                <th>First shift date</th>
                <th>HMRC Statement</th>
                <th>Student Loan</th>
              </tr>
            </thead>
            <tbody>
              {starters.length === 0 ? (
                <tr>
                  <td colSpan={11} className="muted">
                    No new starters worked a shift in {periodLabel(period.from, period.to)}.
                  </td>
                </tr>
              ) : (
                starters.map((s, index) => {
                  const masked = maskNi(s.ni_number);
                  return (
                    <tr key={s.staff_id}>
                      <td>
                        <span className="person">
                          <Avatar name={s.staff_name} size="sm" deleted={s.removed} />
                          <span className={s.removed ? 'muted rp-nowrap' : 'rp-nowrap'}>
                            {s.staff_name}
                          </span>
                        </span>
                      </td>
                      <td className="mono sm rp-nowrap">{employeeId(s.employee_id)}</td>
                      <td className="mono sm">
                        {masked ?? <span className="muted">—</span>}
                        {masked && index === 0 ? (
                          <span className="sub">full number in the CSV</span>
                        ) : null}
                        {!masked ? (
                          <span className="sub">
                            not yet issued — payroll runs without it; E6 when added
                          </span>
                        ) : null}
                      </td>
                      <td className="sm">{s.home_address ?? '—'}</td>
                      <td className="mono sm rp-nowrap">{s.postcode ?? '—'}</td>
                      <td className="sm">{s.country ?? '—'}</td>
                      <td className="mono sm">{dottedDate(s.date_of_birth)}</td>
                      <td className="mono sm">{s.gender ?? '—'}</td>
                      <td className="mono sm">{dottedDate(s.first_shift_date)}</td>
                      <td>
                        {s.hmrc_statement ? (
                          <Pill tone="cyan">{s.hmrc_statement}</Pill>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="sm">{s.student_loan ?? '—'}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="Send status · history"
        actions={
          <span className="muted sm">
            each tab shows the last-sent date/time and a status (§9.9)
          </span>
        }
      >
        <div className="rp-history">
          {sends.length === 0 ? (
            <span className="muted sm">No Monday run has happened yet.</span>
          ) : null}
          {sends.map((send) => {
            const status = sendStatus(send);
            return (
              <div className="row" key={send.id}>
                <span className="mono sm muted when">
                  {formatUkStamp(send.created_at ?? send.period_end)}
                </span>
                <span className={`sent ${status.tone}`}>{status.text}</span>
                <span className="sm muted">
                  {periodLabel(send.period_start, send.period_end)} ·{' '}
                  {send.status === 'no_new'
                    ? 'a week with no new starters — nothing was due; only the payroll CSV went out'
                    : `${send.row_count ?? 0} new starter${send.row_count === 1 ? '' : 's'} · one email with the payroll CSV`}
                  {send.status === 'failed' && send.error ? ` · ${send.error}` : ''}
                </span>
                {send.status === 'failed' ? <RetrySend sendId={send.id} /> : null}
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
