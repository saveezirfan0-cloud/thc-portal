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

import type { DocumentBucket, EmailWithAttachments } from './documents.ts';
import { documentMessageFor, isDocumentEmail } from './documents.ts';
import { inlineLogoAttachment } from './email-logo.ts';
import type { EmailMessage, OutboxRow, PushMessage } from './outbox.ts';
import {
  UnsendableRow,
  messageFor,
  needsPortalLink,
  outboxBackoffMs,
  portalOrigin,
} from './outbox.ts';
import type { ResendAttachment } from './resend.ts';
import { RESEND_ENDPOINT, buildResendRequest, classifyResendStatus, toBase64 } from './resend.ts';
import { resolveSender } from './senders.ts';
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
  /**
   * The Client Portal's origin (CLIENT_PORTAL_URL), for CP2/CP3's link to
   * the event page (ADR-0135 §3). Absent, those rows are held as
   * unconfigured; every other row is unaffected, so it is not in `missing`.
   */
  clientPortalUrl?: string | null;
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
    clientPortalUrl: portalOrigin(get('CLIENT_PORTAL_URL')),
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
  // title, body, the deep link it opens on tap, and — for N8 only — the
  // label of the one button the register gives a push, which opens the
  // same link, and the collapse tag when the register gives one.
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

// `signedBy` lives in senders.ts (documents.ts applies it at render time);
// re-exported here, where it used to be.
export { signedBy } from './senders.ts';

/**
 * Render an email row: a document email (BG08/D1/D2) or a register email.
 * `replyTo` is the monitored address the HTML footer — and a document
 * email's signature and reply button — names.
 */
function renderEmail(
  row: OutboxRow,
  replyTo?: string,
  clientPortalUrl?: string | null,
): EmailMessage | EmailWithAttachments {
  const options = {
    ...(replyTo ? { replyTo } : {}),
    ...(clientPortalUrl ? { clientPortalUrl } : {}),
  };
  const message = isDocumentEmail(row.template)
    ? documentMessageFor(row, options)
    : messageFor(row, options);
  if (message.kind !== 'email') {
    throw new UnsendableRow(`${row.template} rendered as a push on the email channel`);
  }
  return message;
}

