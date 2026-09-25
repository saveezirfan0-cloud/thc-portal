import { createAdminClient } from '@thc/db/admin';
import type { RtwBranch } from '@thc/domain';
import { isAuthorisedJobCall } from './_lib/auth';
import { readGovUkPage } from './_lib/extract';
import { checkOnGovUk, launchBrowser } from './_lib/govuk';
import { runOnce, type ClaimedCheck, type RunDeps } from './_lib/run';

/**
 * POST /api/jobs/rtw-check — the gov.uk share-code check runner (§2.6,
 * ADR-0025).
 *
 * Called once a minute by the rtw-check Edge Function (pg_cron → Edge →
 * here) with `Authorization: Bearer <RTW_JOB_SECRET>`. Each call claims at
 * most one due check and runs it. The middleware lets this one path
 * through without a session (middleware.ts); the secret below is the only
 * way in, so a signed-in admin or worker gets the same 401 as anyone else.
 *
 * Node runtime because Playwright drives a real Chromium
 * (@sparticuz/chromium on Vercel), which no Edge runtime can run.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CHECK_BUDGET_MS = 110_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/** The UK date (§1.8: rules are evaluated in Europe/London). */
function ukToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
}

/** The generated types predate rtw_checks (20260928090000); only these calls are made. */
interface RunnerDb {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

interface ClaimRow {
  check_id: string;
  staff_id: string;
  document_id: string;
  share_code: string;
  dob: string;
  first_name: string;
  last_name: string;
  rtw_branch: string | null;
  attempt: number;
}

export async function POST(request: Request): Promise<Response> {
  if (!isAuthorisedJobCall(request.headers.get('authorization'), process.env['RTW_JOB_SECRET'])) {
    return json({ error: 'not authorised' }, 401);
  }

  const apiKey = process.env['ANTHROPIC_API_KEY'];
  const companyName = process.env['RTW_COMPANY_NAME']?.trim();
  if (!apiKey || !companyName || !process.env['SUPABASE_SERVICE_ROLE_KEY']) {
    // Refused before anything is claimed, so a half-configured deployment
    // spends no attempts.
    return json(
      {
        error:
          'not configured: ANTHROPIC_API_KEY, RTW_COMPANY_NAME and SUPABASE_SERVICE_ROLE_KEY are required',
      },
      503,
    );
  }

  const admin = createAdminClient();
  const db = admin as unknown as RunnerDb;
  let browser: Awaited<ReturnType<typeof launchBrowser>> | null = null;

  const deps: RunDeps = {
    async claim() {
      const { data, error } = await db.rpc('claim_rtw_check');
      if (error) throw new Error(`claim_rtw_check: ${error.message}`);
      const row = (Array.isArray(data) ? data[0] : null) as ClaimRow | null;
      if (!row) return null;
      const claimed: ClaimedCheck = {
        checkId: row.check_id,
        staffId: row.staff_id,
        documentId: row.document_id,
        shareCode: row.share_code,
        dob: row.dob,
        firstName: row.first_name,
        lastName: row.last_name,
        branch: (row.rtw_branch as RtwBranch | null) ?? null,
        attempt: row.attempt,
      };
      return claimed;
    },
    async belowDegreeLevel(staffId) {
      const { data } = await admin
        .from('staff')
        .select('below_degree_level')
        .eq('id', staffId)
        .maybeSingle<{ below_degree_level: boolean }>();
      return data?.below_degree_level ?? false;
    },
    async checkGovUk(input) {
      browser ??= await launchBrowser();
      return checkOnGovUk(browser, input);
    },
    readPage: (pdf) => readGovUkPage(pdf, { apiKey }),
    async upload(path, bytes, contentType) {
      const { error } = await admin.storage
        .from('documents')
        .upload(path, bytes, { contentType, upsert: true });
      if (error) throw new Error(`storage upload failed: ${error.message}`);
    },
    async record(args) {
      const { error } = await db.rpc('record_rtw_check', {
        p_check: args.checkId,
        p_outcome: args.outcome,
        p_result: args.result,
        p_holder_name: args.holderName,
        p_until: args.until,
        p_no_time_limit: args.noTimeLimit,
        p_conditions: args.conditions,
        p_report_path: args.reportPath,
        p_photo_path: args.photoPath,
      });
      if (error) throw new Error(`record_rtw_check: ${error.message}`);
    },
    async fail(checkId, message, retryable) {
      const { error } = await db.rpc('fail_rtw_check', {
        p_check: checkId,
        p_error: message,
        p_retryable: retryable,
      });
      // The row stays `running`; claim_rtw_check() requeues it after 15 minutes.
      if (error) console.error(`fail_rtw_check: ${error.message}`);
    },
    companyName,
    today: ukToday,
    budgetMs: CHECK_BUDGET_MS,
  };

  try {
    return json(await runOnce(deps));
  } catch (cause) {
    // Only the claim can land here (runOnce records every later failure),
    // and a claim error carries no share code or date of birth.
    return json({ error: cause instanceof Error ? cause.message : String(cause) }, 500);
  } finally {
    if (browser) await (browser as { close(): Promise<void> }).close().catch(() => undefined);
  }
}
