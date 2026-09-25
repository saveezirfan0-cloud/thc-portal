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
import { timingSafeEqual } from '../../../packages/db/src/willo.ts';

const encoder = new TextEncoder();

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

/**
 * The bearer the caller presented equals the expected key. Constant time
 * over equal-length inputs (timingSafeEqual visits every byte whatever the
 * first difference), so the response time never says how long a prefix a
 * guess shared. V8's `===` short-circuits on the first differing byte,
 * which is what the earlier "compare lengths first" version still leaked.
 * Exported for the test.
 */
export function bearerMatches(header: string | null, expected: string | undefined): boolean {
  if (!expected) return false;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
  return timingSafeEqual(encoder.encode(token), encoder.encode(expected));
}

/** The caller must hold the service key. pg_net sends it as a bearer token. */
function authorised(request: Request): boolean {
  return bearerMatches(
    request.headers.get('Authorization'),
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  );
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
  if (!authorised(request)) {
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
