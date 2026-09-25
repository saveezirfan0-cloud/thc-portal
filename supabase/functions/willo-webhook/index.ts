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
 * The rules are SQL (20260924110000, 20260923110000) and held by pgTAP
 * 380 / 480; the parsing and the signature are
 * packages/db/src/willo.ts, held by vitest; the login is
 * packages/db/src/provision.ts, the SAME code the office Accept runs.
 * What is left here is only the order of the calls.
 *
 * Secrets (supabase secrets set …; never in code): WILLO_WEBHOOK_SECRET,
 * WILLO_API_KEY, WILLO_INTERVIEW_KEY, STAFF_APP_URL, and optionally
 * WILLO_SIGNATURE_HEADER, WILLO_TIMESTAMP_HEADER,
 * WILLO_TIMESTAMP_TOLERANCE_SECONDS, WILLO_API_BASE, WILLO_INVITE_PATH,
 * WILLO_LOOKUP_PATH (ADR-0024; `off` disables the lookup),
 * WILLO_API_AUTH_HEADER, WILLO_API_AUTH_PREFIX. docs/12 lists them.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { runJob } from '../_shared/job.ts';
import {
  eventTime,
  isPermanentRefusal,
  parseWilloEvent,
  refusalCode,
  runInviteSweep,
  verifyWilloSignature,
  willoApiConfig,
  willoLookupPath,
  willoSignatureConfig,
} from '../../../packages/db/src/willo.ts';
import type { InviteDue } from '../../../packages/db/src/willo.ts';
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

/**
 * The order of the calls lives in `runInviteSweep` (packages/db/src/
 * willo.ts), held by vitest: a key Willo already returned this period is
 * linked, never created again; a retry asks Willo by external_id before
 * creating; a created key is recorded and linked in ONE call
 * (`willo_invite_created`, 20260926100000). ADR-0024.
 */
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
    const due = (data ?? []) as InviteDue[];

    const result = await runInviteSweep(
      {
        config,
        lookupPath: willoLookupPath(env),
        async http(spec) {
          const response = await fetch(spec.url, {
            method: spec.method,
            headers: spec.headers,
            body: 'body' in spec ? spec.body : undefined,
            signal: AbortSignal.timeout(10_000),
          });
          return { status: response.status, text: await response.text() };
        },
        async recordCreated(staffId, willoCandidateId) {
          const { data: out, error: recordError } = await db.rpc('willo_invite_created', {
            p_staff: staffId,
            p_willo_candidate_id: willoCandidateId,
          });
          if (recordError) return { ok: false, message: recordError.message };
          const body = (out ?? {}) as { outcome?: string; code?: string };
          const outcome =
            body.outcome === 'linked' || body.outcome === 'already_linked'
              ? body.outcome
              : 'not_linked';
          return body.code ? { ok: true, outcome, code: body.code } : { ok: true, outcome };
        },
        async recordFailure(staffId, reason) {
          const { error: failError } = await db.rpc('willo_invite_failed', {
            p_staff: staffId,
            p_error: reason,
          });
          if (failError) throw new Error(failError.message);
        },
        log(level, message, details) {
          console[level](message, details);
        },
      },
      due,
    );
    return { ...result };
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
