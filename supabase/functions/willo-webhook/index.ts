/**
 * willo-webhook — Willo in both directions (§2.4, §2.12, Appendix B B1,
 * ADR-0021).
 *
 *   POST /willo-webhook          Willo's webhook. Signed by Willo, not by
 *                                us, so this function is deployed with
 *                                `--no-verify-jwt` and checks the
 *                                signature itself before reading a byte of
 *                                the body as JSON.
 *   POST /willo-webhook/invite   "Create the candidate in Willo" (Willo
 *                                then sends E1). Service key only: the
 *                                database's nudge trigger and the
 *                                `willo-invite` schedule call it.
 *
 * The rules are SQL (20260924110000, 20260923110000, 20260926100200) and
 * held by pgTAP 380 / 482 / 522; the parsing and the signature are
 * packages/db/src/willo.ts, held by vitest; the login is
 * packages/db/src/provision.ts, the SAME code the office Accept runs.
 * What is left here is only the order of the calls — and for the sweep,
 * that order is the whole point (ADR-0021, 26.09): lease, create, write
 * the key alone, then link; never a second create for a row with a key.
 *
 * Secrets (supabase secrets set …; never in code): WILLO_WEBHOOK_SECRET,
 * WILLO_API_KEY, WILLO_INTERVIEW_KEY, STAFF_APP_URL, and optionally
 * WILLO_SIGNATURE_HEADER, WILLO_TIMESTAMP_HEADER,
 * WILLO_TIMESTAMP_TOLERANCE_SECONDS, WILLO_API_BASE, WILLO_INVITE_PATH,
 * WILLO_API_AUTH_HEADER, WILLO_API_AUTH_PREFIX. docs/12 lists them.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { runJob } from '../_shared/job.ts';
import {
  eventTime,
  isPermanentRefusal,
  parseWilloEvent,
  readInviteAnswer,
  refusalCode,
  verifyWilloSignature,
  willoApiConfig,
  willoInviteRequest,
  willoSignatureConfig,
} from '../../../packages/db/src/willo.ts';
import { issueActivationLink } from '../../../packages/db/src/provision.ts';
import type { AdminAuth } from '../../../packages/db/src/provision.ts';

/** Willo's bodies are small; anything this size is not a webhook. */
const MAX_BODY_BYTES = 256 * 1024;

