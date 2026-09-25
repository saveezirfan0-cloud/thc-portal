/**
 * The outbox drain's decisions — Scope §8, §9.12, §10.5 (P2).
 *
 * `supabase/functions/notify-drain` is a thin shell: it claims rows, hands
 * them here with a handful of ports (HTTP, Storage, push_subscriptions, a
 * logger), and writes back whatever this returns. Everything that can go
 * wrong in a way a person would notice — which address an email comes from,
 * whether a failure is retried or final, which device subscriptions are
 * deleted, what happens with no keys at all — is decided in this file, and
 * `__tests__/drain.test.ts` holds it with the network mocked.
 *
 * Four verdicts per row, each mapping to one SQL call:
 *
 *   sent          complete_outbox_send(id, true)
 *   retry         complete_outbox_send(id, false, error) — the database
 *                 re-arms it with outbox_backoff(attempts), or fails it at
 *                 the attempt ceiling. `final` says which, for the log.
 *   failed        fail_outbox_send(id, error) — the ROW is wrong
 *                 (UnsendableRow, a 4xx the same bytes will get again, a
 *                 missing attachment). Retrying six times is six failures.
 *   unconfigured  release_outbox_claim(id, error) — the channel has no keys.
 *                 That is the owner's to fix, not the row's fault, so the
 *                 claim is handed back without counting as an attempt: when
 *                 the key lands, every queued row still has all its tries.
 */

import type { DocumentBucket } from './documents.ts';
import { documentMessageFor, isDocumentEmail } from './documents.ts';
import type { OutboxRow, PushMessage } from './outbox.ts';
import { UnsendableRow, messageFor, outboxBackoffMs } from './outbox.ts';
import type { ResendAttachment } from './resend.ts';
import { buildResendRequest, classifyResendStatus, toBase64 } from './resend.ts';
import { DEFAULT_SENDER_ADDRESSES, resolveSender } from './senders.ts';
import type { PushSubscriptionKeys, VapidKeys } from './webpush.ts';
import { buildPushRequest, classifyPushStatus } from './webpush.ts';

/** `complete_outbox_send`'s default ceiling (20260921130927). */
export const MAX_ATTEMPTS = 6;

/** How long an unconfigured row is handed back for before it is looked at again. */
export const UNCONFIGURED_RETRY_SECONDS = 300;

// ---------------------------------------------------------------------------
// configuration
// ---------------------------------------------------------------------------

export interface DrainConfig {
  resendApiKey: string | null;
  vapid: VapidKeys | null;
  /** Names of the secrets that are absent, for the one log line. */
  missing: string[];
}

/** Read the secrets. Absent or blank is "not configured", never a throw. */
export function readDrainConfig(env: (name: string) => string | undefined): DrainConfig {
  const get = (name: string): string | null => {
    const v = env(name);
    return v && v.trim() !== '' ? v.trim() : null;
  };
  const resendApiKey = get('RESEND_API_KEY');
  const publicKey = get('VAPID_PUBLIC_KEY');
  const privateKey = get('VAPID_PRIVATE_KEY');
  const subject = get('VAPID_SUBJECT');
  const missing: string[] = [];
  if (!resendApiKey) missing.push('RESEND_API_KEY');
  if (!publicKey) missing.push('VAPID_PUBLIC_KEY');
  if (!privateKey) missing.push('VAPID_PRIVATE_KEY');
  if (!subject) missing.push('VAPID_SUBJECT');
  return {
    resendApiKey,
    vapid: publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null,
    missing,
  };
}

// ---------------------------------------------------------------------------
// ports
// ---------------------------------------------------------------------------

export interface HttpResponseLike {
  status: number;
  text(): Promise<string>;
}

export interface DrainPorts {
  /** `fetch`, in production. */
  http(request: {
    url: string;
    method: 'POST';
    headers: Record<string, string>;
    body: string | Uint8Array;
  }): Promise<HttpResponseLike>;
  /** Every push_subscriptions row for one worker. */
  subscriptionsFor(staffId: string): Promise<PushSubscriptionKeys[]>;
  /** Delete one dead subscription (404/410 from the push service). */
  deleteSubscription(endpoint: string): Promise<void>;
  /** A Storage object's bytes, or null when it does not exist. Throws on anything else. */
  download(bucket: DocumentBucket, path: string): Promise<Uint8Array | null>;
  log(message: string): void;
}

// ---------------------------------------------------------------------------
// verdicts
// ---------------------------------------------------------------------------

export type Settlement =
  | { id: number; key: string; verdict: 'sent'; detail?: string }
  | {
      id: number;
      key: string;
      verdict: 'retry';
      error: string;
      final: boolean;
      nextInMs: number | null;
    }
  | { id: number; key: string; verdict: 'failed'; error: string }
  | { id: number; key: string; verdict: 'unconfigured'; error: string };

