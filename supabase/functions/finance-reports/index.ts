/**
 * finance-reports — BG-08, the Monday 09:00 email to finance (§9.9, §7).
 *
 * "One email to the finance team — thc_payroll@topsourceworldwide.com and
 * gisela@thehospitalitycompany.co.uk — with 1–2 CSVs: Payroll — always; New
 * Starter (HMRC) — only if there were new starters."
 *
 * Four steps, each idempotent, so a run that dies between any two of them is
 * finished by the next five-minute tick rather than repeated:
 *
 *   1. finance_reports_due()      Monday 09:00 UK until last week is queued.
 *                                 pg_cron is UTC; this reads the London clock
 *                                 (DST), and catches up a missed Monday.
 *   2. prepare_finance_reports()  stamps last week into payroll_export_lines:
 *                                 exported shifts with their figures AS SENT,
 *                                 unresolved No check-outs HELD and rolled to
 *                                 next Monday; sets events.payroll_exported_at;
 *                                 decides whether there is a New Starter CSV.
 *                                 A second call for the same week resumes.
 *   3. the CSVs                   built from the stamped rows by the SAME
 *                                 builder as the /reports Export buttons
 *                                 (packages/pdf/src/csv.ts, ADR-0006 import),
 *                                 uploaded to the private `reports` bucket
 *                                 with upsert, so a retry overwrites its own
 *                                 file with identical bytes.
 *   4. queue_finance_report_email()  one notification_outbox row, keyed
 *                                 BG08:<week>, carrying the two storage paths.
 *
 * Sending is the outbox drain's job (P2, `notify-drain`), which routes BG08 to
 * `documentMessageFor()` in packages/notifications and sends from admin@
 * through Resend. That needs RESEND_API_KEY and the verified sender — neither
 * exists yet — so until P2 ships, the email sits queued and /reports shows
 * "Queued" rather than "Last sent". Nothing in this function needs a secret
 * beyond the service key every job already has.
 *
 * The rules are all SQL (20260923130000_reports_and_finance_send.sql) and
 * held by supabase/tests/410_reports_payroll.sql; the CSV columns are held by
 * packages/pdf/src/__tests__/csv.test.ts.
 */

import { runJob } from '../_shared/job.ts';
import { newStarterCsv, payrollCsv } from '../../../packages/pdf/src/csv.ts';
import type { NewStarterCsvRow, PayrollCsvRow } from '../../../packages/pdf/src/csv.ts';

interface Prepared {
  alreadyPrepared: boolean;
  periodStart: string;
  periodEnd: string;
  payrollSendId: number;
  newStarterSendId: number | null;
  newStarterStatus: string | null;
  rows: number;
  held: number;
  newStarters: number;
  queued: boolean;
}

const BUCKET = 'reports';

Deno.serve((request) =>
  runJob('finance-reports', request, async (db) => {
    const now = new Date().toISOString();

    const { data: due, error: dueError } = await db.rpc('finance_reports_due', { p_now: now });
    if (dueError) throw new Error(`finance_reports_due: ${dueError.message}`);
    if (!due) return { skipped: "before Monday 09:00 UK, or last week's report is already queued" };

    const { data: prepared, error: prepError } = await db.rpc('prepare_finance_reports', {
      p_now: now,
    });
    if (prepError) throw new Error(`prepare_finance_reports: ${prepError.message}`);
    const run = prepared as Prepared;
    if (run.queued) return { ...run, skipped: 'already queued' };

    // Payroll — always, even for a week with no shifts: finance should get
    // an empty file on Monday rather than wonder whether the job ran.
    const { data: payrollRows, error: payrollError } = await db.rpc('payroll_export_rows', {
      p_send: run.payrollSendId,
    });
    if (payrollError) throw new Error(`payroll_export_rows: ${payrollError.message}`);
    const payrollPath = `payroll/${run.periodStart}_${run.periodEnd}.csv`;
    await upload(db, payrollPath, payrollCsv((payrollRows ?? []) as PayrollCsvRow[]));

    // New Starter (HMRC) — only if there is anybody in it.
    let newStarterPath: string | null = null;
    if (run.newStarterSendId !== null && run.newStarterStatus !== 'no_new') {
      const { data: nsRows, error: nsError } = await db.rpc('new_starter_export_rows', {
        p_send: run.newStarterSendId,
      });
      if (nsError) throw new Error(`new_starter_export_rows: ${nsError.message}`);
      newStarterPath = `new-starter/${run.periodStart}_${run.periodEnd}.csv`;
      await upload(db, newStarterPath, newStarterCsv((nsRows ?? []) as NewStarterCsvRow[]));
    }

    const { data: queued, error: queueError } = await db.rpc('queue_finance_report_email', {
      p_payroll_send: run.payrollSendId,
      p_payroll_path: payrollPath,
      p_new_starter_path: newStarterPath,
    });
    if (queueError) throw new Error(`queue_finance_report_email: ${queueError.message}`);

    return {
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      rows: run.rows,
      held: run.held,
      newStarters: run.newStarters,
      resumed: run.alreadyPrepared,
      queued,
    };
  }),
);

async function upload(
  db: Parameters<Parameters<typeof runJob>[2]>[0],
  path: string,
  csv: string,
): Promise<void> {
  const { error } = await db.storage
    .from(BUCKET)
    .upload(path, new Blob([csv], { type: 'text/csv;charset=utf-8' }), {
      upsert: true,
      contentType: 'text/csv;charset=utf-8',
    });
  if (error) throw new Error(`upload ${BUCKET}/${path}: ${error.message}`);
}
