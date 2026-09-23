/**
 * notify-drain — the outbox drain (§8, §9.12, §10.5; P2).
 *
 * Every notification in the product is a `notification_outbox` row with a
 * unique key. pg_cron posts here every minute (job_schedules, 20260924100000);
 * each run:
 *
 *   1. claims a batch with claim_outbox_batch() — a 5-minute lease and
 *      `for update skip locked`, so two overlapping runs never hold the same
 *      row (supabase/tests/110, 470);
 *   2. reads `settings.senders` once, so a change on /settings applies from
 *      the next minute without a deploy (§9.12);
 *   3. hands the rows to drainBatch() in packages/notifications, which
 *      renders each through messageFor() / documentMessageFor(), sends Web
 *      Push over VAPID and email through Resend, prunes dead subscriptions,
 *      and returns one verdict per row;
 *   4. writes each verdict back: complete_outbox_send (sent / retry with the
 *      shared backoff, failed at the ceiling), fail_outbox_send (a row that
 *      can never be sent), release_outbox_claim (no keys — no attempt spent).
 *
 * The decisions are all in packages/notifications/src/drain.ts, imported by
 * relative path (ADR-0006, ADR-0020), and tested there with the network
 * mocked. This file is only the wiring to Supabase and `fetch`.
 *
 * Secrets, set with `supabase secrets set` (docs/12-keys-and-assets.md):
 *   RESEND_API_KEY                                     email
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT Web Push
 * With either set missing, that channel's rows are held with the reason on
 * the row and one log line per run; the other channel still sends.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { runJob } from '../_shared/job.ts';
import {
  UNCONFIGURED_RETRY_SECONDS,
  drainBatch,
  readDrainConfig,
} from '../../../packages/notifications/src/drain.ts';
import type { DrainPorts, Settlement } from '../../../packages/notifications/src/drain.ts';
import type { OutboxRow } from '../../../packages/notifications/src/outbox.ts';
import type { PushSubscriptionKeys } from '../../../packages/notifications/src/webpush.ts';

/**
 * Rows per run. Serial sends at well under a second each keep a full batch
 * far inside both the 5-minute lease and the Edge Runtime's wall clock, and
 * a queue deeper than this simply drains over the next few minutes.
 */
const BATCH = 40;
const LEASE = '5 minutes';
const HTTP_TIMEOUT_MS = 15_000;

function ports(db: SupabaseClient): DrainPorts {
  return {
    async http(request) {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        // Copied into a plain ArrayBuffer-backed view, which is what BodyInit takes.
        body: typeof request.body === 'string' ? request.body : new Uint8Array(request.body),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      return { status: response.status, text: () => response.text() };
    },

    async subscriptionsFor(staffId) {
      const { data, error } = await db
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth')
        .eq('staff_id', staffId);
      if (error) throw new Error(`push_subscriptions: ${error.message}`);
      return (data ?? []) as PushSubscriptionKeys[];
    },

    async deleteSubscription(endpoint) {
      const { error } = await db.from('push_subscriptions').delete().eq('endpoint', endpoint);
      // Not fatal: the message outcome stands, and the next 410 tries again.
      if (error) console.error(`notify-drain: could not prune a subscription: ${error.message}`);
    },

    async download(bucket, path) {
      const { data, error } = await db.storage.from(bucket).download(path);
      if (error) {
        const status =
          (error as { statusCode?: string | number; status?: number }).statusCode ??
          (error as { status?: number }).status;
        if (String(status) === '404' || /not.?found/i.test(error.message)) return null;
        throw new Error(error.message);
      }
      return new Uint8Array(await data.arrayBuffer());
    },

    log(message) {
      console.warn(message);
    },
  };
}

async function settle(db: SupabaseClient, s: Settlement): Promise<void> {
  const call =
    s.verdict === 'sent'
      ? db.rpc('complete_outbox_send', { p_id: s.id, p_ok: true })
      : s.verdict === 'retry'
        ? db.rpc('complete_outbox_send', { p_id: s.id, p_ok: false, p_error: s.error })
        : s.verdict === 'failed'
          ? db.rpc('fail_outbox_send', { p_id: s.id, p_error: s.error })
          : db.rpc('release_outbox_claim', {
              p_id: s.id,
              p_error: s.error,
              p_retry_in: `${UNCONFIGURED_RETRY_SECONDS} seconds`,
            });
  const { error } = await call;
  // A row whose verdict could not be written stays leased and comes back
  // when the lease ends — at worst one repeat, never a lost send. Resend's
  // Idempotency-Key (the outbox key) absorbs the repeat for email.
  if (error) throw new Error(`settling ${s.key}: ${error.message}`);
}

Deno.serve((request) =>
  runJob('notify-drain', request, async (db) => {
    const config = readDrainConfig((name) => Deno.env.get(name));

    const { data: claimed, error: claimError } = await db.rpc('claim_outbox_batch', {
      p_limit: BATCH,
      p_lease: LEASE,
    });
    if (claimError) throw new Error(`claim_outbox_batch: ${claimError.message}`);
    const rows = (claimed ?? []) as OutboxRow[];
    if (rows.length === 0) return { claimed: 0 };

    const { data: senders, error: sendersError } = await db
      .from('settings')
      .select('value')
      .eq('key', 'senders')
      .maybeSingle();
    // Not fatal: resolveSender() falls back to the seeded address and says so.
    if (sendersError)
      console.warn(`notify-drain: settings.senders unreadable: ${sendersError.message}`);

    const { settlements, counts } = await drainBatch(
      rows,
      config,
      senders?.value ?? null,
      ports(db),
    );

    const unsettled: string[] = [];
    for (const s of settlements) {
      try {
        await settle(db, s);
      } catch (cause) {
        unsettled.push(cause instanceof Error ? cause.message : String(cause));
      }
      if (s.verdict === 'retry' || s.verdict === 'failed') {
        console.warn(`notify-drain: ${s.key} ${s.verdict}: ${s.error}`);
      }
    }
    if (unsettled.length > 0) throw new Error(unsettled.join('; '));

    return { ...counts, ...(config.missing.length > 0 ? { notConfigured: config.missing } : {}) };
  }),
);
