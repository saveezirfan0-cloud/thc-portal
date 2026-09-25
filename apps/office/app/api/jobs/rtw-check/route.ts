import { NextResponse } from 'next/server';
import { createAdminClient } from '@thc/db/admin';
import { checkJobSecret } from './_lib/auth';
import { createGovukChecker } from './_lib/govuk';
import { chromiumLauncher } from './_lib/govuk.launch';
import { createProviderChecker } from './_lib/provider';
import { runRtwCheckSweep } from './_lib/sweep';
import type { ClaimedCheck, RecordInput } from './_lib/sweep';
import type { RightToWorkChecker } from './_lib/checker';

/**
 * POST /api/jobs/rtw-check — the automated gov.uk right-to-work check
 * (Scope §2.3, §2.6; ADR-0025).
 *
 * A job, not a screen: pg_cron calls it every 10 minutes (job_schedules
 * `rtw-check`, office_base_url + this path), and a share code being filed
 * nudges it through pg_net. It is a Node route in the Back Office rather
 * than a Supabase Edge Function because the gov.uk fallback drives a
 * headless Chromium, which Deno cannot run.
 *
 * Gate: `Authorization: Bearer <RTW_JOB_SECRET>`, compared in constant time.
 * No Supabase session is involved (middleware lets this one path through),
 * and the database work is done with the service key through two functions
 * only the service role may call: rtw_check_claim and rtw_check_record.
 *
 * Every run is a job_runs row with its counts, like every other §7 job.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A gov.uk check drives several pages; three of them fit well inside this.
export const maxDuration = 300;

const env = (name: string) => process.env[name];

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
  const gate = checkJobSecret(request.headers.get('authorization'), env('RTW_JOB_SECRET'));
  if (gate === 'not_configured') {
    return json(503, { error: 'RTW_JOB_SECRET is not set (at least 32 characters)' });
  }
  if (gate === 'unauthorised') return json(401, { error: 'unauthorised' });

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return json(503, { error: 'SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL not set' });
  }
  const db = admin as unknown as RpcClient;

  const started = await db.rpc('job_run_start', { p_job: 'rtw-check' });
  if (started.error) return json(500, { error: `job_run_start: ${started.error.message}` });
  const runId = started.data;

  try {
    const config = await db.rpc('rtw_check_config');
    if (config.error) throw new Error(`rtw_check_config: ${config.error.message}`);
    const settings = (config.data ?? {}) as {
      primary?: string;
      fallback?: string | null;
      company_name?: string;
    };

    const adapters: Record<string, RightToWorkChecker | null> = {
      provider: createProviderChecker(env),
      govuk: createGovukChecker(env, chromiumLauncher(env)),
    };
    const primary = adapters[settings.primary ?? 'provider'] ?? null;
    const fallback = settings.fallback ? (adapters[settings.fallback] ?? null) : null;

    const counts = await runRtwCheckSweep({
      primary: primary ?? fallback,
      fallback: primary ? fallback : null,
      companyName: settings.company_name?.trim() || 'The Hospitality Company',
      limit: Math.min(Math.max(Number(env('RTW_CHECK_BATCH')) || 3, 1), 10),
      claim: async (limit) => {
        const { data, error } = await db.rpc('rtw_check_claim', {
          p_limit: limit,
          p_lease_seconds: 600,
        });
        if (error) throw new Error(`rtw_check_claim: ${error.message}`);
        return (data ?? []) as ClaimedCheck[];
      },
      uploadReport: async (path, bytes) => {
        const { error } = await admin.storage.from('documents').upload(path, bytes, {
          contentType: 'application/pdf',
          upsert: true,
        });
        if (error) throw new Error('upload failed');
      },
      record: async (input: RecordInput) => {
        const { data, error } = await db.rpc('rtw_check_record', {
          p_check: input.checkId,
          p_result: input.result,
          p_decision: input.decision,
          p_report_path: input.reportPath,
          p_error: input.error,
        });
        if (error) throw new Error('record failed');
        return { status: String((data as { status?: string } | null)?.status ?? 'unknown') };
      },
      // Check ids, sources and outcomes only — never a code, a date of birth or a name.
      log: (line) => console.warn(line),
    });

    await db.rpc('job_run_finish', { p_id: runId, p_ok: true, p_counts: counts });
    return json(200, { job: 'rtw-check', ok: true, counts });
  } catch (cause) {
    // A database error message names functions and codes, not people.
    const message = cause instanceof Error ? cause.message.slice(0, 300) : 'failed';
    await db.rpc('job_run_finish', {
      p_id: runId,
      p_ok: false,
      p_counts: {},
      p_error: message,
    });
    return json(500, { job: 'rtw-check', ok: false, error: message });
  }
}
