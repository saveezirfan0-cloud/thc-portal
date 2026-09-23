import { createECDH } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { DrainConfig, DrainPorts } from '../drain';
import { NOT_CONFIGURED, drainBatch, drainRow, readDrainConfig, retryDecision } from '../drain';
import type { OutboxRow } from '../outbox';
import { outboxBackoffMs } from '../outbox';
import { RESEND_ENDPOINT, buildResendRequest, classifyResendStatus, toBase64 } from '../resend';
import { DEFAULT_SENDER_ADDRESSES, resolveSender } from '../senders';
import { b64urlEncode } from '../webpush';
import { decrypt } from './decrypt-push';

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function keypair() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { pub: b64urlEncode(ecdh.getPublicKey()), priv: b64urlEncode(ecdh.getPrivateKey()) };
}

const vapidKeys = keypair();
const CONFIGURED: DrainConfig = {
  resendApiKey: 're_test_key',
  vapid: {
    publicKey: vapidKeys.pub,
    privateKey: vapidKeys.priv,
    subject: 'mailto:admin@thehospitalitycompany.co.uk',
  },
  missing: [],
};
const NOTHING: DrainConfig = {
  resendApiKey: null,
  vapid: null,
  missing: ['RESEND_API_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'],
};

/** A browser: one fixed ECDH pair per device number, so a test can read what it was sent. */
const browsers = new Map<number, ReturnType<typeof createECDH>>();
function device(n: number) {
  if (!browsers.has(n)) {
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    browsers.set(n, ecdh);
  }
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`,
    p256dh: b64urlEncode(browsers.get(n)!.getPublicKey()),
    auth: b64urlEncode(new Uint8Array(16).fill(n)),
  };
}

function readOn(n: number, body: string | Uint8Array): unknown {
  const ecdh = browsers.get(n)!;
  return JSON.parse(
    decrypt(
      body as Uint8Array,
      ecdh.getPrivateKey(),
      ecdh.getPublicKey(),
      Buffer.from(new Uint8Array(16).fill(n)),
    ),
  );
}

const push = (over: Partial<OutboxRow> = {}): OutboxRow => ({
  id: 1,
  key: 'N12:booking:1',
  channel: 'push',
  template: 'N12',
  recipient_staff_id: 'staff-1',
  recipient_emails: null,
  payload: {},
  attempts: 1,
  ...over,
});

const email = (over: Partial<OutboxRow> = {}): OutboxRow => ({
  id: 2,
  key: 'E2:staff:1',
  channel: 'email',
  template: 'E2',
  recipient_staff_id: null,
  recipient_emails: ['candidate@example.com'],
  payload: {},
  attempts: 1,
  ...over,
});

const d1 = (over: Partial<OutboxRow> = {}): OutboxRow => ({
  id: 3,
  key: 'D1:document:abc',
  channel: 'email',
  template: 'D1',
  recipient_staff_id: null,
  recipient_emails: ['events@client.example'],
  payload: {
    event: 'Product Launch',
    date: '26/09/2026',
    staffCount: '12',
    poSuffix: '',
    attachments: JSON.stringify([
      { bucket: 'timesheets', path: 'allocation/abc.pdf', filename: 'Allocation.pdf' },
    ]) as unknown as string,
  },
  attempts: 1,
  ...over,
});

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: string | Uint8Array;
}

function ports(opts: {
  statuses?: Record<string, number>;
  resendStatus?: number;
  resendBody?: string;
  subscriptions?: ReturnType<typeof device>[];
  files?: Record<string, Uint8Array | null | Error>;
  networkError?: boolean;
}) {
  const sent: Sent[] = [];
  const deleted: string[] = [];
  const logs: string[] = [];
  const p: DrainPorts = {
    http: vi.fn(async (req) => {
      if (opts.networkError) throw new Error('connection reset');
      sent.push({ url: req.url, headers: req.headers, body: req.body });
      if (req.url === RESEND_ENDPOINT) {
        return {
          status: opts.resendStatus ?? 200,
          text: async () => opts.resendBody ?? '{"id":"x"}',
        };
      }
      return { status: opts.statuses?.[req.url] ?? 201, text: async () => '' };
    }),
    subscriptionsFor: vi.fn(async () => opts.subscriptions ?? []),
    deleteSubscription: vi.fn(async (endpoint: string) => {
      deleted.push(endpoint);
    }),
    download: vi.fn(async (bucket: string, path: string) => {
      const f = opts.files?.[`${bucket}/${path}`];
      if (f instanceof Error) throw f;
      return f === undefined ? null : f;
    }),
    log: (m: string) => {
      logs.push(m);
    },
  };
  return { p, sent, deleted, logs };
}

// ---------------------------------------------------------------------------
// configuration
// ---------------------------------------------------------------------------

describe('reading the secrets', () => {
  it('names every missing secret and never throws', () => {
    const c = readDrainConfig(() => undefined);
    expect(c.resendApiKey).toBeNull();
    expect(c.vapid).toBeNull();
    expect(c.missing).toEqual([
      'RESEND_API_KEY',
      'VAPID_PUBLIC_KEY',
      'VAPID_PRIVATE_KEY',
      'VAPID_SUBJECT',
    ]);
  });

  it('treats a blank secret as missing', () => {
    const c = readDrainConfig((n) => (n === 'RESEND_API_KEY' ? '  ' : undefined));
    expect(c.resendApiKey).toBeNull();
  });

  it('needs all three VAPID values before push counts as configured', () => {
    const env: Record<string, string> = { VAPID_PUBLIC_KEY: 'a', VAPID_PRIVATE_KEY: 'b' };
    expect(readDrainConfig((n) => env[n]).vapid).toBeNull();
    env.VAPID_SUBJECT = 'mailto:x@y.z';
    expect(readDrainConfig((n) => env[n]).vapid).toEqual({
      publicKey: 'a',
      privateKey: 'b',
      subject: 'mailto:x@y.z',
    });
  });
});

describe('with no keys at all', () => {
  it('holds a push as not configured, without an attempt, and logs it once for the batch', async () => {
    const { p, logs } = ports({});
    const { settlements, counts } = await drainBatch(
      [push(), push({ id: 9, key: 'N12:booking:9' }), email()],
      NOTHING,
      null,
      p,
    );
    expect(settlements.map((s) => s.verdict)).toEqual([
      'unconfigured',
      'unconfigured',
      'unconfigured',
    ]);
    expect(settlements[0]).toMatchObject({ error: NOT_CONFIGURED.push });
    expect(settlements[2]).toMatchObject({ error: NOT_CONFIGURED.email });
    expect(counts.unconfigured).toBe(3);
    expect(logs.filter((l) => l.includes('not configured'))).toHaveLength(1);
    expect(p.http).not.toHaveBeenCalled();
  });

  it('still fails a row that can never be sent, rather than holding it forever', async () => {
    const { p } = ports({});
    const s = await drainRow(push({ template: 'N99' }), NOTHING, null, p);
    expect(s.verdict).toBe('failed');
    const e1 = await drainRow(email({ template: 'E1' }), NOTHING, null, p);
    expect(e1.verdict).toBe('failed');
  });

  it('holds only the unconfigured channel when the other has its keys', async () => {
    const { p } = ports({ subscriptions: [device(1)] });
    const pushOnly: DrainConfig = {
      ...CONFIGURED,
      resendApiKey: null,
      missing: ['RESEND_API_KEY'],
    };
    const { settlements } = await drainBatch([push(), email()], pushOnly, null, p);
    expect(settlements.map((s) => s.verdict)).toEqual(['sent', 'unconfigured']);
  });

  it('logs nothing when there is nothing to drain', async () => {
    const { p, logs } = ports({});
    await drainBatch([], NOTHING, null, p);
    expect(logs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// push
// ---------------------------------------------------------------------------

describe('push', () => {
  it('goes to every device the worker has, carrying title, body and deep link', async () => {
    const { p, sent } = ports({ subscriptions: [device(1), device(2)] });
    const s = await drainRow(
      push({ template: 'N9b', payload: { event: 'Product Launch', bookingId: '41' } }),
      CONFIGURED,
      null,
      p,
    );
    expect(s).toMatchObject({ verdict: 'sent', detail: '2/2 devices' });
    expect(sent.map((r) => r.url)).toEqual([device(1).endpoint, device(2).endpoint]);
    // What apps/staff/sw.ts will read, decrypted on each device.
    const expected = {
      title: "You haven't checked out",
      body: "You haven't checked out of Product Launch yet — tap to check out.",
      url: '/shifts/41',
    };
    expect(readOn(1, sent[0]!.body)).toEqual(expected);
    expect(readOn(2, sent[1]!.body)).toEqual(expected);
    expect(sent[0]!.headers['Content-Encoding']).toBe('aes128gcm');
    expect(p.subscriptionsFor).toHaveBeenCalledWith('staff-1');
  });

  it('deletes a subscription the push service says is gone, and still counts the live one', async () => {
    const { p, deleted } = ports({
      subscriptions: [device(1), device(2)],
      statuses: { [device(1).endpoint]: 410 },
    });
    const s = await drainRow(push(), CONFIGURED, null, p);
    expect(deleted).toEqual([device(1).endpoint]);
    expect(s).toMatchObject({ verdict: 'sent', detail: '1/2 devices, 1 pruned' });
  });

  it('prunes on 404 as well as 410', async () => {
    const { p, deleted } = ports({
      subscriptions: [device(3)],
      statuses: { [device(3).endpoint]: 404 },
    });
    const s = await drainRow(push(), CONFIGURED, null, p);
    expect(deleted).toEqual([device(3).endpoint]);
    expect(s.verdict).toBe('retry');
  });

  it('does not delete a subscription on a transient failure', async () => {
    const { p, deleted } = ports({
      subscriptions: [device(1)],
      statuses: { [device(1).endpoint]: 503 },
    });
    const s = await drainRow(push(), CONFIGURED, null, p);
    expect(deleted).toEqual([]);
    expect(s).toMatchObject({ verdict: 'retry', final: false, nextInMs: 60_000 });
  });

  it('retries a worker with no device yet, rather than failing them outright', async () => {
    const { p } = ports({ subscriptions: [] });
    const s = await drainRow(push(), CONFIGURED, null, p);
    expect(s.verdict).toBe('retry');
    expect(s.verdict === 'retry' && s.error).toMatch(/no push subscription/);
  });

  it('never puts an endpoint in an error — it is a credential for the device', async () => {
    const { p } = ports({ subscriptions: [device(1)], networkError: true });
    const s = await drainRow(push(), CONFIGURED, null, p);
    expect(s.verdict).toBe('retry');
    expect(JSON.stringify(s)).not.toContain('device-1');
  });

  it('fails N9 without its half as a fault in the row', async () => {
    const { p } = ports({ subscriptions: [device(1)] });
    const s = await drainRow(push({ template: 'N9' }), CONFIGURED, null, p);
    expect(s).toMatchObject({ verdict: 'failed' });
    expect(p.http).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// email
// ---------------------------------------------------------------------------

describe('email', () => {
  it('sends from the address the senders setting names, with replies to it', async () => {
    const { p, sent } = ports({});
    const s = await drainRow(
      email(),
      CONFIGURED,
      { admin: 'office@thc.example', timesheets: 'ts@thc.example' },
      p,
    );
    expect(s).toMatchObject({ verdict: 'sent', detail: 'office@thc.example' });
    const body = JSON.parse(sent[0]!.body as string);
    expect(body.from).toBe('The Hospitality Company <office@thc.example>');
    expect(body.reply_to).toBe('office@thc.example');
    expect(body.to).toEqual(['candidate@example.com']);
    expect(sent[0]!.headers.Authorization).toBe('Bearer re_test_key');
    expect(sent[0]!.headers['Idempotency-Key']).toBe('E2:staff:1');
  });

  it('falls back to the seeded address, and says so, when the setting is unusable', async () => {
    const { p, sent, logs } = ports({});
    await drainRow(email(), CONFIGURED, { admin: 'noreply@thc.example' }, p);
    expect(JSON.parse(sent[0]!.body as string).from).toBe(
      `The Hospitality Company <${DEFAULT_SENDER_ADDRESSES.admin}>`,
    );
    expect(logs.join('\n')).toMatch(/no-reply/);
  });

  it('sends the office emails to the §8 addresses whatever the row says', async () => {
    const { p, sent } = ports({});
    await drainRow(
      email({
        template: 'E8',
        key: 'E8:staff:1',
        recipient_emails: ['x@y.z'],
        payload: { name: 'A', employeeId: '7' },
      }),
      CONFIGURED,
      null,
      p,
    );
    expect(JSON.parse(sent[0]!.body as string).to).toEqual(['admin@thehospitalitycompany.co.uk']);
  });

  it('attaches D1’s file from Storage and sends from timesheets@', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.7 fake');
    const { p, sent } = ports({ files: { 'timesheets/allocation/abc.pdf': pdf } });
    const s = await drainRow(
      d1(),
      CONFIGURED,
      { admin: 'admin@thc.example', timesheets: 'timesheets@thc.example' },
      p,
    );
    expect(s.verdict).toBe('sent');
    const body = JSON.parse(sent[0]!.body as string);
    expect(body.from).toBe('The Hospitality Company <timesheets@thc.example>');
    expect(body.attachments).toEqual([{ filename: 'Allocation.pdf', content: toBase64(pdf) }]);
    expect(p.download).toHaveBeenCalledWith('timesheets', 'allocation/abc.pdf');
  });

  it('fails a document email whose file is gone, rather than retrying it six times', async () => {
    const { p } = ports({ files: {} });
    const s = await drainRow(d1(), CONFIGURED, null, p);
    expect(s).toMatchObject({ verdict: 'failed' });
    expect(p.http).not.toHaveBeenCalled();
  });

  it('retries when Storage itself fails', async () => {
    const { p } = ports({ files: { 'timesheets/allocation/abc.pdf': new Error('503') } });
    const s = await drainRow(d1(), CONFIGURED, null, p);
    expect(s.verdict).toBe('retry');
  });

  it('fails permanently on a 422 and retries a 429 or a 500', async () => {
    const bad = await drainRow(
      email(),
      CONFIGURED,
      null,
      ports({ resendStatus: 422, resendBody: '{"message":"Invalid `to` field"}' }).p,
    );
    expect(bad).toMatchObject({ verdict: 'failed' });
    expect(bad.verdict === 'failed' && bad.error).toMatch(/422: .*Invalid/);
    expect(
      (await drainRow(email(), CONFIGURED, null, ports({ resendStatus: 429 }).p)).verdict,
    ).toBe('retry');
    expect(
      (await drainRow(email(), CONFIGURED, null, ports({ resendStatus: 500 }).p)).verdict,
    ).toBe('retry');
  });

  it('retries when Resend cannot be reached', async () => {
    const s = await drainRow(email(), CONFIGURED, null, ports({ networkError: true }).p);
    expect(s).toMatchObject({ verdict: 'retry' });
  });
});

// ---------------------------------------------------------------------------
// retry arithmetic — the same curve as complete_outbox_send
// ---------------------------------------------------------------------------

describe('retry or final', () => {
  it.each([1, 2, 3, 4, 5])('attempt %i is re-armed after the shared backoff', (n) => {
    expect(retryDecision(n)).toEqual({ final: false, nextInMs: outboxBackoffMs(n) });
  });

  it('attempt 6 is the last: the database fails it', () => {
    expect(retryDecision(6)).toEqual({ final: true, nextInMs: null });
  });

  it('a retry on the last attempt says so', async () => {
    const s = await drainRow(
      push({ attempts: 6 }),
      CONFIGURED,
      null,
      ports({ subscriptions: [] }).p,
    );
    expect(s).toMatchObject({ verdict: 'retry', final: true, nextInMs: null });
  });
});

// ---------------------------------------------------------------------------
// senders and Resend in isolation
// ---------------------------------------------------------------------------

describe('resolveSender', () => {
  it('uses the setting, lower-cased and trimmed', () => {
    expect(resolveSender('timesheets', { timesheets: ' TS@THC.example ' })).toMatchObject({
      address: 'ts@thc.example',
      source: 'settings',
    });
  });

  it.each([
    [null, /not set/],
    ['a string', /not an object/],
    [{ admin: '' }, /not set/],
    [{ admin: 'not-an-email' }, /not an email/],
    [{ admin: 'no-reply@thc.example' }, /no-reply/],
  ])('falls back to the seeded address for %j', (setting, why) => {
    const r = resolveSender('admin', setting);
    expect(r.address).toBe('admin@thehospitalitycompany.co.uk');
    expect(r.source).toBe('default');
    expect(r.warning).toMatch(why);
  });
});

describe('Resend', () => {
  it('builds a request with the outbox key as the idempotency key', () => {
    const r = buildResendRequest(
      { from: 'A <a@b.c>', to: ['x@y.z'], subject: 's', text: 't' },
      'key',
      'N1:doc:1:30d',
    );
    expect(r.headers['Idempotency-Key']).toBe('N1:doc:1:30d');
    expect(JSON.parse(r.body)).toEqual({
      from: 'A <a@b.c>',
      to: ['x@y.z'],
      subject: 's',
      text: 't',
    });
  });

  it.each([
    [200, 'sent'],
    [400, 'permanent'],
    [409, 'permanent'],
    [422, 'permanent'],
    [401, 'retry'],
    [403, 'retry'],
    [429, 'retry'],
    [500, 'retry'],
  ] as const)('%i is %s', (status, verdict) => {
    expect(classifyResendStatus(status)).toBe(verdict);
  });

  it('base64-encodes bytes without Buffer', () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 256);
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });
});
