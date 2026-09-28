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

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { isServiceCaller, projectRef } from '../../../packages/db/src/service-caller.ts';

export interface JobResult {
  ok: boolean;
  counts: Record<string, unknown>;
  error?: string;
}

function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Service keys Auth has confirmed in this isolate, and until when (ms). */
const confirmed = new Map<string, number>();
const CONFIRMED_FOR_MS = 10 * 60_000;

/**
 * Supabase Auth's admin API answers 200 only to a genuine service-role key
 * for this project, so it is the arbiter when the caller's key is not the
 * byte-for-byte copy this function holds (packages/db/src/service-caller.ts).
 * A positive answer is remembered for ten minutes, so a job firing every
 * minute costs one Auth call per isolate, not one per run.
 */
async function confirmWithAuth(token: string): Promise<boolean> {
  const until = confirmed.get(token);
  if (until !== undefined && until > Date.now()) return true;
  const url = Deno.env.get('SUPABASE_URL');
  if (!url) return false;
  const response = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=1`, {
    headers: { apikey: token, Authorization: `Bearer ${token}` },
  });
  await response.body?.cancel();
  if (!response.ok) return false;
  confirmed.set(token, Date.now() + CONFIRMED_FOR_MS);
  return true;
}

/** The caller must hold a service key. pg_net sends it as a bearer token. */
function authorised(request: Request): Promise<boolean> {
  return isServiceCaller(request.headers.get('Authorization'), {
    expected: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    ref: projectRef(Deno.env.get('SUPABASE_URL')),
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
