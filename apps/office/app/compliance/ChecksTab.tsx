'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Alert,
  Avatar,
  EmptyState,
  KpiTile,
  Panel,
  Pill,
  SegToggle,
  TileGrid,
  useTimeFormat,
} from '@thc/ui';
import { ukStampFull } from '../_lib/rtwCheck';
import { checkCounts, checkLine, elapsedLabel, filterChecks } from './checks';
import type { CheckFilter, CheckMonitorData } from './checks';

/**
 * Tab 3 · gov.uk checks (ADR-0025, ADR-0041).
 *
 * The automated share-code check, watched: what is queued, running or being
 * retried, how long each has taken, what finished and how, and whether the
 * runner is alive at all. Read-only. A result that needs a decision is
 * decided on Needs review, not here.
 */
export function ChecksTab({
  monitor,
  enabled,
  onOpenReview,
}: {
  monitor: CheckMonitorData;
  /** settings.rtw_check.enabled. */
  enabled: boolean;
  onOpenReview: () => void;
}) {
  const format = useTimeFormat();
  const [filter, setFilter] = useState<CheckFilter>('all');
  const counts = checkCounts(monitor.checks);
  const shown = filterChecks(monitor.checks, filter);
  const { lastRun, now } = monitor;

  return (
    <section className="stack" aria-label="gov.uk checks">
      {monitor.problem ? <Alert tone="coral">{monitor.problem}</Alert> : null}
      {!enabled ? (
        <Alert tone="amber">
          The automatic gov.uk check is switched off (settings.rtw_check.enabled), so nothing below
          will run. Share codes are checked by hand from the report.
        </Alert>
      ) : null}

      <TileGrid columns={4}>
        <KpiTile
          label="In progress"
          value={counts.progress}
          description="Queued, checking with gov.uk, or waiting to retry"
        />
        <KpiTile
          tone={counts.review > 0 ? 'warn' : 'default'}
          label="Waiting for you"
          value={counts.review}
          description="A result is in — compare the photo, then Verify or Reject"
        />
        <KpiTile
          tone={counts.problems > 0 ? 'danger' : 'default'}
          label="Stopped · not running"
          value={counts.problems}
          description="Gave up after every attempt, or the runner has not touched it"
        />
        <KpiTile
          tone={monitor.waiting.length > 0 ? 'warn' : 'default'}
          label="Filed, no check yet"
          value={monitor.waiting.length}
          description="A share code on a pending document with no check started"
        />
      </TileGrid>

      <Panel
        title="The runner"
        actions={
          <Pill tone={!lastRun ? 'coral' : lastRun.ok ? 'green' : 'coral'}>
            {!lastRun ? 'never ran' : lastRun.ok ? 'last run OK' : 'last run failed'}
          </Pill>
        }
      >
        {lastRun ? (
          <div className="sm stack tight">
            <div>
              Last pass <b>{ukStampFull(lastRun.startedAt, format)}</b> (
              {elapsedLabel(lastRun.startedAt, now)} ago) · claimed {lastRun.counts['claimed'] ?? 0}{' '}
              · passed {lastRun.counts['passed'] ?? 0} · needs review{' '}
              {lastRun.counts['needs_review'] ?? 0} · re-enter {lastRun.counts['rejected'] ?? 0} ·
              retry {lastRun.counts['queued'] ?? 0} · failed {lastRun.counts['failed'] ?? 0}
            </div>
            {lastRun.error ? <div className="coral">Error: {lastRun.error}</div> : null}
            <div className="muted">
              It runs every 10 minutes and picks up whatever is queued, so a new share code can wait
              up to 10 minutes before its first attempt. A pass that claims 0 with nothing queued is
              normal.
            </div>
          </div>
        ) : (
          <p className="sm muted">
            The runner has never run. Check that the <code>rtw-check</code> schedule is on, and that{' '}
            <code>RTW_GOVUK_ENABLED</code> and <code>RTW_JOB_SECRET</code> are set on the office
            project.
          </p>
        )}
      </Panel>

      {monitor.waiting.length > 0 ? (
        <Panel title="Share codes filed with no check started">
          <table className="tbl card-rows">
            <thead>
              <tr>
                <th>Who</th>
                <th>Filed</th>
                <th>Why there is no check</th>
              </tr>
            </thead>
            <tbody>
              {monitor.waiting.map((doc) => (
                <tr key={doc.docId}>
                  <td className="cell-title">
                    <Link href={`/staff/${doc.staffId}`}>{doc.name}</Link>
                  </td>
                  <td data-label="Filed" className="mono sm">
                    {ukStampFull(doc.filedAt, format)}
                  </td>
                  <td data-label="Why" className="sm muted">
                    {enabled
                      ? 'Filed before the check was switched on, or its start was refused. Open the profile and press “Run gov.uk check”.'
                      : 'The automatic check is off.'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ) : null}

      <div className="toolbar">
        <SegToggle
          options={[
            { value: 'all', label: 'All', count: monitor.checks.length },
            { value: 'progress', label: 'In progress', count: counts.progress },
            { value: 'review', label: 'Needs review', count: counts.review },
            { value: 'finished', label: 'Finished', count: counts.finished },
            {
              value: 'problems',
              label: 'Stopped',
              count: counts.problems,
              alert: counts.problems > 0,
            },
          ]}
          value={filter}
          onChange={setFilter}
          small
          aria-label="Filter the checks"
        />
        <div className="right">
          {counts.review > 0 ? (
            <button type="button" className="btn sm" onClick={onOpenReview}>
              Decide in Needs review →
            </button>
          ) : (
            <span className="muted sm">newest 100 · times are UK</span>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-b tight">
          {shown.length === 0 ? (
            <EmptyState>
              <h3>{monitor.checks.length === 0 ? 'No checks yet' : 'Nothing in this filter'}</h3>
              <p>
                A check starts when a candidate submits their documents with a share code, or a
                worker files a new one. Nothing is checked before that.
              </p>
            </EmptyState>
          ) : (
            <table className="tbl card-rows">
              <thead>
                <tr>
                  <th>Who</th>
                  <th>Status</th>
                  <th>Tries</th>
                  <th>Filed</th>
                  <th>Elapsed</th>
                  <th>What happened</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ check, name }) => {
                  const line = checkLine(check, now, format);
                  return (
                    <tr key={check.check_id}>
                      <td className="cell-title">
                        <div className="person">
                          <Avatar name={name} size="sm" />
                          <div>
                            <div className="n">
                              <Link href={`/staff/${check.staff_id}`}>{name}</Link>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td data-label="Status">
                        <Pill tone={line.tone}>{line.label}</Pill>
                      </td>
                      <td data-label="Tries" className="mono sm">
                        {line.tries}
                      </td>
                      <td data-label="Filed" className="mono sm">
                        {line.filed}
                      </td>
                      <td data-label="Elapsed" className="sm">
                        {line.elapsed}
                      </td>
                      <td data-label="What happened" className="sm muted">
                        {line.detail ?? '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}
