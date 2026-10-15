'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Alert, Button, EmptyState, Panel, Pill, SearchInput, Select, TableScroll } from '@thc/ui';
import { OfficeShell } from '../../_components/OfficeShell';
import { useListQuery } from '../../_lib/listQuery';
import { linkRosterEntry, loadRoster, removeRosterEntries, setRemindersEnabled } from './actions';
import { EmailsPanel } from './EmailsPanel';
import type { EmailPreview } from './email-previews';
import type { StaffEmailReport } from './emails';
import { MatchesPanel, ReminderPanel, RosterKpis } from './ReminderReport';
import {
  KEPT_REASONS,
  KEPT_REASON_LABEL,
  keptExplanation,
  keptLinkable,
  reminderSummary,
} from './report';
import type { RosterKept, RosterReportData } from './report';
import './roster.css';
import { REASON_TEXT } from './reasons';
import type { RosterReport } from './actions';
import type { RosterEntry } from './data';
import {
  GROUP_LABEL,
  PAYROLL_LABEL,
  ROSTER_CLEARED,
  ROSTER_QUERY,
  STANDING_LABEL,
  filterRoster,
  isFiltered,
  parseRosterFilter,
  reasonCounts,
  rosterExportHref,
  rosterIndex,
  standingCounts,
  ukDate,
} from './list';
import type { RosterIndex } from './list';

/**
 * /staff/roster — the invite list (ADR-0107).
 *
 * Paste the sheet (copied straight from a spreadsheet, or saved as CSV) with
 * a header row: Email, First name, Last name, Payroll ID, Group. Group says
 * which people are SpudBros Express and which are THC. When someone applies
 * with an email on the list they get that group and Payroll ID, whichever
 * link they used; anyone already in the system gets it applied now. What
 * remains below is "invited, not applied yet".
 *
 * Above it (ADR-0123): where the invited people stand, the daily reminder
 * (IR1, ADR-0122) and what it has done, and the people who applied under
 * another email, with a Link that gives them their Payroll ID and group.
 * Then every email staff receive while moving onto the new app, with its
 * numbers and a View of the email itself (ADR-0141).
 *
 * The list filters by group, by where each person stands and by a search,
 * kept in the address bar, and Export CSV downloads exactly what is shown
 * (ADR-0138).
 */
