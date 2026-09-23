import Link from 'next/link';
import { Alert, KpiTile, Note, TileGrid } from '@thc/ui';
import type { PayrollLine, PayrollPerson } from '../data';
import {
  exportHref,
  hoursKpi,
  lastWeek,
  periodLabel,
  pounds,
  poundsWhole,
  reportHref,
} from '../view-model';
import type { ReportSend, ReportView } from '../view-model';
import { PeopleTable } from './PeopleTable';
import { RangeForm } from './RangeForm';
import { SendStatus } from './SendStatus';

/**
 * Tab 2 · Payroll report (§9.9).
 *
 * The period summary, then one row per person — Staff · Employee ID ·
 * Shifts · Payable hours · Base · Holiday · Total payroll — expanding to
 * every shift with the scheduled and actual times side by side. Pending
 * (an unresolved No check-out) is shown and never priced; a change made
 * after a shift was exported is shown as a warning, never as a corrected
 * export (§3.3, RULE-06).
 */
export function PayrollTab({
  view,
  people,
  lines,
  sends,
  today,
}: {
  view: ReportView;
  people: PayrollPerson[];
  lines: PayrollLine[];
  sends: ReportSend[];
  today: string;
}) {
  const total = people.find((p) => p.is_total) ?? null;
  const persons = people.filter((p) => !p.is_total);
  const last = lastWeek(today);
  const onLastWeek = view.from === last.from && view.to === last.to;
  const latest = sends[0] ?? null;
  const changed = total?.changed_since_export ?? 0;

  return (
    <div className="stack">
      <div className="rp-toolbar">
        <Link
          className={`btn sm${onLastWeek ? ' primary' : ''}`}
          href={reportHref(view, { ...last })}
        >
          Last week
        </Link>
        <RangeForm view={view} />
        <span className="rp-annot">
          &quot;Last week&quot; sets Mon–Sun of the previous week itself
        </span>
        <div className="right">
          <SendStatus
            send={latest}
            detail={
              latest && latest.row_count !== null
                ? `payroll CSV · ${latest.row_count} rows`
                : undefined
            }
          />
          <a className="btn sm primary" href={exportHref(view)}>
            Export CSV
          </a>
        </div>
      </div>

      <TileGrid columns={4}>
        <KpiTile
          label="Workers on shifts"
          value={total?.workers ?? 0}
          description={periodLabel(view.from, view.to)}
        />
        <KpiTile
          label="Shifts"
          value={total?.shifts ?? 0}
          description={`${total?.pending ?? 0} pending · ${total?.turned_away ?? 0} turned away`}
        />
        <KpiTile
          label="Total to be paid"
          tone="accent"
          value={poundsWhole(total?.total)}
          description={
            <>
              base {pounds(total?.base)} · holiday {pounds(total?.holiday)}{' '}
              <span className="rp-annot">payroll normally takes base</span>
            </>
          }
        />
        <KpiTile
          label="Payable hours"
          value={hoursKpi(total?.payable_min)}
          description="after unpaid-break deductions"
        />
      </TileGrid>

      {changed > 0 ? (
        <Alert tone="amber">
          <b>
            {changed} {changed === 1 ? 'shift has' : 'shifts have'} changed since{' '}
            {changed === 1 ? 'it was' : 'they were'} exported.
          </b>{' '}
          Payroll exports are never corrected retroactively: the figure finance was sent stands, and
          the difference is shown on the shift below. Please notify Finance so it is settled in
          THC&apos;s own process (§3.3).
        </Alert>
      ) : null}

      <PeopleTable people={persons} lines={lines} />

      <div className="grid c2">
        <Note>
          <b>CSV export: one row per SHIFT, never averaged</b> — a person working waiting at £14 and
          a senior role at more in the same week gets a line per shift with the exact rate; 5 + 4 +
          2 shifts = 11 rows, not 3. Every row carries the Employee ID (§9.9). Columns: Employee ID
          · Staff · Event · Client · Role · Date · Scheduled start–end · Check in · Check out ·
          Break deduction · Payable hours · Rate · Base · Holiday · Total.
        </Note>
        <Note>
          <b>Held out:</b> a shift with an unresolved &quot;No check-out&quot; Violation shows
          Pending and is excluded from the export until a manager resolves it; if still unresolved
          when Monday&apos;s run fires, it goes out with the following Monday&apos;s CSV (§7 BG-08).
          Everything else is read-only — a timesheet is never edited by hand.
        </Note>
      </div>
    </div>
  );
}
