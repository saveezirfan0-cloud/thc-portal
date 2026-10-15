'use client';

import Link from 'next/link';
import { Button, EmptyState, KpiTile, Panel, Pill, TableScroll, TileGrid } from '@thc/ui';
import { formatDateAdded } from '../../_lib/addedBy';
import { ukStampFull } from '../../_lib/rtwCheck';
import type { RosterEntry } from './data';
import type { RosterReportData } from './report';
import {
  barHeights,
  dayLabel,
  reminderSchedule,
  remindersSending,
  share,
  statusLabel,
} from './report';

const GROUP_LABEL = { spudbros: 'SpudBros Express', thc: 'THC' } as const;

/**
 * The /staff/roster report (ADR-0123): who has not applied, the IR1 daily
 * reminders (ADR-0122) and what they have done, and the people who applied
 * under another email. Read from `invite_roster_report()`.
 */

/** The headline tiles: where the invited people stand. */
export function RosterKpis({ report }: { report: RosterReportData }) {
  const k = report.kpis;
  return (
    <TileGrid columns={5}>
      <KpiTile
        label="Not applied · THC"
        value={k.notAppliedThc}
        tone="accent"
        description="Getting the daily reminder"
      />
      <KpiTile
        label="Not applied · SpudBros"
        value={k.notAppliedSpudbros}
        description="Not reminded by email"
      />
      <KpiTile
        label="Applied from the list"
        value={k.appliedFromList}
        tone="ok"
        description="Matched on their listed email"
      />
      <KpiTile
        label="Applied under another email"
        value={k.possibleMatches}
        tone={k.possibleMatches > 0 ? 'warn' : 'default'}
        description={k.possibleMatches > 0 ? 'Link them below' : 'None found'}
      />
      <KpiTile
        label="Applied, no Payroll ID"
        value={k.appliedKept}
        tone={k.appliedKept > 0 ? 'warn' : 'default'}
        description={k.appliedKept > 0 ? 'Why, and Link, in the list below' : 'None'}
      />
    </TileGrid>
  );
}

