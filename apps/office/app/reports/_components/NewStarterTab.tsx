import type { ReactNode } from 'react';
import {
  Alert,
  Avatar,
  ColumnCellsFor,
  ColumnChooserFor,
  ColumnHeadsFor,
  Panel,
  Pill,
  TableScrollFor,
} from '@thc/ui';
import type { ColumnDef } from '@thc/ui';
import type { TimeFormat } from '@thc/domain';
import type { NewStarter } from '../data';
import {
  dottedDate,
  employeeId,
  exportHref,
  formatUkStamp,
  maskBank,
  maskNi,
  newStarterPeriod,
  periodLabel,
  sendStatus,
} from '../view-model';
import type { ReportSend, ReportView } from '../view-model';
import { RetrySend } from './RetrySend';
import { SendStatus } from './SendStatus';

/**
 * The preview's columns, declared once (ADR-0139): Staff stays first. Only
 * the preview follows the choice — the CSV and the Monday email always
 * carry every column. The whole of /reports is finance-only (ADR-0056);
 * the bank column says so too, for ADR-0061.
 */
const LIST = 'reports.newstarter';
const COLUMNS = [
  { id: 'staff', label: 'Staff', required: true },
  { id: 'employee-id', label: 'Employee ID' },
  { id: 'ni', label: 'NI Number' },
  { id: 'address', label: 'Home address' },
  { id: 'postcode', label: 'Postcode' },
  { id: 'country', label: 'Country' },
  { id: 'dob', label: 'Date of birth' },
  { id: 'gender', label: 'Gender' },
  { id: 'first-shift', label: 'First shift date' },
  { id: 'hmrc', label: 'HMRC Statement' },
  { id: 'loan', label: 'Student Loan' },
  { id: 'bank', label: 'Bank details', finance: true },
] as const satisfies readonly ColumnDef[];
type ColumnId = (typeof COLUMNS)[number]['id'];

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
  format,
}: {
  view: ReportView;
  starters: NewStarter[];
  sends: ReportSend[];
  format?: TimeFormat;
}) {
  const period = newStarterPeriod(view.date);
  const latest = sends[0] ?? null;

  return (
    <div className="stack">
      <div className="rp-toolbar filters">
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
        that Monday&apos;s report. Columns and data are entirely different from payroll&apos;s and
        are never merged. Role and a title / salutation field are explicitly excluded. The report is
        emailed to Payroll and Gisela on its own every Monday from 09:00, and not at all for a week
        with nobody new.
      </Alert>

      <Panel
        title={
          <>
            Preview · {starters.length} {starters.length === 1 ? 'person' : 'people'} will be in the
            report
          </>
        }
        actions={
          <>
            <span className="muted sm">
              HMRC Statement is the letter derived from the three routed questions; the worker never
              saw it
            </span>
            <ColumnChooserFor list={LIST} defs={COLUMNS} label="New starters" />
          </>
        }
        flush
      >
        <div className="panel-b tight">
          <TableScrollFor list={LIST} defs={COLUMNS} label="New starters" minWidth="56rem">
            <table className="tbl">
              <thead>
                <tr>
                  <ColumnHeadsFor list={LIST} defs={COLUMNS} />
                </tr>
              </thead>
              <tbody>
                {starters.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="muted">
                      No new starters worked a shift in {periodLabel(period.from, period.to)}.
                    </td>
                  </tr>
                ) : (
                  starters.map((s, index) => {
                    const masked = maskNi(s.ni_number);
                    const bank = maskBank(s.bank_sort_code, s.bank_account_number);
                    const cells: Record<ColumnId, ReactNode> = {
                      staff: (
                        <td>
                          <span className="person">
                            <Avatar name={s.staff_name} size="sm" deleted={s.removed} />
                            <span className={s.removed ? 'muted rp-nowrap' : 'rp-nowrap'}>
                              {s.staff_name}
                            </span>
                          </span>
                        </td>
                      ),
                      'employee-id': (
                        <td className="mono sm rp-nowrap">{employeeId(s.employee_id)}</td>
                      ),
                      ni: (
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
                      ),
                      address: <td className="sm">{s.home_address ?? '—'}</td>,
                      postcode: <td className="mono sm rp-nowrap">{s.postcode ?? '—'}</td>,
                      country: <td className="sm">{s.country ?? '—'}</td>,
                      dob: <td className="mono sm">{dottedDate(s.date_of_birth)}</td>,
                      gender: <td className="mono sm">{s.gender ?? '—'}</td>,
                      'first-shift': <td className="mono sm">{dottedDate(s.first_shift_date)}</td>,
                      hmrc: (
                        <td>
                          {s.hmrc_statement ? (
                            <Pill tone="cyan">{s.hmrc_statement}</Pill>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      ),
                      loan: <td className="sm">{s.student_loan ?? '—'}</td>,
                      bank: (
                        <td className="sm">
                          {s.bank_account_holder ??
                            (bank ? null : <span className="muted">—</span>)}
                          {bank ? <span className="sub mono rp-nowrap">{bank}</span> : null}
                          {bank && index === 0 ? (
                            <span className="sub">full details in the CSV</span>
                          ) : null}
                          {!bank && !s.removed ? (
                            <span className="sub">not given yet — blank in the CSV</span>
                          ) : null}
                        </td>
                      ),
                    };
                    return (
                      <tr key={s.staff_id}>
                        <ColumnCellsFor list={LIST} defs={COLUMNS} cells={cells} />
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </TableScrollFor>
        </div>
      </Panel>

      <Panel
        title="Send status · history"
        actions={
          <span className="muted sm">each tab shows the last-sent date/time and a status</span>
        }
      >
        <div className="rp-history">
          {sends.length === 0 ? (
            <span className="muted sm">No Monday run has happened yet.</span>
          ) : null}
          {sends.map((send) => {
            const status = sendStatus(send, format);
            return (
              <div className="row" key={send.id}>
                <span className="mono sm muted when">
                  {formatUkStamp(send.created_at ?? send.period_end, format)}
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
