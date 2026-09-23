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
 *                                Creating a candidate is NOT undoable and
 *                                is what sends E1, so what this route may
 *                                do to each person — create, re-link a key
 *                                Willo already returned, or nothing — is
 *                                decided in SQL, not here
 *                                (20260924170000, ADR-0021).
 *
 * The rules are SQL (20260924170000, 20260924110000, 20260923110000) and
 * held by pgTAP 380 / 482 / 512; the parsing and the signature are
 * packages/db/src/willo.ts, held by vitest; the login is
 * packages/db/src/provision.ts, the SAME code the office Accept runs.
 * What is left here is only the order of the calls.
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
    console.error('[willo-webhook] plan failed', { ...log, error: planError.message });
    return json(500, { error: 'plan failed' });
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
      console.error('[willo-webhook] record failed', { ...log, error: error.message });
      return json(500, { error: 'record failed' });
    }
    console.log('[willo-webhook] applied', { ...log, result: data });
    return json(200, { outcome: (data as { outcome?: string } | null)?.outcome ?? 'applied' });
  }

  // An Accept that will move the card: the login first, exactly as the
  // office Accept does, then link + E3 in one transaction.
  const origin = env('STAFF_APP_URL');
  if (!origin) {
    // Retryable on purpose: set the secret and Willo's next retry lands.
    console.error('[willo-webhook] STAFF_APP_URL is not set — E3 cannot carry a link', log);
    return json(500, { error: 'not configured' });
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
    console.error('[willo-webhook] login provisioning failed', {
      ...log,
      code: issued.code,
      detail: issued.detail,
    });
    return json(500, { error: 'provisioning failed' });
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
    console.error('[willo-webhook] accept failed', { ...log, error: error.message });
    return json(500, { error: 'accept failed' });
  }
  console.log('[willo-webhook] accepted', { ...log, result: data });
  return json(200, { outcome: (data as { outcome?: string } | null)?.outcome ?? 'applied' });
}

// ---------------------------------------------------------------------
// Outbound: create due candidates in Willo
// ---------------------------------------------------------------------

interface Due {
  staff_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  attempt: number;
  /**
   * What the database allows this attempt to do (20260924170000):
   *   create  — nothing has reached Willo for this person this period.
   *   relink  — Willo already returned `created_candidate_id`; create
   *             NOTHING, only link it. This is what stops a second E1.
   *   recover — the last attempt left the create in doubt. Create again,
   *             reusing `invite_ref` so an API that honours an idempotency
   *             key hands back the first candidate.
   */
  invite_mode: 'create' | 'relink' | 'recover';
  invite_ref: string;
  created_candidate_id: string | null;
}