/**
 * Whether a retry of a row claimed `attempts` times is its last. Mirrors
 * `complete_outbox_send`: at the ceiling the row is failed, otherwise
 * re-armed after `outbox_backoff(attempts)`.
 */
export function retryDecision(
  attempts: number,
  maxAttempts: number = MAX_ATTEMPTS,
): { final: boolean; nextInMs: number | null } {
  return attempts >= maxAttempts
    ? { final: true, nextInMs: null }
    : { final: false, nextInMs: outboxBackoffMs(attempts) };
}

function retry(row: OutboxRow, error: string): Settlement {
  return { id: row.id, key: row.key, verdict: 'retry', error, ...retryDecision(row.attempts) };
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** A short, credential-free excerpt of a provider's error body. */
async function excerpt(response: HttpResponseLike): Promise<string> {
  try {
    const text = (await response.text()).replace(/\s+/g, ' ').trim();
    return text.length > 200 ? `${text.slice(0, 200)}…` : text;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// push
// ---------------------------------------------------------------------------

/**
 * One push to every device the worker has registered. A worker with a phone
 * and a tablet gets it on both; one dead device is pruned without costing
 * the live one its message.
 *
 * The row is `sent` if ANY device accepted it — retrying would repeat the
 * notification on the device that already has it.
 *
 * A worker with NO registered device — never enabled notifications, or every
 * device just answered 404/410 and was pruned — is failed at once, not
 * retried. Six retries spread over ~31 minutes only delayed the failure: a
 * push is time-bound (N9 "time to check in" is worthless half an hour late),
 * the worker re-subscribing does not re-queue it, and a clear `failed` row is
 * what tells the office this person cannot be reached by push. A transient
 * push-service error on a live device is still a retry.
 */
async function sendPush(
  row: OutboxRow,
  message: PushMessage,
  vapid: VapidKeys,
  ports: DrainPorts,
): Promise<Settlement> {
  const subscriptions = await ports.subscriptionsFor(message.staffId);
  if (subscriptions.length === 0) {
    return {
      id: row.id,
      key: row.key,
      verdict: 'failed',
      error: 'no push subscription: the worker has not enabled notifications on any device',
    };
  }

  // The service worker (apps/staff/sw.ts) reads exactly these fields:
  // title, body and url always; action and tag when the register gives them.
  const payload = {
    title: message.title,
    body: message.body,
    url: message.url ?? '/shifts',
    ...(message.action ? { action: message.action } : {}),
    ...(message.tag ? { tag: message.tag } : {}),
  };

  const results = await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        const request = await buildPushRequest(subscription, payload, vapid);
        const response = await ports.http(request);
        const verdict = classifyPushStatus(response.status);
        if (verdict === 'gone') {
          await ports.deleteSubscription(subscription.endpoint);
        }
        return { verdict, status: response.status as number | null, error: null as string | null };
      } catch (cause) {
        // Never echo the endpoint: it is a bearer capability for the device.
        return { verdict: 'retry' as const, status: null, error: describe(cause) };
      }
    }),
  );

  const delivered = results.filter((r) => r.verdict === 'delivered').length;
  const pruned = results.filter((r) => r.verdict === 'gone').length;
  if (delivered > 0) {
    return {
      id: row.id,
      key: row.key,
      verdict: 'sent',
      detail: `${delivered}/${subscriptions.length} devices${pruned ? `, ${pruned} pruned` : ''}`,
    };
  }
  const reasons = results
    .map((r) =>
      r.verdict === 'gone'
        ? 'subscription gone (deleted)'
        : r.error
          ? `error: ${r.error}`
          : `push service answered ${r.status}`,
    )
    .join('; ');
  const message_ = `push not delivered to any of ${subscriptions.length} devices — ${reasons}`;
  // Every device was pruned: nothing left to retry against.
  if (pruned === subscriptions.length) {
    return { id: row.id, key: row.key, verdict: 'failed', error: message_ };
  }
  return retry(row, message_);
}

// ---------------------------------------------------------------------------
// email
// ---------------------------------------------------------------------------

/**
 * The document emails (BG08/D1/D2) sign off with their sender's address. The
 * copy names the default (`documents.ts` keeps THC's wording readable); when
 * `/settings` has moved that sender, the signature follows the From line
 * rather than contradicting it.
 */
export function signedBy(
  body: string,
  sender: keyof typeof DEFAULT_SENDER_ADDRESSES,
  address: string,
): string {
  const fallback = DEFAULT_SENDER_ADDRESSES[sender];
  return address === fallback ? body : body.split(fallback).join(address);
}

