import { createECDH } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type {
  DrainConfig,
  DrainPorts,
  HttpResponseLike,
  OutboxStore,
  RunClock,
  RunLimits,
  Settlement,
} from '../drain';
import {
  DEFAULT_RUN_LIMITS,
  MAX_SEND_FOR_MS,
  UNCONFIGURED_RETRY_SECONDS,
  drainRun,
  readRunLimits,
} from '../drain';
import type { OutboxRow } from '../outbox';
import { outboxBackoffMs } from '../outbox';
import { sendPriority } from '../priority';
import { RESEND_ENDPOINT } from '../resend';
import { b64urlEncode } from '../webpush';

/**
 * drainRun (ADR-0158): settle as you go, a time budget that hands back
 * what it did not start, bounded concurrency, Resend's rate limit, and no
 * row sent twice by two runs that overlap.
 */

// ---------------------------------------------------------------------------
// an in-memory notification_outbox with claim_outbox_batch's semantics
// ---------------------------------------------------------------------------

interface MemRow extends OutboxRow {
  priority: number;
  sendAfter: number;
  sentAt: number | null;
  failedAt: number | null;
  error: string | null;
}

const LEASE_MS = 5 * 60_000;

class MemOutbox implements OutboxStore {
  rows: MemRow[] = [];
  log: string[] = [];
  private keys = new Set<string>();
  constructor(private readonly now: () => number) {}

  /** enqueue: one row per key, like the unique index. */
  enqueue(row: Omit<OutboxRow, 'id' | 'attempts'> & { sendAfter?: number }): void {
    if (this.keys.has(row.key)) return;
    this.keys.add(row.key);
    this.rows.push({
      ...row,
      id: this.rows.length + 1,
      attempts: 0,
      priority: sendPriority(row.template),
      sendAfter: row.sendAfter ?? this.now(),
      sentAt: null,
      failedAt: null,
      error: null,
    });
  }

  row(key: string): MemRow {
    const r = this.rows.find((x) => x.key === key);
    if (!r) throw new Error(`no row ${key}`);
    return r;
  }

  // The body runs without an await, so like `for update skip locked` two
  // overlapping claims can never see the same unleased row.
  async claim(limit: number): Promise<OutboxRow[]> {
    await Promise.resolve();
    const now = this.now();
    const due = this.rows
      .filter((r) => r.sentAt === null && r.failedAt === null && r.sendAfter <= now)
      .sort((a, b) => a.priority - b.priority || a.sendAfter - b.sendAfter || a.id - b.id)
      .slice(0, limit);
    for (const r of due) {
      r.attempts += 1;
      r.sendAfter = now + LEASE_MS;
    }
    this.log.push(`claim ${due.map((r) => r.key).join(',')}`);
    return due.map((r) => ({ ...r }));
  }

  async settle(s: Settlement): Promise<void> {
    await Promise.resolve();
    const r = this.rows.find((x) => x.id === s.id)!;
    this.log.push(`settle ${s.key} ${s.verdict}`);
    if (r.sentAt !== null || r.failedAt !== null) return;
    const now = this.now();
    if (s.verdict === 'sent') {
      r.sentAt = now;
      r.error = null;
    } else if (s.verdict === 'retry') {
      r.error = s.error;
      if (r.attempts >= 6) r.failedAt = now;
      else r.sendAfter = now + outboxBackoffMs(r.attempts);
    } else if (s.verdict === 'failed') {
      r.failedAt = now;
      r.error = s.error;
    } else {
      r.attempts = Math.max(r.attempts - 1, 0);
      r.error = s.error;
      r.sendAfter = now + UNCONFIGURED_RETRY_SECONDS * 1000;
    }
  }

  async release(ids: readonly number[]): Promise<void> {
    await Promise.resolve();
    const now = this.now();
    for (const r of this.rows) {
      if (!ids.includes(r.id)) continue;
      if (r.sentAt !== null || r.failedAt !== null || r.sendAfter <= now) continue;
      r.attempts = Math.max(r.attempts - 1, 0);
      r.sendAfter = now;
    }
    this.log.push(`release ${ids.length}`);
  }
}

// ---------------------------------------------------------------------------
// providers
// ---------------------------------------------------------------------------