interface Recorded {
  outcome: string;
  linked: boolean;
  terminal: boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Record the key Willo returned, and link it, in one call.
 *
 * `willo_invite_created` answers a candidate who moved on with a terminal
 * OUTCOME rather than an error, so an error here means only that the call
 * did not get through — a deadlock on the staff row, a statement timeout,
 * a connection dropped mid-flight. Those are worth retrying immediately,
 * while the key is still in memory: every retry that succeeds here is a
 * duplicate Willo candidate and a duplicate E1 that never happens.
 */
async function recordCreated(
  db: SupabaseClient,
  row: Due,
  willoCandidateId: string,
): Promise<Recorded | { error: string }> {
  let last = 'unknown';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data, error } = await db.rpc('willo_invite_created', {
      p_staff: row.staff_id,
      p_willo_candidate_id: willoCandidateId,
      p_ref: row.invite_ref,
    });
    if (!error) return data as Recorded;
    last = error.message;
    console.error('[willo-invite] could not record the Willo key', {
      staffId: row.staff_id,
      willo: willoCandidateId,
      try: attempt + 1,
      error: last,
    });
    if (attempt < 2) await sleep(250 * 2 ** attempt);
  }
  return { error: last };
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

    const { data, error } = await db.rpc('willo_invite_due', { p_limit: 20 });
    if (error) throw new Error(`willo_invite_due: ${error.message}`);
    const due = (data ?? []) as Due[];

    let created = 0;
    let relinked = 0;
    let linked = 0;
    let terminal = 0;
    let failed = 0;
    for (const row of due) {
      // The whole fix, in one line: a candidate Willo has already created
      // is never created again. Creating one is not undoable and is what
      // sends E1, so the key the database kept is used as-is and only the
      // link is retried.
      let willoCandidateId = row.created_candidate_id;

      if (willoCandidateId) {
        relinked += 1;
        console.warn('[willo-invite] re-linking a candidate Willo already created', {
          staffId: row.staff_id,
          willo: willoCandidateId,
          attempt: row.attempt,
        });
      } else {
        if (row.invite_mode === 'recover') {
          // The database could not rule out that the previous attempt
          // created them. It is offering this one anyway — an applicant
          // who is never invited is worse than a duplicate that is
          // audited — with the same reference as that attempt.
          console.warn('[willo-invite] the previous attempt left the create in doubt', {
            staffId: row.staff_id,
            attempt: row.attempt,
            ref: row.invite_ref,
          });
        }
        const spec = willoInviteRequest(config, {
          staffId: row.staff_id,
          firstName: row.first_name,
          lastName: row.last_name,
          email: row.email,
          phone: row.phone,
          reference: row.invite_ref,
        });
        let answer: ReturnType<typeof readInviteAnswer>;
        try {
          const response = await fetch(spec.url, {
            method: spec.method,
            headers: spec.headers,
            body: spec.body,
            signal: AbortSignal.timeout(10_000),
          });
          answer = readInviteAnswer(response.status, await response.text());
        } catch (cause) {
          // The request may have been processed before the connection
          // died: `unknown`, never `no`.
          answer = {
            ok: false,
            retry: true,
            created: 'unknown',
            reason: `network: ${cause instanceof Error ? cause.message : String(cause)}`,
          };
        }

        if (!answer.ok) {
          failed += 1;
          console.error('[willo-invite] create failed', {
            staffId: row.staff_id,
            attempt: row.attempt,
            retry: answer.retry,
            created: answer.created,
            reason: answer.reason,
          });
          await db.rpc('willo_invite_failed', {
            p_staff: row.staff_id,
            p_error: answer.reason,
            p_ref: row.invite_ref,
            p_phase: 'create',
            p_created_in_willo: answer.created,
            p_retry: answer.retry,
          });
          continue;
        }
        created += 1;
        willoCandidateId = answer.willoCandidateId;
      }

      const record = await recordCreated(db, row, willoCandidateId);
      if ('error' in record) {
        // Every retry of the record-and-link call failed. Write the key
        // down on the failure path too — a plain insert, which takes no
        // lock on the staff row and so survives the deadlock or timeout
        // that most likely caused this — so the next sweep re-links.
        failed += 1;
        console.error('[willo-invite] created in Willo but not recorded', {
          staffId: row.staff_id,
          willo: willoCandidateId,
          error: record.error,
        });
        await db.rpc('willo_invite_failed', {
          p_staff: row.staff_id,
          p_error: `created ${willoCandidateId}, not linked: ${record.error}`,
          p_willo_candidate_id: willoCandidateId,
          p_ref: row.invite_ref,
          p_phase: 'link',
          p_created_in_willo: 'yes',
          p_retry: true,
        });
        continue;
      }

      if (record.linked) {
        linked += 1;
        continue;
      }

      // Terminal, and told apart from the transient case above by the
      // database rather than by reading an error string: the candidate was
      // rejected, removed or Reset between the create and the link, or the
      // key belongs to somebody else. Nothing to retry; the orphaned Willo
      // candidate is audited (willo_invite_orphan) for removal there.
      terminal += 1;
      console.error('[willo-invite] created in Willo but it can never be linked', {
        staffId: row.staff_id,
        willo: willoCandidateId,
        outcome: record.outcome,
      });
    }
    return { due: due.length, created, relinked, linked, terminal, failed };
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
