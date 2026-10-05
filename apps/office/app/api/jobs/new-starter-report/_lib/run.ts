import type { NewStarterCsvRow } from '@thc/pdf';

/**
 * One run of the New Starter (HMRC) report job (ADR-0091), with its I/O
 * injected so the order of operations is testable without a database.
 *
 *   1. due()      Monday 09:00 UK until this week's report is done, and only
 *                 while NS1 is switched on in /settings.
 *   2. prepare()  records who is on it (or "no new" for an empty week).
 *                 Idempotent per week: a second call resumes the first.
 *   3. rows()     the CSV rows for the prepared send.
 *   4. upload()   the CSV into the private `reports` bucket, with upsert, so
 *                 a retry overwrites its own file with identical bytes.
 *   5. queue()    one outbox row, NS1:<week start>, carrying the path.
 *
 * Each step is safe to repeat: a run that dies between any two of them is
 * finished by the next 15-minute tick rather than repeated, and the same
 * week is never emailed twice (the outbox key is unique). A week with nobody
 * new sends nothing and is recorded as "no new" (§9.9). No names or
 * addresses are logged.
 */

export interface Prepared {
  alreadyPrepared: boolean;
  periodStart: string;
  periodEnd: string;
  sendId: number;
  /** preparing · queued · sent · failed · no_new */
  status: string;
  newStarters: number;
  queued: boolean;
}

export interface NewStarterDeps {
  due(): Promise<boolean>;
  prepare(): Promise<Prepared>;
  rows(sendId: number): Promise<NewStarterCsvRow[]>;
  /** The CSV text for these rows (packages/pdf's builder, injected). */
  csv(rows: NewStarterCsvRow[]): string;
  upload(path: string, csv: string): Promise<void>;
  queue(sendId: number, path: string): Promise<void>;
  log(line: string): void;
}

export interface NewStarterRunCounts {
  skipped?: string;
  periodStart?: string;
  periodEnd?: string;
  newStarters?: number;
  resumed?: boolean;
  queued?: boolean;
}

export const storagePath = (start: string, end: string) => `new-starter/${start}_${end}.csv`;

export async function runNewStarterReport(deps: NewStarterDeps): Promise<NewStarterRunCounts> {
  if (!(await deps.due())) {
    return { skipped: 'before Monday 09:00 UK, switched off, or this week is already done' };
  }

  const run = await deps.prepare();
  if (run.status === 'no_new') {
    deps.log(`new-starter-report: ${run.periodStart} no new starters`);
    return {
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      newStarters: 0,
      queued: false,
    };
  }
  if (run.queued) {
    return {
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      newStarters: run.newStarters,
      skipped: 'already queued',
    };
  }

  const rows = await deps.rows(run.sendId);
  const path = storagePath(run.periodStart, run.periodEnd);
  await deps.upload(path, deps.csv(rows));
  await deps.queue(run.sendId, path);
  deps.log(`new-starter-report: ${run.periodStart} queued ${rows.length}`);
  return {
    periodStart: run.periodStart,
    periodEnd: run.periodEnd,
    newStarters: rows.length,
    resumed: run.alreadyPrepared,
    queued: true,
  };
}