export function RosterScreen({
  waiting,
  reminders,
  emails,
  previews,
  problem,
  emailsProblem,
  canEdit,
  canWrite,
}: {
  waiting: RosterEntry[];
  reminders: RosterReportData | null;
  /** "Emails staff receive" (ADR-0141): the numbers, and each email rendered. */
  emails: StaffEmailReport | null;
  previews: EmailPreview[];
  problem: string | null;
  emailsProblem: string | null;
  /** Owner or manager: load the list, remove rows, Link (Payroll IDs). */
  canEdit: boolean;
  /** Any office login that may write: turn the daily reminder on or off. */
  canWrite: boolean;
}) {
  const [text, setText] = useState('');
  const [report, setReport] = useState<RosterReport | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const load = () => {
    setFailure(null);
    setReport(null);
    start(async () => {
      const result = await loadRoster(text);
      if (result.ok) {
        setReport(result.report);
        setText('');
      } else setFailure(result.message);
    });
  };

  const remove = (ids: string[] | null) => {
    if (
      ids === null &&
      !window.confirm(
        `Clear the whole invite list? All ${waiting.length} rows are removed, whatever the filter shows, and nobody on it is matched when they apply.`,
      )
    )
      return;
    setFailure(null);
    start(async () => {
      const result = await removeRosterEntries(ids);
      if (!result.ok) setFailure(result.message);
    });
  };

  const [linked, setLinked] = useState<string | null>(null);
  const link = (entryId: string, staffId: string, confirmName = false) => {
    setFailure(null);
    setLinked(null);
    start(async () => {
      const result = await linkRosterEntry(entryId, staffId, confirmName);
      if (!result.ok) setFailure(result.message);
      else
        setLinked(
          result.spudbros === 'held_upcoming_shifts'
            ? 'Linked, with their Payroll ID. They have upcoming THC shifts, so they were not switched to SpudBros Express: do that on their profile once those are done.'
            : 'Linked: they have their Payroll ID and group, and the daily reminder stops.',
        );
    });
  };

  const toggle = (enabled: boolean) => {
    if (
      !enabled &&
      !window.confirm(
        'Turn off the daily reminder? Nobody will be emailed until it is turned on again, and any reminders still waiting to go today are cancelled.',
      )
    )
      return;
    setFailure(null);
    setLinked(null);
    start(async () => {
      const result = await setRemindersEnabled(enabled);
      if (!result.ok) setFailure(result.message);
      else
        setLinked(
          result.enabled
            ? 'The daily reminder is on: it goes out once a day, at the first hourly run from 10:00 (UK time).'
            : `The daily reminder is off.${result.cancelled > 0 ? ` ${result.cancelled} waiting to go today were cancelled.` : ''}`,
        );
    });
  };

  const spud = waiting.filter((row) => row.grp === 'spudbros').length;
  const index = rosterIndex(reminders);
  const [url, setUrl] = useListQuery(ROSTER_QUERY);
  // Without the report nobody can be told apart by status, so the Status
  // filter and the export (which needs it too) are not offered.
  const parsed = parseRosterFilter(url);
  const filter = reminders ? parsed : { ...parsed, status: 'all' as const, reason: 'all' as const };
  const shown = filterRoster(waiting, filter, index);
  const counts = standingCounts(waiting, filter.grp, index);
  const cuts = reasonCounts(waiting, filter, index);
  const filtered = isFiltered(filter);

  /**
   * Link a row whose person applied with the listed email but has no Payroll
   * ID (ADR-0143). A different name asks first, naming both: only the office
   * can say they are the same person.
   */
  const linkKept = (row: RosterEntry, kept: RosterKept) => {
    if (kept.reason === 'name_differs') {
      const sheet = [row.first_name, row.last_name].filter(Boolean).join(' ') || 'no name';
      if (
        !window.confirm(
          `The sheet says ${sheet}; they applied as ${kept.staffName || 'no name'}. Link them only if they are the same person.${row.payroll_id ? ` They get Payroll ID ${row.payroll_id}` : ' They get their group'} and come off the list.`,
        )
      )
        return;
      link(row.id, kept.staffId, true);
      return;
    }
    link(row.id, kept.staffId);
  };

  return (
    <OfficeShell
      activeHref="/staff"
      title="Invite list"
      crumbs={
        <>
          <Link href="/staff">Staff</Link> / <b>Invite list</b> · {waiting.length} waiting · {spud}{' '}
          SpudBros Express · {waiting.length - spud} THC
        </>
      }
    >
      {problem ? <Alert tone="coral">{problem}</Alert> : null}
      {linked ? <Alert tone="green">{linked}</Alert> : null}
      {failure && !text ? <Alert tone="coral">{failure}</Alert> : null}

      {reminders ? (
        <>
          <RosterKpis report={reminders} />
          <ReminderPanel
            report={reminders}
            canToggle={canWrite}
            pending={pending}
            onToggle={toggle}
          />
          <MatchesPanel
            report={reminders}
            waiting={waiting}
            canEdit={canEdit}
            pending={pending}
            onLink={link}
          />
        </>
      ) : null}

      <EmailsPanel report={emails} previews={previews} problem={emailsProblem} />

      <Panel title="Load the list">
        <p className="muted sm">
          One row per person, with a header row: <b>Email</b>, <b>First name</b>, <b>Last name</b>,{' '}
          <b>Payroll ID</b>, <b>Group</b> (SpudBros Express or THC). Paste it straight from the
          spreadsheet. When someone applies with an email on this list they are marked SpudBros
          Express or THC and given their Payroll ID — whichever link they used. People already in
          the system get it applied now.
        </p>
        <textarea
          className="input"
          style={{ width: '100%', minHeight: 160, fontFamily: 'monospace' }}
          aria-label="Invite list"
          placeholder={
            'Email\tFirst name\tLast name\tPayroll ID\tGroup\nsam@example.com\tSam\tSpud\t1641A\tSpudBros Express'
          }
          value={text}
          disabled={!canEdit || pending}
          onChange={(event) => setText(event.target.value)}
        />
        <div style={{ marginTop: 8 }}>
          <Button
            tone="primary"
            disabled={!canEdit || pending || text.trim() === ''}
            onClick={load}
          >
            {pending ? 'Loading…' : 'Load list'}
          </Button>
          {!canEdit ? <span className="muted sm"> Your login is read-only.</span> : null}
        </div>
        {failure && text ? <Alert tone="coral">{failure}</Alert> : null}
        {report ? <ReportView report={report} /> : null}
      </Panel>

      <Panel title={`Invited, not applied yet (${waiting.length})`}>
        {waiting.length === 0 ? (
          <EmptyState>
            <h3>Nobody is waiting</h3>
            <p>Everyone on the list has applied, or no list has been loaded.</p>
          </EmptyState>
        ) : (
          <>
            <div className="toolbar">
              <Select
                aria-label="Group"
                value={filter.grp}
                onChange={(event) => setUrl({ grp: event.target.value })}
                style={{ width: 190 }}
              >
                <option value="all">All groups</option>
                <option value="spudbros">{GROUP_LABEL.spudbros}</option>
                <option value="thc">{GROUP_LABEL.thc}</option>
              </Select>
              {reminders ? (
                <Select
                  aria-label="Status"
                  value={filter.status}
                  onChange={(event) => setUrl({ status: event.target.value })}
                  style={{ width: 230 }}
                >
                  <option value="all">Any status ({counts.all})</option>
                  <option value="waiting">
                    {STANDING_LABEL.waiting} · no possible match ({counts.waiting})
                  </option>
                  <option value="match">
                    {STANDING_LABEL.match} ({counts.match})
                  </option>
                  <option value="applied">
                    {STANDING_LABEL.applied} ({counts.applied})
                  </option>
                </Select>
              ) : null}
              <Select
                aria-label="Payroll ID"
                value={filter.payroll}
                onChange={(event) => setUrl({ payroll: event.target.value })}
                style={{ width: 230 }}
              >
                <option value="all">Any Payroll ID ({cuts.payroll.all})</option>
                <option value="with">
                  {PAYROLL_LABEL.with} ({cuts.payroll.with})
                </option>
                <option value="without">
                  {PAYROLL_LABEL.without} ({cuts.payroll.without})
                </option>
              </Select>
              {reminders ? (
                <Select
                  aria-label="Why no Payroll ID"
                  value={filter.reason}
                  onChange={(event) => setUrl({ reason: event.target.value })}
                  style={{ width: 260 }}
                >
                  <option value="all">Any reason ({cuts.reason.all} applied)</option>
                  {KEPT_REASONS.map((reason) => (
                    <option key={reason} value={reason}>
                      {KEPT_REASON_LABEL[reason]} ({cuts.reason[reason]})
                    </option>
                  ))}
                </Select>
              ) : null}
              <SearchInput
                aria-label="Search the invite list"
                placeholder="Search name, email, Payroll ID"
                value={url.q}
                onChange={(event) => setUrl({ q: event.target.value }, 'replace')}
              />
              <div className="right">
                {shown.length > 0 && reminders ? (
                  <a
                    className="btn ghost sm"
                    href={rosterExportHref(filter)}
                    download
                    aria-label={`Export CSV of the ${shown.length} rows shown, a spreadsheet that opens in Excel`}
                  >
                    Export CSV ({shown.length})
                  </a>
                ) : null}
                {canEdit ? (
                  <Button size="sm" tone="outline" disabled={pending} onClick={() => remove(null)}>
                    Clear all {waiting.length}
                  </Button>
                ) : null}
              </div>
            </div>
            {filtered ? (
              <p className="muted sm" role="status">
                Showing {shown.length} of {waiting.length}.{' '}
                <Button size="sm" tone="ghost" onClick={() => setUrl(ROSTER_CLEARED)}>
                  Clear filters
                </Button>
              </p>
            ) : null}
            {shown.length === 0 ? (
              <EmptyState>
                <h3>Nobody matches</h3>
                <p>Nobody on the list fits these filters and search.</p>
              </EmptyState>
            ) : (
              <TableScroll label="Invite list" minWidth="48rem">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Name</th>
                      <th>Payroll ID</th>
                      <th>Group</th>
                      <th>Status · daily reminder</th>
                      <th>Loaded</th>
                      {canEdit ? <th aria-label="Remove" className="cell-actions" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((row) => (
                      <tr key={row.id}>
                        <td>{row.email}</td>
                        <td>{[row.first_name, row.last_name].filter(Boolean).join(' ') || '—'}</td>
                        <td className="mono">{row.payroll_id ?? '—'}</td>
                        <td>
                          <Pill tone={row.grp === 'spudbros' ? 'cyan' : undefined}>
                            {GROUP_LABEL[row.grp]}
                          </Pill>
                        </td>
                        <td className="sm">
                          <ReminderCell row={row} reminders={reminders} index={index} />
                        </td>
                        <td className="sm muted">{ukDate(row.loaded_at)}</td>
                        {canEdit ? (
                          <td className="cell-actions">
                            <KeptLink
                              row={row}
                              kept={index.kept(row)}
                              pending={pending}
                              onLink={linkKept}
                            />
                            <Button
                              size="sm"
                              tone="ghost"
                              disabled={pending}
                              onClick={() => remove([row.id])}
                            >
                              Remove
                            </Button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </>
        )}
      </Panel>
    </OfficeShell>
  );
}

function ReportView({ report }: { report: RosterReport }) {
  const rows = [
    ...report.held.map((row) => ({ ...row, kind: 'Held' })),
    ...report.skipped.map((row) => ({ ...row, kind: 'Not taken' })),
  ];
  return (
    <div style={{ marginTop: 8 }}>
      <Alert tone={rows.length > 0 ? 'amber' : 'green'}>
        <b>{report.loaded} added to the list</b> · {report.updated} already here and updated
        {rows.length > 0 ? ` · ${rows.length} need a look` : ''}
      </Alert>
      {rows.length > 0 ? (
        <table className="tbl">
          <thead>
            <tr>
              <th />
              <th>Email</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={`${row.email ?? ''}-${i}`}>
                <td>{row.kind}</td>
                <td>{row.email ?? '—'}</td>
                <td>{REASON_TEXT[row.reason] ?? row.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

/**
 * One person's daily reminder (ADR-0122/0123): why they are not reminded, or
 * how many they have had and when, and a bounced address in coral.
 */
function ReminderCell({
  row,
  reminders,
  index,
}: {
  row: RosterEntry;
  reminders: RosterReportData | null;
  index: RosterIndex;
}) {
  const standing = index.standing(row);
  const matched = standing === 'match';
  if (standing === 'applied') return <KeptCell row={row} kept={index.kept(row)} />;
  if (row.grp !== 'thc') return <span className="muted">Not reminded (SpudBros)</span>;
  const mine = reminders?.reminders[row.email];
  return (
    <>
      {matched ? (
        <Pill tone="amber" title="Applied under another email: link them above">
          Possible match
        </Pill>
      ) : null}{' '}
      {mine?.lastError ? (
        <Pill tone="coral" title={mine.lastError}>
          Not delivered
        </Pill>
      ) : null}{' '}
      <span className={mine?.sent ? undefined : 'muted'}>{reminderSummary(mine)}</span>
    </>
  );
}

/**
 * An applied row with no Payroll ID (ADR-0143): the status, why, and who
 * applied — or, for a taken Payroll ID, who holds it — each a link to the
 * profile where the office settles it.
 */
function KeptCell({ row, kept }: { row: RosterEntry; kept: RosterKept | undefined }) {
  return (
    <div className="roster-kept">
      <Pill tone="amber">Applied · no Payroll ID</Pill>
      {kept ? (
        <div className="sm muted">
          {keptExplanation(kept, row.payroll_id)}{' '}
          <Link href={`/staff/${kept.staffId}`}>Open {kept.staffName || 'their profile'}</Link>
          {kept.reason === 'payroll_id_taken' && kept.holderId ? (
            <>
              {' · '}
              <Link href={`/staff/${kept.holderId}`}>Open {kept.holderName || 'the holder'}</Link>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Link for an applied row Link can settle; none where the office must decide on a profile. */
function KeptLink({
  row,
  kept,
  pending,
  onLink,
}: {
  row: RosterEntry;
  kept: RosterKept | undefined;
  pending: boolean;
  onLink: (row: RosterEntry, kept: RosterKept) => void;
}) {
  if (!kept || !keptLinkable(kept)) return null;
  return (
    <Button
      size="sm"
      tone="primary"
      disabled={pending}
      onClick={() => onLink(row, kept)}
      aria-label={`Link ${row.email} to ${kept.staffName || 'the person who applied'}`}
    >
      Link
    </Button>
  );
}
