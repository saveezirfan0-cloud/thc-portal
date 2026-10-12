/**
 * willo-webhook — Willo in both directions (§2.4, §2.12, Appendix B B1,
 * ADR-0021).
 *
 *   POST /willo-webhook?token=…  Willo's webhook. Willo sends no Supabase
 *                                JWT and signs nothing, so this function is
 *                                deployed with `--no-verify-jwt` and checks
 *                                the token in the address it was registered
 *                                with (WILLO_WEBHOOK_SECRET, ADR-0066) — or a
 *                                signature, if one is sent — before reading a
 *                                byte of the body as JSON.
 *   POST /willo-webhook/invite   "Create the candidate in Willo" (Willo
 *                                then sends E1) — and, for SpudBros Express
 *                                staff, skip the interview instead: login,
 *                                Documents, E3 (ADR-0117). Service key only: the
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
import { recordRun, runJob } from '../_shared/job.ts';
import {
  describeShape,
  eventTime,
  isPermanentRefusal,
  parseWilloEvent,
  readBodyCapped,
  refusalCode,
  runInviteSweep,
  verifyWilloSignature,
  willoApiConfig,
  willoLookupPath,
  willoSignatureConfig,
} from '../../../packages/db/src/willo.ts';
import type { InviteDue, WilloEvent } from '../../../packages/db/src/willo.ts';
import { issueActivationLink } from '../../../packages/db/src/provision.ts';
import type { AdminAuth } from '../../../packages/db/src/provision.ts';
import { runSpudbrosSkipSweep } from '../../../packages/db/src/spudbros.ts';
import type { SkipDue } from '../../../packages/db/src/spudbros.ts';

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
  // Capped as it is read, Content-Length or not: a chunked delivery declares
  // no length, and request.text() would buffer whatever it was sent.
  const raw = await readBodyCapped(request, MAX_BODY_BYTES);
  if (raw === null) return json(413, { error: 'too large' });

  const verdict = await verifyWilloSignature(
    raw,
    request.headers,
    willoSignatureConfig(env),
    Math.floor(Date.now() / 1000),
    new URL(request.url).searchParams.get('token'),
  );
  if (!verdict.ok) {
    if (verdict.reason === 'secret_missing') {
      // Never accept an unsigned delivery because the secret is missing —
      // or shorter than MIN_WEBHOOK_SECRET_LENGTH, which counts as missing.
      console.error(
        '[willo-webhook] WILLO_WEBHOOK_SECRET is not set or shorter than 32 characters — every delivery is refused',
      );
      return json(503, { error: 'not configured' });
    }
    console.warn('[willo-webhook] signature refused', { reason: verdict.reason });
    return json(401, { error: 'invalid signature' });
  }

  // Willo sends one event per webhook, and each of ours names its event in
  // the address (`&event=new_response`), so the address says what the body
  // may not (ADR-0066). The shape — paths and types, values only for event
  // and stage keys, never a name or an email — is logged for every delivery
  // until THC's payload is pinned down.
  const eventHint = new URL(request.url).searchParams.get('event');
  const shape = describeShape(raw);
  const parsed = parseWilloEvent(raw, { eventHint });
  if (!parsed.ok) {
    console.warn('[willo-webhook] unreadable delivery', {
      reason: parsed.reason,
      eventHint,
      shape,
    });
    return json(400, { error: parsed.reason });
  }
  console.log('[willo-webhook] delivery', { eventHint, shape });
  const event = parsed.event;
  const at = eventTime(event.occurredAt, Date.now());

  // One job_runs row per verified delivery, as every §7 job writes, so a
  // webhook that failed (or stopped arriving) is visible in the same place.
  // Unverified deliveries above write nothing: anyone can send those.
  const db = serviceClient();
  return recordRun(db, 'willo-webhook', () => applyDelivery(db, event, at));
}

async function applyDelivery(db: SupabaseClient, event: WilloEvent, at: string): Promise<Response> {
  // Which of the delivery's keys is one of our candidates: the named path
  // first, then any 32-hex value (the interview's own key matches nobody).
  const interviewKey = env('WILLO_INTERVIEW_KEY')?.trim();
  const keys = event.candidateKeys.filter((key) => key !== interviewKey);
  let plan: unknown = null;
  for (const key of keys) {
    const { data, error: planError } = await db.rpc('willo_event_plan', {
      p_willo_candidate_id: key,
      p_event: event.eventKey,
    });
    if (planError) {
      console.error('[willo-webhook] plan failed', {
        candidate: key,
        event: event.eventKey,
        error: planError.message,
      });
      return json(500, { error: 'plan failed' });
    }
    if (data) {
      event.willoCandidateId = key;
      plan = data;
      break;
    }
  }
  const log = {
    delivery: event.deliveryId,
    candidate: event.willoCandidateId,
    event: event.eventKey,
  };
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
    // ADR-0117: SpudBros Express staff skip the interview. Whoever of them
    // is still awaiting it gets their login and E3 here, Willo keys or not.
    // Never at the cost of THC's own invitations: an error here is logged
    // and counted, and the Willo sweep below still runs.
    const spudbros = await skipSpudbros(db).catch((cause) => {
      const error = cause instanceof Error ? cause.message : String(cause);
      console.error('[spudbros-skip] sweep failed', { error });
      return { spudbros_error: error };
    });

    const config = willoApiConfig(env);
    if (!config) {
      // §2.4's inputs arrive from THC (Appendix B, B1). Until then no
      // candidate is created in Willo and Willo sends no E1 — said loudly,
      // and nothing is leased, so every waiting candidate is picked up
      // the first time this runs with the keys set.
      console.warn(
        '[willo-invite] WILLO_API_KEY / WILLO_INTERVIEW_KEY not set — no candidate created in Willo, no E1 sent',
      );
      return { ...spudbros, skipped: 'WILLO_API_KEY or WILLO_INTERVIEW_KEY not set' };
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
    return { ...spudbros, ...result };
  });
}

/**
 * SpudBros Express staff do not do the Willo interview (ADR-0117,
 * 20261012150000): `spudbros_skip_due()` leases those still awaiting it,
 * and each gets the office Accept's login + personal link, then Documents
 * and E3 through `spudbros_skip_interview()`. The order is
 * `runSpudbrosSkipSweep` (packages/db/src/spudbros.ts, held by vitest).
 * Without STAFF_APP_URL nothing is minted and each is recorded as failed.
 */
async function skipSpudbros(db: SupabaseClient) {
  const origin = env('STAFF_APP_URL') ?? '';
  return runSpudbrosSkipSweep({
    async due() {
      const { data, error } = await db.rpc('spudbros_skip_due', { p_limit: 20 });
      if (error) throw new Error(`spudbros_skip_due: ${error.message}`);
      return (data ?? []) as SkipDue[];
    },
    issue: (candidate) =>
      issueActivationLink(db.auth.admin as unknown as AdminAuth, candidate, origin),
    async skip({ staffId, userId, link, installLink }) {
      const { data, error } = await db.rpc('spudbros_skip_interview', {
        p_staff: staffId,
        p_user: userId,
        p_activation_link: link,
        p_install_link: installLink,
      });
      if (error) throw new Error(`spudbros_skip_interview: ${error.message}`);
      return { outcome: (data as { outcome?: string } | null)?.outcome ?? 'unchanged' };
    },
    async recordFailure(staffId, reason) {
      const { error } = await db.rpc('spudbros_skip_failed', {
        p_staff: staffId,
        p_error: reason,
      });
      if (error) throw new Error(error.message);
    },
    log(level, message, details) {
      console[level](message, details);
    },
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