async function sendEmail(
  row: OutboxRow,
  apiKey: string,
  sendersSetting: unknown,
  ports: DrainPorts,
  clientPortalUrl?: string | null,
): Promise<Settlement> {
  // Rendered first, so a row that can never be sent fails as such even when
  // Resend is not configured — the caller only reaches here with a key. The
  // first render also says which sender the row is from; the second names
  // that sender's resolved reply-to address in the copy.
  const sender = resolveSender(renderEmail(row).sender, sendersSetting);
  if (sender.warning) ports.log(`notify-drain: ${sender.warning}; sending from ${sender.address}`);
  const message = renderEmail(row, sender.replyTo, clientPortalUrl);
  const document = 'attachments' in message ? message : null;

  // The files first, then the header's logo, which travels with every email
  // as an inline CID image (ADR-0073).
  const logo = inlineLogoAttachment();
  const attachments: ResendAttachment[] = [];
  if (document) {
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
  if (message.html.includes(`cid:${logo.contentId}`)) attachments.push(logo);

  const request = buildResendRequest(
    {
      from: sender.from,
      to: message.to,
      ...(document?.cc && document.cc.length > 0 ? { cc: document.cc } : {}),
      subject: message.subject,
      text: message.body,
      html: message.html,
      replyTo: sender.replyTo,
      ...(attachments.length > 0 ? { attachments } : {}),
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
  portal:
    'not configured: CLIENT_PORTAL_URL is not set — the customer email has no portal link, so it is held, no attempt counted',
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
      // ADR-0135 §3: a customer email whose button is the portal link is
      // never sent without one. Rendered first, so a wrong row still fails.
      const portal = portalOrigin(config.clientPortalUrl);
      if (needsPortalLink(row.template) && !portal) {
        messageFor(row);
        return { id: row.id, key: row.key, verdict: 'unconfigured', error: NOT_CONFIGURED.portal };
      }
      return await sendEmail(row, config.resendApiKey, sendersSetting, ports, portal);
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
 * Drain one claimed batch, one row at a time, and return every verdict at
 * the end. The Edge Function no longer uses this — `drainRun` settles each
 * row as it goes — but it is the plain form of the same decisions, and the
 * per-row tests read it. The missing-configuration line is logged once per
 * call, not once per row.
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

// ---------------------------------------------------------------------------
// one run: claim in rounds, send a few at a time, settle each as it lands
// ---------------------------------------------------------------------------

/**
 * The outbox as a run sees it — `claim_outbox_batch`, the four settle
 * calls behind `settle`, and `release_outbox_claims`. The Edge Function
 * implements it with RPCs; the tests with an in-memory table.
 */
export interface OutboxStore {
  /** Lease up to `limit` due rows, urgent first, oldest first within a class. */
  claim(limit: number): Promise<OutboxRow[]>;
  /** Write one verdict. Throws when it could not be written. */
  settle(settlement: Settlement): Promise<void>;
  /** Hand back claimed rows that were never started: due at once, no attempt counted. */
  release(ids: readonly number[]): Promise<void>;
}

export interface RunLimits {
  /** Rows per claim. Small, so a run re-reads the priority order often. */
  batch: number;
  /** Sends in flight at once. */
  concurrency: number;
  /** After this many ms from the start of the run, no new claim is made. */
  claimForMs: number;
  /** After this many ms, no new send starts; what is left is released. */
  sendForMs: number;
  /** The least gap between two Resend calls from this run (its rate limit). */
  emailIntervalMs: number;
}

/**
 * The defaults, and why.
 *
 * pg_cron starts a run every minute, and the Edge Runtime kills an isolate
 * at 150 s of wall clock (Free; 400 s on Paid). A run stops STARTING work
 * at 50 s, so it is normally finished before the next one starts — one
 * drain at a time keeps the Resend rate below its limit — and the slowest
 * send in flight then (the function's HTTP timeout, plus its settle) ends
 * far inside the wall clock: nothing a run sends is left unrecorded by the
 * kill.
 *
 * Six sends at a time: push calls take ~100–500 ms, so a run moves a few
 * hundred pushes where the serial drain moved 40. Email is held to two
 * calls a second, Resend's default team rate limit.
 */
export const DEFAULT_RUN_LIMITS: RunLimits = {
  batch: 30,
  concurrency: 6,
  claimForMs: 45_000,
  sendForMs: 50_000,
  emailIntervalMs: 500,
};

/** The send window's ceiling: 30 s and more of the 150 s wall clock is always left. */
export const MAX_SEND_FOR_MS = 110_000;

/**
 * The limits, from the environment where it sets them
 * (NOTIFY_DRAIN_SEND_FOR_MS, NOTIFY_DRAIN_CONCURRENCY,
 * RESEND_REQUESTS_PER_SECOND — for a Resend plan with a raised limit).
 * Anything absent, unreadable or out of bounds keeps the default.
 */
export function readRunLimits(env: (name: string) => string | undefined): RunLimits {
  const num = (name: string, min: number, max: number): number | null => {
    const raw = env(name);
    if (raw === undefined || raw.trim() === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  };
  const limits = { ...DEFAULT_RUN_LIMITS };
  const sendFor = num('NOTIFY_DRAIN_SEND_FOR_MS', 5_000, MAX_SEND_FOR_MS);
  if (sendFor !== null) {
    limits.sendForMs = sendFor;
    limits.claimForMs = Math.max(0, sendFor - 5_000);
  }
  const concurrency = num('NOTIFY_DRAIN_CONCURRENCY', 1, 16);
  if (concurrency !== null) limits.concurrency = Math.trunc(concurrency);
  const perSecond = num('RESEND_REQUESTS_PER_SECOND', 0.1, 50);
  if (perSecond !== null) limits.emailIntervalMs = Math.ceil(1000 / perSecond);
  return limits;
}

export interface RunClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const REAL_CLOCK: RunClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface RunCounts extends DrainCounts {
  /** Claimed but not started: handed back through `release`. */
  released: number;
  /** Claims made. */
  batches: number;
  /**
   * Why the run ended: the due queue ran dry, the time budget ran out, or
   * Resend's 429 held a batch that was all email.
   */
  stoppedBy: 'empty' | 'budget' | 'throttled';
  /** Set when Resend answered 429 and the run held its remaining email. */
  emailThrottled?: true;
}

export interface RunResult {
  counts: RunCounts;
  /** One message per verdict or release that could not be written. */
  unsettled: string[];
}

/**
 * One drain run.
 *
 * It claims a small batch, sends it `concurrency` rows at a time, and
 * settles every row the moment its send returns — so an isolate killed
 * mid-run has recorded everything it finished, and only what was in flight
 * at that instant can come back after the lease. Then it claims again,
 * until the queue is empty or `claimForMs` has passed; every claim reads
 * the priority order afresh, so an N9 queued mid-run waits for at most one
 * batch. A row claimed but not started when `sendForMs` passes is handed
 * back through `release`, due at once with its attempt refunded, so the
 * next run takes it in priority order instead of after the lease.
 *
 * Rate limits. Resend calls are spaced `emailIntervalMs` apart. A 429 from
 * Resend is still that row's retry with the shared backoff, as before, and
 * it also holds every other email in this run: those rows are handed back
 * unattempted rather than each spending an attempt on the same 429. A push
 * service's 429 stays a per-row retry: those limits are per device or per
 * sender, and `concurrency` is the bound.
 */
export async function drainRun(
  store: OutboxStore,
  config: DrainConfig,
  sendersSetting: unknown,
  ports: DrainPorts,
  limits: RunLimits = DEFAULT_RUN_LIMITS,
  clock: RunClock = REAL_CLOCK,
): Promise<RunResult> {
  const start = clock.now();
  const elapsed = () => clock.now() - start;
  const counts: RunCounts = {
    claimed: 0,
    sent: 0,
    retried: 0,
    failed: 0,
    unconfigured: 0,
    released: 0,
    batches: 0,
    stoppedBy: 'empty',
  };
  const unsettled: string[] = [];
  let loggedMissing = false;
  let emailHeld = false;
  let nextEmailAt = 0;

  // The ports, with Resend's 429 noticed on the way past.
  const watched: DrainPorts = {
    ...ports,
    async http(request) {
      const response = await ports.http(request);
      if (request.url === RESEND_ENDPOINT && response.status === 429) {
        emailHeld = true;
        counts.emailThrottled = true;
      }
      return response;
    },
  };

  const usesResend = (row: OutboxRow) => row.channel === 'email' && config.resendApiKey !== null;

  /** Wait for this run's next Resend slot; false when sending should not go ahead. */
  async function emailSlot(): Promise<boolean> {
    const now = clock.now();
    const at = Math.max(now, nextEmailAt);
    nextEmailAt = at + limits.emailIntervalMs;
    if (at > now) await clock.sleep(at - now);
    return !emailHeld && elapsed() < limits.sendForMs;
  }

  async function record(settlement: Settlement): Promise<void> {
    if (settlement.verdict === 'sent') counts.sent += 1;
    else if (settlement.verdict === 'retry') counts.retried += 1;
    else if (settlement.verdict === 'failed') counts.failed += 1;
    else counts.unconfigured += 1;
    if (settlement.verdict === 'retry' || settlement.verdict === 'failed') {
      ports.log(`notify-drain: ${settlement.key} ${settlement.verdict}: ${settlement.error}`);
    }
    try {
      await store.settle(settlement);
    } catch (cause) {
      // The row stays leased and comes back when the lease ends — at worst
      // one repeat, never a lost send. Resend's Idempotency-Key (the outbox
      // key) absorbs the repeat for email.
      unsettled.push(`settling ${settlement.key}: ${describe(cause)}`);
    }
  }

  /** Send one claimed batch; returns the ids that were never started. */
  async function sendAll(rows: readonly OutboxRow[]): Promise<number[]> {
    const queue = [...rows];
    const notStarted: number[] = [];
    async function worker(): Promise<void> {
      for (let row = queue.shift(); row !== undefined; row = queue.shift()) {
        const go =
          elapsed() < limits.sendForMs &&
          !(emailHeld && usesResend(row)) &&
          (!usesResend(row) || (await emailSlot()));
        if (!go) {
          notStarted.push(row.id);
          continue;
        }
        await record(await drainRow(row, config, sendersSetting, watched));
      }
    }
    const workers = Math.max(1, Math.min(limits.concurrency, rows.length));
    await Promise.all(Array.from({ length: workers }, () => worker()));
    return notStarted;
  }

  for (;;) {
    if (elapsed() >= limits.claimForMs) {
      counts.stoppedBy = 'budget';
      break;
    }
    const rows = await store.claim(limits.batch);
    counts.batches += 1;
    if (rows.length === 0) break;
    counts.claimed += rows.length;
    if (!loggedMissing && config.missing.length > 0) {
      loggedMissing = true;
      ports.log(
        `notify-drain: not configured — ${config.missing.join(', ')} missing; affected rows are held without counting an attempt`,
      );
    }

    const notStarted = await sendAll(rows);
    if (notStarted.length > 0) {
      try {
        await store.release(notStarted);
        counts.released += notStarted.length;
      } catch (cause) {
        // Not lost: they come back when their lease ends.
        unsettled.push(`releasing ${notStarted.length} unsent claims: ${describe(cause)}`);
      }
    }
    if (elapsed() >= limits.sendForMs) {
      counts.stoppedBy = 'budget';
      break;
    }
    // Email held after a 429 and a batch of nothing but email: claiming on
    // would only lease and hand back the same kind of row until the budget
    // ran out. The next run, a minute on, starts with a clean slate.
    if (notStarted.length === rows.length) {
      counts.stoppedBy = 'throttled';
      break;
    }
    // A short claim means nothing more is due; the next run is a minute away.
    if (rows.length < limits.batch) break;
  }

  return { counts, unsettled };
}