/** The daily reminder (IR1): its On/Off, schedule, counts and the last fortnight. */
export function ReminderPanel({
  report,
  canToggle,
  pending,
  onToggle,
}: {
  report: RosterReportData;
  /** Any office login that may write (not the viewer). */
  canToggle: boolean;
  pending: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  const k = report.kpis;
  const rate = share(k.appliedAfterReminder, k.peopleReminded);
  const sending = remindersSending(report.settings);
  return (
    <Panel
      title="Daily reminders"
      actions={
        <>
          <Pill tone={sending ? 'green' : 'amber'} dot>
            {sending ? 'On' : 'Off'}
          </Pill>
          {canToggle ? (
            <Button
              size="sm"
              tone={report.settings.enabled ? 'outline' : 'primary'}
              disabled={pending}
              onClick={() => onToggle(!report.settings.enabled)}
            >
              {report.settings.enabled ? 'Turn off' : 'Turn on'}
            </Button>
          ) : null}
        </>
      }
    >
      <p className="muted sm">
        {reminderSchedule(report.settings)}. Everyone in the THC group below who has not applied
        gets one email a day until they apply. Removing someone from the list stops theirs.
        {k.lastSentAt ? ` Last sent ${ukStampFull(k.lastSentAt)}.` : ' None sent yet.'}
      </p>
      <TileGrid columns={6}>
        <KpiTile flat small label="Sent today" value={k.sentToday} />
        <KpiTile flat small label="Sent in all" value={k.sentTotal} />
        <KpiTile flat small label="People reminded" value={k.peopleReminded} />
        <KpiTile
          flat
          small
          label="Applied after a reminder"
          value={k.appliedAfterReminder}
          tone={k.appliedAfterReminder > 0 ? 'ok' : 'default'}
          description={rate === null ? undefined : `${rate}% of those reminded`}
        />
        <KpiTile
          flat
          small
          label="Failed"
          value={k.failedTotal}
          tone={k.failedTotal > 0 ? 'danger' : 'default'}
          description={k.failedTotal > 0 ? 'Usually a mistyped address' : undefined}
        />
        <KpiTile
          flat
          small
          label="Waiting to send"
          value={k.queued}
          description={k.queued > 0 ? 'Going out now, 30 a minute' : undefined}
        />
      </TileGrid>
      <SentChart report={report} />
    </Panel>
  );
}

/**
 * Reminders sent per UK day, the last 14 days: one series, so no legend; the
 * panel names it. Each bar's hover (and screen-reader label) gives the day,
 * sent and failed; the tiles above carry the totals.
 */
function SentChart({ report }: { report: RosterReportData }) {
  const heights = barHeights(report.daily);
  const total = report.daily.reduce((n, d) => n + d.sent, 0);
  return (
    <figure className="roster-chart" aria-label={`Reminders sent per day, last 14 days: ${total}`}>
      <figcaption className="k">Sent per day · last 14 days</figcaption>
      <div className="bars" role="list">
        {report.daily.map((d, i) => {
          const words = `${formatDateAdded(`${d.day}T12:00:00Z`)}: ${d.sent} sent${d.failed ? `, ${d.failed} failed` : ''}`;
          return (
            <div
              key={d.day}
              role="listitem"
              className={d.day === report.today ? 'bar today' : 'bar'}
              title={words}
              aria-label={words}
            >
              <span className="v">{d.sent > 0 ? d.sent : ''}</span>
              <span className="fill" style={{ height: `${heights[i]}%` }} />
              <span className="d">{dayLabel(d.day)}</span>
            </div>
          );
        })}
      </div>
    </figure>
  );
}

/** People who applied under a different email from the one on the list. */
export function MatchesPanel({
  report,
  waiting,
  canEdit,
  pending,
  onLink,
}: {
  report: RosterReportData;
  waiting: RosterEntry[];
  canEdit: boolean;
  pending: boolean;
  onLink: (entryId: string, staffId: string) => void;
}) {
  const byId = new Map(waiting.map((row) => [row.id, row]));
  const rows = report.matches.filter((m) => byId.has(m.entryId));
  return (
    <Panel title={`Applied under another email (${rows.length})`}>
      <p className="muted sm">
        These people are on the list under one email but applied with another, so the app could not
        match them: they have no Payroll ID or group yet, and they still get the daily reminder.
        Same first name and surname — check it is the same person, then Link. Linking gives them
        their Payroll ID and group and stops the reminders.
      </p>
      {rows.length === 0 ? (
        <EmptyState>
          <h3>Nobody to link</h3>
          <p>Everyone who applied used the email on the list.</p>
        </EmptyState>
      ) : (
        <TableScroll label="Reminder report" minWidth="44rem">
          <table className="tbl">
            <thead>
              <tr>
                <th>On the list</th>
                <th>Applied as</th>
                <th>Payroll ID</th>
                <th>Group</th>
                <th>Stage</th>
                {canEdit ? <th aria-label="Link" className="cell-actions" /> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const entry = byId.get(m.entryId)!;
                return (
                  <tr key={`${m.entryId}-${m.staffId}`}>
                    <td>
                      <b>{[entry.first_name, entry.last_name].filter(Boolean).join(' ')}</b>
                      <div className="sm muted">{entry.email}</div>
                    </td>
                    <td>
                      <Link href={`/staff/${m.staffId}`}>
                        <b>{m.staffName}</b>
                      </Link>
                      <div className="sm muted">
                        {m.staffEmail} · applied {formatDateAdded(m.appliedAt)}
                      </div>
                    </td>
                    <td className="mono">{entry.payroll_id ?? '—'}</td>
                    <td>
                      <Pill tone={entry.grp === 'spudbros' ? 'cyan' : undefined}>
                        {GROUP_LABEL[entry.grp]}
                      </Pill>
                    </td>
                    <td className="sm">{statusLabel(m.status)}</td>
                    {canEdit ? (
                      <td className="cell-actions">
                        <Button
                          size="sm"
                          tone="primary"
                          disabled={pending}
                          onClick={() => onLink(m.entryId, m.staffId)}
                        >
                          Link
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      )}
    </Panel>
  );
}