async function sendEmail(
  row: OutboxRow,
  apiKey: string,
  sendersSetting: unknown,
  ports: DrainPorts,
): Promise<Settlement> {
  // Rendered first, so a row that can never be sent fails as such even when
  // Resend is not configured — the caller only reaches here with a key.
  const document = isDocumentEmail(row.template) ? documentMessageFor(row) : null;
  const message = document ?? messageFor(row);
  if (message.kind !== 'email') {
    throw new UnsendableRow(`${row.template} rendered as a push on the email channel`);
  }

  const sender = resolveSender(message.sender, sendersSetting);
  if (sender.warning) ports.log(`notify-drain: ${sender.warning}; sending from ${sender.address}`);

  let attachments: ResendAttachment[] | undefined;
  if (document) {
    attachments = [];
    for (const a of document.attachments) {
      let bytes: Uint8Array | null;
      try {
        bytes = await ports.download(a.bucket, a.path);
      } catch (cause) {
        return retry(row, `could not read ${a.bucket}/${a.path}: ${describe(cause)}`);
      }
      if (bytes === null) {
        // BG08/D1/D2 upload before they queue, so a missing file is not
        // late — it is gone, and the office has a Retry that re-generates.
        throw new UnsendableRow(`${row.template}: attachment ${a.bucket}/${a.path} does not exist`);
      }
      attachments.push({ filename: a.filename, content: toBase64(bytes) });
    }
  }

  const request = buildResendRequest(
    {
      from: sender.from,
      to: message.to,
      subject: message.subject,
      text: signedBy(message.body, message.sender, sender.address),
      replyTo: sender.address,
      ...(attachments ? { attachments } : {}),
    },
    apiKey,
    row.key,
  );

  let response: HttpResponseLike;
  try {
    response = await ports.http(request);
  } catch (cause) {
    return retry(row, `Resend unreachable: ${describe(cause)}`);
  }
  const verdict = classifyResendStatus(response.status);
  if (verdict === 'sent')
    return { id: row.id, key: row.key, verdict: 'sent', detail: sender.address };
  const said = await excerpt(response);
  const why = `Resend answered ${response.status}${said ? `: ${said}` : ''}`;
  return verdict === 'permanent'
    ? { id: row.id, key: row.key, verdict: 'failed', error: why }
    : retry(row, why);
}

// ---------------------------------------------------------------------------
// one row, one batch
// ---------------------------------------------------------------------------

export const NOT_CONFIGURED = {
  email: 'not configured: RESEND_API_KEY is not set — email is held, no attempt counted',
  push: 'not configured: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT are not all set — push is held, no attempt counted',
} as const;

export async function drainRow(
  row: OutboxRow,
  config: DrainConfig,
  sendersSetting: unknown,
  ports: DrainPorts,
): Promise<Settlement> {
  try {
    if (row.channel === 'push') {
      // Render before checking keys: an unsendable row is failed whatever
      // the configuration, so it does not sit in the queue looking held.
      const message = messageFor(row);
      if (message.kind !== 'push') throw new UnsendableRow(`${row.template} is not a push`);
      if (!config.vapid) {
        return { id: row.id, key: row.key, verdict: 'unconfigured', error: NOT_CONFIGURED.push };
      }
      return await sendPush(row, message, config.vapid, ports);
    }
    if (row.channel === 'email') {
      if (!config.resendApiKey) {
        // Still render, for the same reason as push.
        if (isDocumentEmail(row.template)) documentMessageFor(row);
        else messageFor(row);
        return { id: row.id, key: row.key, verdict: 'unconfigured', error: NOT_CONFIGURED.email };
      }
      return await sendEmail(row, config.resendApiKey, sendersSetting, ports);
    }
    throw new UnsendableRow(`channel ${String(row.channel)} is neither push nor email`);
  } catch (cause) {
    if (cause instanceof UnsendableRow) {
      return { id: row.id, key: row.key, verdict: 'failed', error: cause.message };
    }
    return retry(row, describe(cause));
  }
}

export interface DrainCounts {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  unconfigured: number;
}

/**
 * Drain one claimed batch. Rows go one at a time: a batch is at most a few
 * dozen, and serial sends keep Resend's per-second rate limit out of the
 * picture. The missing-configuration line is logged once per run, not once
 * per row.
 */
export async function drainBatch(
  rows: readonly OutboxRow[],
  config: DrainConfig,
  sendersSetting: unknown,
  ports: DrainPorts,
): Promise<{ settlements: Settlement[]; counts: DrainCounts }> {
  if (rows.length > 0 && config.missing.length > 0) {
    ports.log(
      `notify-drain: not configured — ${config.missing.join(', ')} missing; affected rows are held without counting an attempt`,
    );
  }
  const settlements: Settlement[] = [];
  for (const row of rows) settlements.push(await drainRow(row, config, sendersSetting, ports));
  const counts: DrainCounts = {
    claimed: rows.length,
    sent: 0,
    retried: 0,
    failed: 0,
    unconfigured: 0,
  };
  for (const s of settlements) {
    if (s.verdict === 'sent') counts.sent += 1;
    else if (s.verdict === 'retry') counts.retried += 1;
    else if (s.verdict === 'failed') counts.failed += 1;
    else counts.unconfigured += 1;
  }
  return { settlements, counts };
}