const vapidPair = createECDH('prime256v1');
vapidPair.generateKeys();
const browser = createECDH('prime256v1');
browser.generateKeys();

const CONFIG: DrainConfig = {
  resendApiKey: 're_test_key',
  vapid: {
    publicKey: b64urlEncode(vapidPair.getPublicKey()),
    privateKey: b64urlEncode(
      Buffer.concat([Buffer.alloc(32), vapidPair.getPrivateKey()]).subarray(-32),
    ),
    subject: 'mailto:admin@thehospitalitycompany.co.uk',
  },
  missing: [],
};

/** Each worker has one device, at an endpoint named after them. */
const endpointFor = (staffId: string) => `https://fcm.googleapis.com/fcm/send/${staffId}`;

interface Delivery {
  /** The outbox key for email (Idempotency-Key), the staff id for push. */
  who: string;
  at: number;
}

function providers(opts: {
  clock: { now(): number };
  /** Runs before each answer: advance a fake clock, wait, or hang. */
  before?: (who: string) => Promise<void> | void;
  status?: (who: string, isEmail: boolean) => number;
  log?: string[];
}) {
  const deliveries: Delivery[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const ports: DrainPorts = {
    async http(request): Promise<HttpResponseLike> {
      const isEmail = request.url === RESEND_ENDPOINT;
      const who = isEmail
        ? request.headers['Idempotency-Key']!
        : request.url.slice(request.url.lastIndexOf('/') + 1);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      opts.log?.push(`http ${who}`);
      try {
        const at = opts.clock.now();
        await opts.before?.(who);
        const status = opts.status?.(who, isEmail) ?? (isEmail ? 200 : 201);
        if (status >= 200 && status < 300) deliveries.push({ who, at });
        return { status, text: async () => (status === 429 ? 'rate limited' : '') };
      } finally {
        inFlight -= 1;
      }
    },
    async subscriptionsFor(staffId) {
      return [
        {
          endpoint: endpointFor(staffId),
          p256dh: b64urlEncode(browser.getPublicKey()),
          auth: b64urlEncode(new Uint8Array(16).fill(7)),
        },
      ];
    },
    async deleteSubscription() {},
    async download() {
      return null;
    },
    log() {},
  };
  return { ports, deliveries, maxInFlight: () => maxInFlight };
}

function fakeClock(): RunClock & { t: number } {
  const clock = {
    t: 0,
    now: () => clock.t,
    sleep: async (ms: number) => {
      clock.t += ms;
    },
  };
  return clock;
}

const realClock: RunClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

const emailRow = (n: number, template = 'E2') => ({
  key: `${template}:staff:${n}`,
  channel: 'email' as const,
  template,
  recipient_staff_id: null,
  recipient_emails: [`candidate${n}@example.com`],
  payload: {},
});

const pushRow = (n: number, template = 'N12') => ({
  key: `${template}:booking:${n}`,
  channel: 'push' as const,
  template,
  recipient_staff_id: `staff-${n}`,
  recipient_emails: null,
  payload: {},
});

const limits = (over: Partial<RunLimits> = {}): RunLimits => ({
  ...DEFAULT_RUN_LIMITS,
  emailIntervalMs: 0,
  ...over,
});

// ---------------------------------------------------------------------------

describe('drainRun — the time budget', () => {
  it('records each send as it lands, stops at the budget, and hands back the rest', async () => {
    const clock = fakeClock();
    const outbox = new MemOutbox(clock.now);
    for (let n = 1; n <= 10; n += 1) outbox.enqueue(emailRow(n));
    const { ports, deliveries } = providers({
      clock,
      log: outbox.log,
      before: () => {
        clock.t += 30; // every Resend call takes 30 ms of the run
      },
    });

    const { counts, unsettled } = await drainRun(
      outbox,
      CONFIG,
      null,
      ports,
      limits({ batch: 10, concurrency: 1, claimForMs: 100, sendForMs: 100 }),
      clock,
    );

    // Starts at 0, 30, 60, 90; at 120 the window is closed.
    expect(deliveries.map((d) => d.who)).toEqual([
      'E2:staff:1',
      'E2:staff:2',
      'E2:staff:3',
      'E2:staff:4',
    ]);
    expect(counts).toMatchObject({ claimed: 10, sent: 4, released: 6, stoppedBy: 'budget' });
    expect(unsettled).toEqual([]);

    // Each row is written before the next send starts.
    expect(outbox.log.slice(0, 5)).toEqual([
      'claim E2:staff:1,E2:staff:2,E2:staff:3,E2:staff:4,E2:staff:5,E2:staff:6,E2:staff:7,E2:staff:8,E2:staff:9,E2:staff:10',
      'http E2:staff:1',
      'settle E2:staff:1 sent',
      'http E2:staff:2',
      'settle E2:staff:2 sent',
    ]);

    // The released rows are due now with their attempt refunded, so the next
    // run takes them in priority order instead of after the lease.
    for (let n = 5; n <= 10; n += 1) {
      const r = outbox.row(`E2:staff:${n}`);
      expect(r).toMatchObject({ attempts: 0, sentAt: null, failedAt: null, error: null });
      expect(r.sendAfter).toBeLessThanOrEqual(clock.t);
    }

    // And the next run sends exactly those six.
    const next = await drainRun(outbox, CONFIG, null, ports, limits(), clock);
    expect(next.counts).toMatchObject({ claimed: 6, sent: 6, released: 0, stoppedBy: 'empty' });
    expect(new Set(deliveries.map((d) => d.who)).size).toBe(10);
    expect(deliveries).toHaveLength(10);
  });

  it('a run killed mid-send has already recorded everything it finished', async () => {
    const clock = fakeClock();
    const outbox = new MemOutbox(clock.now);
    for (let n = 1; n <= 6; n += 1) outbox.enqueue(pushRow(n));
    let reached!: () => void;
    const hung = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const { ports, deliveries } = providers({
      clock,
      // The fourth push never answers: the isolate is killed while it waits.
      before: (who) => {
        if (who !== 'staff-4') return undefined;
        reached();
        return new Promise<void>(() => {});
      },
    });

    void drainRun(outbox, CONFIG, null, ports, limits({ concurrency: 1 }), clock);
    await hung;

    expect(deliveries.map((d) => d.who)).toEqual(['staff-1', 'staff-2', 'staff-3']);
    for (const n of [1, 2, 3]) expect(outbox.row(`N12:booking:${n}`).sentAt).not.toBeNull();

    // Past the lease, only rows never recorded come back; the three sent
    // are never pushed again.
    clock.t += LEASE_MS + 1;
    const again = await outbox.claim(50);
    expect(again.map((r) => r.key)).toEqual(['N12:booking:4', 'N12:booking:5', 'N12:booking:6']);
  });

  it('claims again while there is time and work, and stops when the queue is dry', async () => {
    const clock = fakeClock();
    const outbox = new MemOutbox(clock.now);
    for (let n = 1; n <= 7; n += 1) outbox.enqueue(pushRow(n));
    const { ports } = providers({ clock });
    const { counts } = await drainRun(outbox, CONFIG, null, ports, limits({ batch: 3 }), clock);
    expect(counts).toMatchObject({ claimed: 7, sent: 7, batches: 3, stoppedBy: 'empty' });
  });

  it('makes no claim at all once the claim window has passed', async () => {
    const clock = fakeClock();
    const outbox = new MemOutbox(clock.now);
    outbox.enqueue(pushRow(1));
    const { ports } = providers({
      clock,
      before: () => {
        clock.t += 1_000;
      },
    });
    const { counts } = await drainRun(
      outbox,
      CONFIG,
      null,
      ports,
      limits({ batch: 1, claimForMs: 500, sendForMs: 2_000 }),
      clock,
    );
    expect(counts).toMatchObject({ claimed: 1, sent: 1, batches: 1, stoppedBy: 'budget' });
  });
});

describe('drainRun — priority and concurrency', () => {
  it('sends urgent rows ahead of an older burst of chasers', async () => {
    const clock = fakeClock();
    clock.t = 1_000_000;
    const outbox = new MemOutbox(clock.now);
    for (let n = 1; n <= 40; n += 1)
      outbox.enqueue({ ...emailRow(n, 'OC1'), payload: { variant: 'repeat' }, sendAfter: 0 });
    outbox.enqueue({ ...pushRow(1, 'N9'), payload: { variant: 'check-in' } });
    outbox.enqueue(pushRow(2, 'N6b'));
    const { ports, deliveries } = providers({ clock });
    const { counts } = await drainRun(
      outbox,
      CONFIG,
      null,
      ports,
      limits({ batch: 5, concurrency: 1 }),
      clock,
    );
    expect(counts).toMatchObject({ sent: 42, failed: 0 });
    // Queued last and still sent first: the claim reads priority before age.
    expect(deliveries.slice(0, 2).map((d) => d.who)).toEqual(['staff-1', 'staff-2']);
    expect(deliveries[2]!.who).toBe('OC1:staff:1');
  });

  it('keeps at most `concurrency` sends in flight', async () => {
    const outbox = new MemOutbox(Date.now);
    for (let n = 1; n <= 20; n += 1) outbox.enqueue(pushRow(n));
    const p = providers({
      clock: realClock,
      before: () => new Promise((r) => setTimeout(r, 20)),
    });
    const { counts } = await drainRun(
      outbox,
      CONFIG,
      null,
      p.ports,
      limits({ concurrency: 4 }),
      realClock,
    );
    expect(counts.sent).toBe(20);
    // Never more than four at once, and more than one: it does run them side by side.
    expect(p.maxInFlight()).toBeLessThanOrEqual(4);
    expect(p.maxInFlight()).toBeGreaterThan(1);
  });

  it('no row is sent twice by two runs that overlap', async () => {
    const outbox = new MemOutbox(Date.now);
    for (let n = 1; n <= 30; n += 1) outbox.enqueue(pushRow(n));
    for (let n = 1; n <= 30; n += 1) outbox.enqueue(emailRow(n));
    const p = providers({
      clock: realClock,
      before: () => new Promise((r) => setTimeout(r, Math.floor(Math.random() * 4))),
    });
    const run = () =>
      drainRun(outbox, CONFIG, null, p.ports, limits({ batch: 7, concurrency: 3 }), realClock);

    const [a, b] = await Promise.all([run(), run()]);

    expect(a.counts.sent + b.counts.sent).toBe(60);
    expect(a.counts.sent).toBeGreaterThan(0);
    expect(b.counts.sent).toBeGreaterThan(0);
    const who = p.deliveries.map((d) => d.who);
    expect(who).toHaveLength(60);
    expect(new Set(who).size).toBe(60);
    expect(outbox.rows.every((r) => r.sentAt !== null && r.attempts === 1)).toBe(true);
  });
});

describe('drainRun — provider rate limits', () => {
  it('spaces Resend calls by emailIntervalMs, whatever the concurrency', async () => {
    // A frozen clock that records each wait: four workers reach their Resend
    // call together, and each is given its own slot 500 ms after the last.
    const waits: number[] = [];
    const frozen: RunClock = {
      now: () => 0,
      sleep: async (ms) => {
        waits.push(ms);
      },
    };
    const outbox = new MemOutbox(frozen.now);
    for (let n = 1; n <= 4; n += 1) outbox.enqueue(emailRow(n));
    const { ports, deliveries } = providers({ clock: frozen });
    await drainRun(
      outbox,
      CONFIG,
      null,
      ports,
      limits({ concurrency: 4, emailIntervalMs: 500 }),
      frozen,
    );
    expect(deliveries).toHaveLength(4);
    expect(waits.sort((a, b) => a - b)).toEqual([500, 1000, 1500]);
  });

  it('a Resend 429 retries that row and holds the run’s other email, unattempted', async () => {
    const clock = fakeClock();
    const outbox = new MemOutbox(clock.now);
    for (let n = 1; n <= 4; n += 1) outbox.enqueue(emailRow(n));
    outbox.enqueue(pushRow(1));
    const { ports, deliveries } = providers({
      clock,
      status: (who, isEmail) => (isEmail && who === 'E2:staff:1' ? 429 : isEmail ? 200 : 201),
    });
    const { counts } = await drainRun(
      outbox,
      CONFIG,
      null,
      ports,
      limits({ concurrency: 1 }),
      clock,
    );

    // The push is not an email: it still goes.
    expect(deliveries.map((d) => d.who)).toEqual(['staff-1']);
    expect(counts).toMatchObject({ retried: 1, released: 3, sent: 1, emailThrottled: true });
    const first = outbox.row('E2:staff:1');
    expect(first.attempts).toBe(1);
    expect(first.error).toMatch(/Resend answered 429/);
    expect(first.sendAfter).toBe(clock.t + outboxBackoffMs(1));
    for (const n of [2, 3, 4]) expect(outbox.row(`E2:staff:${n}`).attempts).toBe(0);
  });

  it('stops claiming when a batch was nothing but held email', async () => {
    const clock = fakeClock();
    const outbox = new MemOutbox(clock.now);
    for (let n = 1; n <= 9; n += 1) outbox.enqueue(emailRow(n));
    const { ports } = providers({ clock, status: () => 429 });
    const { counts } = await drainRun(
      outbox,
      CONFIG,
      null,
      ports,
      limits({ batch: 3, concurrency: 1 }),
      clock,
    );
    // Batch 1: one 429, two held. Batch 2: all three held → stop.
    expect(counts).toMatchObject({ batches: 2, retried: 1, released: 5, stoppedBy: 'throttled' });
  });

  it('does not rate-gate email that is held for want of a key', async () => {
    const clock = fakeClock();
    const outbox = new MemOutbox(clock.now);
    for (let n = 1; n <= 3; n += 1) outbox.enqueue(emailRow(n));
    const { ports } = providers({ clock });
    const { counts } = await drainRun(
      outbox,
      { ...CONFIG, resendApiKey: null, missing: ['RESEND_API_KEY'] },
      null,
      ports,
      limits({ emailIntervalMs: 10_000 }),
      clock,
    );
    expect(counts).toMatchObject({ unconfigured: 3, released: 0 });
    expect(clock.t).toBe(0);
  });
});

describe('drainRun — bookkeeping failures', () => {
  it('a verdict that cannot be written is reported, and the run carries on', async () => {
    const clock = fakeClock();
    const outbox = new MemOutbox(clock.now);
    for (let n = 1; n <= 3; n += 1) outbox.enqueue(pushRow(n));
    const store: OutboxStore = {
      claim: (l) => outbox.claim(l),
      release: (ids) => outbox.release(ids),
      settle: async (s) => {
        if (s.key === 'N12:booking:2') throw new Error('connection reset');
        await outbox.settle(s);
      },
    };
    const { ports } = providers({ clock });
    const { counts, unsettled } = await drainRun(store, CONFIG, null, ports, limits(), clock);
    expect(counts.sent).toBe(3);
    expect(unsettled).toEqual(['settling N12:booking:2: connection reset']);
    expect(outbox.row('N12:booking:3').sentAt).not.toBeNull();
  });
});

describe('readRunLimits', () => {
  it('keeps the defaults when nothing is set', () => {
    expect(readRunLimits(() => undefined)).toEqual(DEFAULT_RUN_LIMITS);
  });

  it('leaves at least 30 s of the 150 s wall clock, and claims stop before sends', () => {
    expect(DEFAULT_RUN_LIMITS.sendForMs).toBeLessThanOrEqual(MAX_SEND_FOR_MS);
    expect(MAX_SEND_FOR_MS).toBeLessThanOrEqual(150_000 - 30_000);
    expect(DEFAULT_RUN_LIMITS.claimForMs).toBeLessThan(DEFAULT_RUN_LIMITS.sendForMs);
  });

  it('reads the overrides within bounds and ignores the rest', () => {
    const env: Record<string, string> = {
      NOTIFY_DRAIN_SEND_FOR_MS: '80000',
      NOTIFY_DRAIN_CONCURRENCY: '8',
      RESEND_REQUESTS_PER_SECOND: '10',
    };
    expect(readRunLimits((n) => env[n])).toMatchObject({
      sendForMs: 80_000,
      claimForMs: 75_000,
      concurrency: 8,
      emailIntervalMs: 100,
    });
    const wild: Record<string, string> = {
      NOTIFY_DRAIN_SEND_FOR_MS: '140000',
      NOTIFY_DRAIN_CONCURRENCY: '0',
      RESEND_REQUESTS_PER_SECOND: 'lots',
    };
    expect(readRunLimits((n) => wild[n])).toEqual(DEFAULT_RUN_LIMITS);
  });
});
