/**
 * The wrapper every §7 job shares.
 *
 * A job is an HTTP endpoint that pg_cron calls through pg_net (see
 * docs/01-architecture.md §4). Three things are true of all of them and
 * none of them is interesting enough to write six times:
 *
 *   1. Only the service role may call it. These endpoints raise
 *      violations and enqueue pushes; an open one is a way to forge a
 *      No-show against any worker.
 *   2. Every run writes a job_runs row, started and finished, with its
 *      counts or its error. Without it a failed 12:05 cutoff is silent.
 *   3. The work itself is a database function, so the rules stay in SQL
 *      where pgTAP can reach them and this layer cannot get them wrong.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';
import {
  isServiceCaller,
  projectRef,
  secretKeysFromEnv,
  serviceKeyFromEnv,
} from '../../../packages/db/src/service-caller.ts';

export interface JobResult {
  ok: boolean;
  counts: Record<string, unknown>;
  error?: string;
}

const env = (name: string): string | undefined => Deno.env.get(name);

/**
 * The job's own database client. The legacy SUPABASE_SERVICE_ROLE_KEY until
 * the owner sets the function secret THC_SECRET_KEY_NAME, then that new
 * secret key (packages/db/src/service-caller.ts, ADR-0165). Either form
 * works with supabase-js 2.118.
 */
export function serviceClient(): SupabaseClient {
  const url = env('SUPABASE_URL');
  if (!url) throw new Error('SUPABASE_URL must be set');
  const choice = serviceKeyFromEnv(env);
  if (!choice.ok) throw new Error(choice.error);
  return createClient(url, choice.key, { auth: { persistSession: false } });
}

/** Service keys Auth has confirmed in this isolate, and until when (ms). */
const confirmed = new Map<string, number>();
const CONFIRMED_FOR_MS = 10 * 60_000;

/**
 * Supabase Auth's admin API answers 200 only to a genuine service-role key
 * for this project, so it is the arbiter when the caller's legacy JWT is not
 * the byte-for-byte copy this function holds (packages/db/src/service-caller.ts).
 * A new sb_secret_ key never comes here: it is matched against the
 * SUPABASE_SECRET_KEYS the runtime injects, or refused.
 * A positive answer is remembered for ten minutes, so a job firing every
 * minute costs one Auth call per isolate, not one per run.
 */
async function confirmWithAuth(token: string): Promise<boolean> {
  const until = confirmed.get(token);
  if (until !== undefined && until > Date.now()) return true;
  const url = env('SUPABASE_URL');
  if (!url) return false;
  const response = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=1`, {
    headers: { apikey: token, Authorization: `Bearer ${token}` },
  });
  await response.body?.cancel();
  if (!response.ok) return false;
  confirmed.set(token, Date.now() + CONFIRMED_FOR_MS);
  return true;
}

/**
 * The caller must hold a service key: the legacy service_role JWT or a new
 * sb_secret_ key, on `apikey` or as a bearer. pg_net sends it through
 * edge_call_headers() (20261020140000, ADR-0165).
 */
function authorised(request: Request): Promise<boolean> {
  return isServiceCaller(request.headers, {
    expected: env('SUPABASE_SERVICE_ROLE_KEY'),
    secretKeys: secretKeysFromEnv(env),
    ref: projectRef(env('SUPABASE_URL')),
    confirm: confirmWithAuth,
  });
}

/**
 * Run `work` inside a job_runs row and return its counts as JSON.
 *
 * `work` is given the service-role client and returns whatever counts the
 * underlying SQL function produced. Throwing is the way to fail: the
 * error message lands in job_runs.error and the response is a 500, which
 * is what makes a failing job visible rather than merely unhelpful.
 */
export async function runJob(
  name: string,
  request: Request,
  work: (db: SupabaseClient) => Promise<Record<string, unknown>>,
): Promise<Response> {
  if (!(await authorised(request))) {
    return new Response(JSON.stringify({ error: 'service role required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const db = serviceClient();

  const { data: runId, error: startError } = await db.rpc('job_run_start', { p_job: name });
  if (startError) {
    // Nothing to finish: the run row was never created.
    return new Response(JSON.stringify({ error: `job_run_start: ${startError.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const counts = await work(db);
    await db.rpc('job_run_finish', { p_id: runId, p_ok: true, p_counts: counts });
    return new Response(JSON.stringify({ job: name, ok: true, counts }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    // Best effort: if this write fails too the run stays unfinished, which
    // is what the job_runs_unfinished index is for.
    await db.rpc('job_run_finish', {
      p_id: runId,
      p_ok: false,
      p_counts: {},
      p_error: message,
    });
    return new Response(JSON.stringify({ job: name, ok: false, error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * A job_runs row around work that is NOT a pg_cron call — willo-webhook's
 * inbound deliveries, which Willo authenticates with its own token rather
 * than the service key `runJob` demands.
 *
 * The response is the work's own; the row records its status and outcome
 * (`ok` = not a 5xx, the retryable failures). A failure to write the row is
 * logged and never changes the answer: Willo's delivery is not refused
 * because our bookkeeping failed.
 */
export async function recordRun(
  db: SupabaseClient,
  name: string,
  work: () => Promise<Response>,
): Promise<Response> {
  const { data: runId, error: startError } = await db.rpc('job_run_start', { p_job: name });
  if (startError) console.error(`[${name}] job_run_start failed`, { error: startError.message });

  const finish = async (ok: boolean, counts: Record<string, unknown>, error?: string) => {
    if (startError || runId === null || runId === undefined) return;
    const { error: finishError } = await db.rpc('job_run_finish', {
      p_id: runId,
      p_ok: ok,
      p_counts: counts,
      p_error: error ?? null,
    });
    if (finishError)
      console.error(`[${name}] job_run_finish failed`, { error: finishError.message });
  };

  let response: Response;
  try {
    response = await work();
  } catch (cause) {
    await finish(false, {}, cause instanceof Error ? cause.message : String(cause));
    throw cause;
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await response.clone().json()) as Record<string, unknown>;
  } catch {
    // Not JSON: the status alone is recorded.
  }
  const counts: Record<string, unknown> = { status: response.status };
  for (const field of ['outcome', 'code']) {
    if (typeof body[field] === 'string') counts[field] = body[field];
  }
  const failed = response.status >= 500;
  await finish(
    !failed,
    counts,
    failed && typeof body['error'] === 'string' ? body['error'] : undefined,
  );
  return response;
}
