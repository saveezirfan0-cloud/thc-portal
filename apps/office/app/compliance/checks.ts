import { rtwCheckInFlight } from '@thc/domain';
import { rtwCheckView, ukStampFull } from '../_lib/rtwCheck';
import type { RtwCheckRow, RtwTone } from '../_lib/rtwCheck';

/**
 * The gov.uk check monitor on /compliance (ADR-0025, ADR-0041): every share
 * code the runner has been asked to check, where it stands, how long it has
 * taken and what happened on the way. Read-only — the decisions stay on the
 * Needs review tab and the profile's Documents panel.
 */

export interface MonitorCheck {
  check: RtwCheckRow;
  name: string;
}

/** A share code filed for checking with no check started for it. */
export interface WaitingDoc {
  docId: string;
  staffId: string;
  name: string;
  filedAt: string;
}

/** The latest `job_runs` row of the `rtw-check` job — the runner's heartbeat. */
export interface RunnerRun {
  startedAt: string;
  ok: boolean;
  counts: Record<string, number>;
  error: string | null;
}

export interface CheckMonitorData {
  checks: MonitorCheck[];
  waiting: WaitingDoc[];
  lastRun: RunnerRun | null;
  /** Server clock at the read, so elapsed times are the same on every render. */
  now: string;
  problem: string | null;
}

export const EMPTY_MONITOR: CheckMonitorData = {
  checks: [],
  waiting: [],
  lastRun: null,
  now: '',
  problem: null,
};

/** "under a minute", "12 min", "1 h 05 min", "2 d 4 h". */
export function elapsedLabel(fromIso: string, toIso: string): string {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${String(minutes % 60).padStart(2, '0')} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

export type CheckFilter = 'all' | 'progress' | 'review' | 'finished' | 'problems';

export type CheckGroup = Exclude<CheckFilter, 'all'>;

/** Which bucket a check is in. A stuck check is a problem, not "in progress". */
export function checkGroup(row: RtwCheckRow): CheckGroup {
  if (row.status === 'failed') return 'problems';
  if (rtwCheckInFlight(row.status)) return row.stuck ? 'problems' : 'progress';
  if (row.status === 'needs_review') return 'review';
  return 'finished';
}

export function checkCounts(checks: readonly MonitorCheck[]): Record<CheckGroup, number> {
  const counts: Record<CheckGroup, number> = { progress: 0, review: 0, finished: 0, problems: 0 };
  for (const { check } of checks) counts[checkGroup(check)] += 1;
  return counts;
}

export function filterChecks(
  checks: readonly MonitorCheck[],
  filter: CheckFilter,
): readonly MonitorCheck[] {
  return filter === 'all' ? checks : checks.filter(({ check }) => checkGroup(check) === filter);
}

export interface CheckLine {
  tone: RtwTone;
  label: string;
  /** What is happening, in words: the retry, the wait, the reason. */
  detail: string | null;
  tries: string;
  /** "Started 13:02 UK time" — when it was filed. */
  filed: string;
  /** Time since it was filed, or what it took in all. */
  elapsed: string;
}

export function checkLine(row: RtwCheckRow, now: string): CheckLine {
  const view = rtwCheckView(row, { docStatus: 'pending', enabled: true });
  const status = view.status ?? { tone: 'neutral' as const, label: row.status };
  const inFlight = rtwCheckInFlight(row.status);
  const stuck = inFlight && row.stuck;

  let detail: string | null = null;
  if (stuck) {
    detail =
      'The runner has not touched this for longer than the stale limit. Check that the schedule is on, RTW_GOVUK_ENABLED and the job secret are set on the office project, and job_runs.';
  } else if (row.status === 'queued' && row.attempts === 0) {
    detail = 'Waiting for the next runner pass (every 10 minutes).';
  } else if (row.status === 'queued') {
    detail =
      `Attempt ${row.attempts} of ${row.max_attempts} did not finish` +
      (row.next_attempt_at ? ` — next try ${ukStampFull(row.next_attempt_at)}.` : '.');
  } else if (row.status === 'running') {
    detail = 'With gov.uk now.';
  } else if (row.status === 'needs_review') {
    detail = row.review_reason ?? 'The result is waiting for the office to decide.';
  } else if (row.status === 'rejected') {
    detail = row.worker_reason ? `Worker asked to re-enter: “${row.worker_reason}”` : null;
  } else if (row.status === 'failed') {
    detail = `Gave up after ${row.attempts} of ${row.max_attempts} attempts.`;
  } else if (row.status === 'passed') {
    detail = row.no_time_limit
      ? 'Right to work confirmed — no time limit.'
      : row.right_to_work_until
        ? `Right to work confirmed until ${row.right_to_work_until.slice(0, 10).split('-').reverse().join('.')}.`
        : null;
  }
  if (row.error && (row.status === 'failed' || row.status === 'queued' || stuck)) {
    detail = `${detail ?? ''} Last error: ${row.error}`.trim();
  }

  return {
    tone: status.tone,
    label: status.label,
    detail,
    tries: `${row.attempts} of ${row.max_attempts}`,
    filed: ukStampFull(row.created_at),
    elapsed: elapsedLabel(row.created_at, inFlight ? now : (row.finished_at ?? now)),
  };
}
