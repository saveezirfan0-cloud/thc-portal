import Link from 'next/link';
import { EmptyState, Panel, Pill, TableScroll } from '@thc/ui';
import {
  JOB_STATUS_LABEL,
  JOB_STATUS_TONE,
  STALE_AFTER_DAYS,
  ageDays,
  plural,
  ukDateTime,
} from '../view-model';
import type { JobSummary } from '../types';
import { DiscardButton } from './DiscardButton';

/**
 * Jobs on /invoices/process. "Needs review" is every job still in review,
 * oldest first, with its age — the old tool left 21 of them for months
 * (audit §10.12) and nobody could see it. Recent jobs are the last few
 * that are not waiting for review.
 */
export function JobsList({
  title,
  empty,
  jobs,
  canAct,
  now,
  showAge,
}: {
  title: string;
  empty: string;
  jobs: JobSummary[];
  canAct: boolean;
  now: number;
  showAge?: boolean;
}) {
  return (
    <Panel title={title} flush>
      {jobs.length === 0 ? (
        <EmptyState>
          <p className="sm muted">{empty}</p>
        </EmptyState>
      ) : (
        <TableScroll label={title} minWidth="46rem">
          <table className="tbl pr-jobs">
            <thead>
              <tr>
                <th scope="col">Client</th>
                <th scope="col">Files</th>
                <th scope="col">Status</th>
                <th scope="col">Uploaded (UK time)</th>
                <th scope="col">Rows</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const days = ageDays(job.createdAt, now);
                const stale = showAge && days >= STALE_AFTER_DAYS;
                const files =
                  job.fileNames.length === 0
                    ? '—'
                    : job.fileNames.length === 1
                      ? job.fileNames[0]
                      : `${job.fileNames[0]} + ${job.fileNames.length - 1} more`;
                return (
                  <tr key={job.id}>
                    <td className="strong">{job.clientName}</td>
                    <td className="pr-file-cell" title={job.fileNames.join(', ')}>
                      {files}
                    </td>
                    <td>
                      <Pill tone={JOB_STATUS_TONE[job.status]}>{JOB_STATUS_LABEL[job.status]}</Pill>
                      {stale ? (
                        <Pill tone="amber" title="Waiting for review for over a week — finish it or discard it">
                          {days} days old
                        </Pill>
                      ) : null}
                    </td>
                    <td className="mono">{ukDateTime(job.createdAt)}</td>
                    <td className="mono">
                      {job.rowCount === null
                        ? '—'
                        : `${job.rowCount}${job.status === 'reviewing' ? ` · ${job.approvedCount ?? 0} approved` : ''}`}
                    </td>
                    <td className="cell-actions">
                      <div className="pr-buttons">
                        <Link className="btn sm" href={`/invoices/process/${job.id}`}>
                          {job.status === 'reviewing'
                            ? 'Review'
                            : job.status === 'confirmed'
                              ? 'Generate'
                              : 'Open'}
                        </Link>
                        {job.status === 'reviewing' ? (
                          <DiscardButton
                            jobId={job.id}
                            label={`${job.clientName} · ${files}`}
                            approved={job.approvedCount}
                            disabled={!canAct}
                          />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="sr-only">{plural(jobs.length, 'job')}</p>
        </TableScroll>
      )}
    </Panel>
  );
}