const env = (name: string): string | undefined => Deno.env.get(name);

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function serviceClient(): SupabaseClient {
  const url = env('SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// ---------------------------------------------------------------------
// Inbound: the webhook
// ---------------------------------------------------------------------

interface Plan {
  staffId: string;
  email: string;
  userId: string | null;
  status: string;
  target: string | null;
  needsAccount: boolean;
}

/**
 * A delivery the receiver could not apply and answers 500 to, so Willo
 * retries. The inbound path cannot use runJob()'s job_runs row (Willo
 * signs its own deliveries, ADR-0021), so this is its trace: one
 * admin-readable audit row per failed delivery (willo_record_failure,
 * 20260926111200). Invariant 7 — a receiver failing every delivery must
 * show somewhere in the database, not only in the function log.
 */
async function failed(
  db: SupabaseClient,
  candidate: string,
  eventKey: string,
  code: string,
  detail: Record<string, unknown> = {},
): Promise<Response> {
  console.error(`[willo-webhook] ${code}`, { candidate, eventKey, ...detail });
  const { error } = await db.rpc('willo_record_failure', {
    p_willo_candidate_id: candidate,
    p_event: eventKey,
    p_code: code,
  });
  if (error)
    console.error('[willo-webhook] could not record the failure', { error: error.message });
  return json(500, { error: code });
}

async function refuse(
  db: SupabaseClient,
  candidate: string,
  eventKey: string,
  message: string,
): Promise<Response> {
  const code = refusalCode(message);
  console.error('[willo-webhook] refused for good', { candidate, eventKey, code });
  const { error } = await db.rpc('willo_record_refusal', {
    p_willo_candidate_id: candidate,
    p_event: eventKey,
    p_code: code,
  });
  if (error)
    console.error('[willo-webhook] could not record the refusal', { error: error.message });
  // 200: Willo must stop retrying something no retry can change. The
  // office sees the card still waiting for a decision, and the audit row.
  return json(200, { outcome: 'refused', code });
}

async function webhook(request: Request): Promise<Response> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return json(413, { error: 'too large' });
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json(413, { error: 'too large' });

  const verdict = await verifyWilloSignature(
    raw,
    request.headers,
    willoSignatureConfig(env),
    Math.floor(Date.now() / 1000),
  );
  if (!verdict.ok) {
    if (verdict.reason === 'secret_missing') {
      // Never accept an unsigned delivery because the secret is missing.
      console.error('[willo-webhook] WILLO_WEBHOOK_SECRET is not set — every delivery is refused');
      return json(503, { error: 'not configured' });
    }
    console.warn('[willo-webhook] signature refused', { reason: verdict.reason });
    return json(401, { error: 'invalid signature' });
  }

  const parsed = parseWilloEvent(raw);
  if (!parsed.ok) {
    console.warn('[willo-webhook] unreadable delivery', { reason: parsed.reason });
    return json(400, { error: parsed.reason });
  }
  const event = parsed.event;
  const at = eventTime(event.occurredAt, Date.now());
  const log = {
    delivery: event.deliveryId,
    candidate: event.willoCandidateId,
    event: event.eventKey,
  };

  const db = serviceClient();

  const { data: plan, error: planError } = await db.rpc('willo_event_plan', {
    p_willo_candidate_id: event.willoCandidateId,
    p_event: event.eventKey,
  });
  if (planError) {
    return failed(db, event.willoCandidateId, event.eventKey, 'plan failed', {
      error: planError.message,
    });
  }
  if (!plan) {
    // Created in Willo by hand, or removed (§1.7) since. Nothing to move.
    console.warn('[willo-webhook] unknown Willo candidate', log);
    return refuse(db, event.willoCandidateId, event.eventKey, 'unknown_willo_candidate');
  }
  const p = plan as Plan;

  if (!p.needsAccount) {
    const { data, error } = await db.rpc('willo_record_event', {
      p_willo_candidate_id: event.willoCandidateId,
      p_event: event.eventKey,
      p_at: at,
      p_details: event.details,
    });
    if (error) {
      if (isPermanentRefusal(error.message)) {
        return refuse(db, event.willoCandidateId, event.eventKey, error.message);
      }
      return failed(db, event.willoCandidateId, event.eventKey, 'record failed', {
        error: error.message,
      });
    }
    console.log('[willo-webhook] applied', { ...log, result: data });
    return json(200, { outcome: (data as { outcome?: string } | null)?.outcome ?? 'applied' });
  }

  // An Accept that will move the card: the login first, exactly as the
  // office Accept does, then link + E3 in one transaction.
  const origin = env('STAFF_APP_URL');
  if (!origin) {
    // Retryable on purpose: set the secret and Willo's next retry lands.
    return failed(db, event.willoCandidateId, event.eventKey, 'not configured', {
      reason: 'STAFF_APP_URL is not set — E3 cannot carry a link',
    });
  }
  const issued = await issueActivationLink(
    db.auth.admin as unknown as AdminAuth,
    { email: p.email, userId: p.userId },
    origin,
  );
  if (!issued.ok) {
    if (issued.code === 'account_not_staff' || issued.code === 'account_missing') {
      return refuse(db, event.willoCandidateId, event.eventKey, issued.code);
    }
    return failed(db, event.willoCandidateId, event.eventKey, 'provisioning failed', {
      code: issued.code,
      detail: issued.detail,
    });
  }

  const { data, error } = await db.rpc('willo_accept_with_account', {
    p_willo_candidate_id: event.willoCandidateId,
    p_event: event.eventKey,
    p_at: at,
    p_details: { ...event.details, activationLink: issued.link, installLink: issued.installLink },
    p_user: issued.userId,
  });
  if (error) {
    if (isPermanentRefusal(error.message)) {
      return refuse(db, event.willoCandidateId, event.eventKey, error.message);
    }
    return failed(db, event.willoCandidateId, event.eventKey, 'accept failed', {
      error: error.message,
    });
  }
  console.log('[willo-webhook] accepted', { ...log, result: data });
  return json(200, { outcome: (data as { outcome?: string } | null)?.outcome ?? 'applied' });
}

// ---------------------------------------------------------------------
// Outbound: create due candidates in Willo
// ---------------------------------------------------------------------

/**
 * One row of willo_invite_due(). The sweep leased it (willo_create_claimed_at)
 * under `for update skip locked`, so nobody else holds it until the lease
 * (the backoff: 5 min doubling to 6 h) runs out. `kind` says what is left
 * to do: 'create' when Willo has not been asked yet, 'link' when a key was
 * recorded (willo_create_recorded) but the link did not complete — the
 * create is then never repeated.
 */
interface Due {
  staff_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  attempt: number;
  kind: 'create' | 'link';
  willo_candidate_id: string | null;
}

/**
 * How an attempt ended, in willo_invite_failed's words:
 *   failed  — Willo refused, or was never reached. The lease is released
 *             and the backoff decides when to try again. Safe: no
 *             candidate exists in Willo for this attempt.
 *   unknown — Willo may hold the candidate and we cannot prove it (a
 *             timeout, a 2xx without a readable key, a key we could not
 *             write). The lease is KEPT: the row takes the bounded stale
 *             path (3 retries, then flagged for the office) rather than
 *             being created again blindly.
 *   stuck   — the link was refused for a reason no retry changes. Flagged
 *             for the office now.
 */
type Outcome = 'failed' | 'unknown' | 'stuck';

type CreateResult =
  | { kind: 'created'; key: string }
  | { kind: 'failed'; reason: string }
  | { kind: 'unknown'; reason: string };

/** The whole sweep must finish inside the FIRST lease (5 min); this leaves room. */
const SWEEP_BUDGET_MS = 120_000;
/** Willo's create call. */
const WILLO_TIMEOUT_MS = 10_000;
/** In-process retries of a database write that failed transiently. */
const WRITE_TRIES = 3;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * A fetch that threw never got an answer. Whether it got as far as
 * SENDING is what matters: a DNS failure or a refused connection means
 * Willo never saw the request (safe to create later); a timeout, or a
 * connection dropped after the request went out, means Willo may have
 * created the candidate.
 */
function classifyFetchFailure(cause: unknown): CreateResult {
  const name = cause instanceof Error ? cause.name : '';
  const message = cause instanceof Error ? cause.message : String(cause);
  if (name === 'TimeoutError' || name === 'AbortError') {
    return { kind: 'unknown', reason: `timeout after ${WILLO_TIMEOUT_MS} ms: ${message}` };
  }
  const neverConnected =
    /\(Connect\)|dns error|tcp connect|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|certificate|tls/i.test(
      message,
    );
  return neverConnected
    ? { kind: 'failed', reason: `network: ${message}` }
    : { kind: 'unknown', reason: `network after send: ${message}` };
}

async function createInWillo(spec: ReturnType<typeof willoInviteRequest>): Promise<CreateResult> {
  let response: Response;
  try {
    response = await fetch(spec.url, {
      method: spec.method,
      headers: spec.headers,
      body: spec.body,
      signal: AbortSignal.timeout(WILLO_TIMEOUT_MS),
    });
  } catch (cause) {
    return classifyFetchFailure(cause);
  }
  let text: string;
  try {
    text = await response.text();
  } catch (cause) {
    // The status arrived, the body did not. A 2xx here is a create we
    // cannot read the key of.
    const message = cause instanceof Error ? cause.message : String(cause);
    return response.ok
      ? { kind: 'unknown', reason: `http_${response.status}: body unreadable: ${message}` }
      : { kind: 'failed', reason: `http_${response.status}: body unreadable: ${message}` };
  }
  const answer = readInviteAnswer(response.status, text);
  if (answer.ok) return { kind: 'created', key: answer.willoCandidateId };
  // Willo said yes and we cannot tell who: never ask again blindly.
  if (response.ok) return { kind: 'unknown', reason: answer.reason };
  return { kind: 'failed', reason: answer.reason };
}

interface RpcError {
  message: string;
  code?: string | null;
}

/**
 * A database error the same statement could clear on its own: no
 * SQLSTATE at all (the request never reached PostgREST), a PostgREST
 * connection error (PGRST0xx), or the connection / serialization /
 * resource / timeout classes. A P0001 refusal, a 22023 bad argument or a
 * 23505 duplicate is an answer, not a blip.
 */
function isTransientDbError(error: RpcError): boolean {
  const code = error.code ?? '';
  if (code === '') return true;
  if (/^PGRST0\d\d$/.test(code)) return true;
  return /^(08|40|53|57)/.test(code) || code === '55P03';
}

type RpcOutcome<T> = { ok: true; data: T } | { ok: false; error: RpcError; transient: boolean };

async function rpcWithRetries<T>(
  call: () => PromiseLike<{ data: T | null; error: RpcError | null }>,
): Promise<RpcOutcome<T>> {
  let last: RpcError = { message: 'no attempt made' };
  for (let i = 0; i < WRITE_TRIES; i += 1) {
    const { data, error } = await call();
    if (!error) return { ok: true, data: data as T };
    last = error;
    if (!isTransientDbError(error)) return { ok: false, error, transient: false };
    await sleep(500 * 2 ** i);
  }
  return { ok: false, error: last, transient: true };
}

function invite(request: Request): Promise<Response> {
  return runJob('willo-invite', request, async (db) => {
    const config = willoApiConfig(env);
    if (!config) {
      // §2.4's inputs arrive from THC (Appendix B, B1). Until then no
      // candidate is created in Willo and Willo sends no E1 — said loudly,
      // and nothing is leased, so every waiting candidate is picked up
      // the first time this runs with the keys set.
      console.warn(
        '[willo-invite] WILLO_API_KEY / WILLO_INTERVIEW_KEY not set — no candidate created in Willo, no E1 sent',
      );
      return { skipped: 'WILLO_API_KEY or WILLO_INTERVIEW_KEY not set' };
    }

    const startedAt = Date.now();
    const { data, error } = await db.rpc('willo_invite_due', { p_limit: 20 });
    if (error) throw new Error(`willo_invite_due: ${error.message}`);
    const due = (data ?? []) as Due[];

    const counts = {
      due: due.length,
      created: 0,
      linked: 0,
      failed: 0,
      unknown: 0,
      stuck: 0,
      deferred: 0,
    };

    // Every attempt that does not link ends in exactly one of these, so a
    // row is never left leased by accident. If even this write fails the
    // lease stays, which is the bounded stale path — the safe default.
    const ended = async (
      row: Due,
      reason: string,
      outcome: Outcome,
      bucket: keyof typeof counts = outcome,
    ) => {
      counts[bucket] += 1;
      const result = await rpcWithRetries(() =>
        db.rpc('willo_invite_failed', {
          p_staff: row.staff_id,
          p_error: reason,
          p_outcome: outcome,
        }),
      );
      if (!result.ok) {
        console.error('[willo-invite] could not record the outcome; the lease stands', {
          staffId: row.staff_id,
          outcome,
          error: result.error.message,
        });
      }
    };

    for (const row of due) {
      if (Date.now() - startedAt > SWEEP_BUDGET_MS) {
        // Not attempted: released as a plain failure so the backoff, not
        // the stale budget, decides when it is next offered.
        await ended(row, 'not attempted: sweep time budget exhausted', 'failed', 'deferred');
        continue;
      }

      let key = row.willo_candidate_id;

      if (row.kind === 'create') {
        const spec = willoInviteRequest(config, {
          staffId: row.staff_id,
          firstName: row.first_name,
          lastName: row.last_name,
          email: row.email,
          phone: row.phone,
        });
        const result = await createInWillo(spec);

        if (result.kind !== 'created') {
          console.error('[willo-invite] create did not complete', {
            staffId: row.staff_id,
            attempt: row.attempt,
            outcome: result.kind,
            reason: result.reason,
          });
          await ended(row, result.reason, result.kind);
          continue;
        }

        // Willo has the candidate and E1 is on its way. The key goes down
        // FIRST, alone, before anything that could be refused: from here
        // the sweep retries the link and never the create.
        const recorded = await rpcWithRetries<string>(() =>
          db.rpc('willo_create_recorded', {
            p_staff: row.staff_id,
            p_willo_candidate_id: result.key,
          }),
        );
        if (!recorded.ok) {
          console.error('[willo-invite] created but the key could not be written', {
            staffId: row.staff_id,
            willo: result.key,
            error: recorded.error.message,
          });
          // The key is only in this log now. The lease stands; the stale
          // path retries at most 3 times, then the office looks in Willo.
          await ended(
            row,
            `created ${result.key}, not recorded: ${recorded.error.message}`,
            'unknown',
          );
          continue;
        }
        counts.created += 1;
        if (recorded.data !== result.key) {
          // A stale retry created twice; the first key is kept (audited
          // as willo_invite_duplicate) and is the one linked below.
          console.error('[willo-invite] duplicate candidate in Willo', {
            staffId: row.staff_id,
            kept: recorded.data,
            duplicate: result.key,
          });
        }
        key = recorded.data;
      }

      if (!key) {
        // A 'link' row always carries its key; this is a database that
        // disagrees with itself, not something to retry.
        await ended(row, 'link requested without a recorded key', 'stuck');
        continue;
      }

      const linked = await rpcWithRetries(() =>
        db.rpc('willo_link_candidate', { p_staff: row.staff_id, p_willo_candidate_id: key }),
      );
      if (!linked.ok) {
        const message = linked.error.message;
        console.error('[willo-invite] created but not linked', {
          staffId: row.staff_id,
          willo: key,
          transient: linked.transient,
          error: message,
        });
        if (linked.transient) {
          // The key is on the row: the next sweep retries only the link.
          await ended(row, `created ${key}, not linked: ${message}`, 'unknown');
        } else if (message.includes('not_awaiting_interview')) {
          // The candidate moved on meanwhile (rejected, removed). Out of
          // the queue by status; a Reset starts a new interview (§2.12).
          await ended(row, `created ${key}, not linked: ${message}`, 'failed');
        } else {
          // Refused for good (a key already linked to somebody else, a
          // mismatch with the recorded key): the office must look.
          await ended(row, `created ${key}, not linked: ${message}`, 'stuck');
        }
        continue;
      }
      counts.linked += 1;
    }
    return counts;
  });
}

Deno.serve((request) => {
  if (request.method !== 'POST') return json(405, { error: 'POST only' });
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  if (path.endsWith('/invite')) return invite(request);
  return webhook(request).catch((cause) => {
    console.error('[willo-webhook] unexpected', {
      error: cause instanceof Error ? cause.message : String(cause),
    });
    return json(500, { error: 'unexpected' });
  });
});
