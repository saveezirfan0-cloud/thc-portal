import { NextResponse } from 'next/server';
import { createAdminClient } from '@thc/db/admin';
import { newStarterCsv } from '@thc/pdf';
import type { NewStarterCsvRow } from '@thc/pdf';
import { checkJobSecret } from '../_lib/auth';
import { runNewStarterReport } from './_lib/run';
import type { Prepared } from './_lib/run';

/**
 * POST /api/jobs/new-starter-report — the New Starter (HMRC) report, emailed
 * to Payroll and Gisela every Monday (ADR-0091, THC 05.10.2026).
 *
 * A job, not a screen: pg_cron calls it every 15 minutes (job_schedules
 * `new-starter-report`, the vault's office_base_url + this path) and
 * `new_starter_report_due()` decides the UK minute, so a Monday that was
 * missed (a deploy, an outage) is caught up later in the week. It is the
 * same Node-route pattern as event-documents (ADR-0074) and rtw-check.
 *
 * Gate: `Authorization: Bearer <RTW_JOB_SECRET>` in constant time, the office
 * job secret the other two jobs share. No Supabase session is involved
 * (middleware lets this path through, POST only). Every database call is the
 * service role through functions only it may call: new_starter_report_due,
 * prepare_new_starter_report, new_starter_report_rows,
 * queue_new_starter_report_email.
 *
 * Every run is a job_runs row with its counts, like every other §7 job. No
 * name, address or NI number is ever logged.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BUCKET = 'reports';

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** Read through the same generated-types gap every office RPC call works round. */
interface RpcClient {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export async function POST(request: Request) {
  const gate = checkJobSecret(request.headers.get('authorization'), process.env.RTW_JOB_SECRET);
  if (gate === 'not_configured') {
    console.error('new-starter-report: RTW_JOB_SECRET is not set (at least 32 characters)');
    return json(503, { error: 'not_configured' });
  }
  if (gate === 'unauthorised') return json(401, { error: 'unauthorised' });

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    console.error(
      'new-starter-report: SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL not set',
    );
    return json(503, { error: 'not_configured' });
  }
  const db = admin as unknown as RpcClient;

  const run = await db.rpc('job_run_start', { p_job: 'new-starter-report' });
  if (run.error) return json(500, { error: `job_run_start: ${run.error.message}` });
  const runId = run.data;

  const call = async (fn: string, args?: Record<string, unknown>) => {
    const { data, error } = await db.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data;
  };

  try {
    const now = new Date().toISOString();
    const counts = await runNewStarterReport({
      due: async () => (await call('new_starter_report_due', { p_now: now })) === true,
      prepare: async () => (await call('prepare_new_starter_report', { p_now: now })) as Prepared,
      rows: async (sendId) =>
        ((await call('new_starter_report_rows', { p_send: sendId })) ?? []) as NewStarterCsvRow[],
      csv: newStarterCsv,
      upload: async (path, csv) => {
        const { error } = await admin.storage
          .from(BUCKET)
          .upload(path, new Blob([csv], { type: 'text/csv;charset=utf-8' }), {
            upsert: true,
            contentType: 'text/csv;charset=utf-8',
          });
        if (error) throw new Error(`upload ${BUCKET}/${path}: ${error.message}`);
      },
      queue: async (sendId, path) => {
        await call('queue_new_starter_report_email', { p_send: sendId, p_path: path });
      },
      log: (line) => console.warn(line),
    });

    await db.rpc('job_run_finish', { p_id: runId, p_ok: true, p_counts: counts });
    return json(200, { job: 'new-starter-report', ok: true, counts: { ...counts } });
  } catch (cause) {
    // A database error message names functions and codes, not people.
    const message = cause instanceof Error ? cause.message.slice(0, 300) : 'failed';
    await db.rpc('job_run_finish', { p_id: runId, p_ok: false, p_counts: {}, p_error: message });
    return json(500, { job: 'new-starter-report', ok: false, error: message });
  }
}
