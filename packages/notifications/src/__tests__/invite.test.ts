import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { DrainConfig, DrainPorts } from '../drain';
import { drainRow } from '../drain';
import type { OutboxRow } from '../outbox';
import { messageFor } from '../outbox';
import { RESEND_ENDPOINT } from '../resend';
import { EXTENSION_CODES, SCOPE_CODES, body, outboxKey, render, template } from '../templates';

/**
 * E11 — the account invitation (ADR-0052): a Back Office or Client Portal
 * login's one-time set-up link, emailed rather than only shown on /users.
 */

/**
 * The keys queue_account_invite() writes (20260930210200). The same list is
 * asserted on the SQL side by supabase/tests/652_account_invite_email.sql, so
 * a key renamed on either side fails one of the two suites.
 */
const INVITE_PAYLOAD_KEYS = ['app', 'name', 'link'];

const USER = '65200000-0000-4000-8000-000000000001';
const LINK =
  'https://office.thehospitalitycompany.co.uk/auth/invite?token=0123456789abcdef0123456789abcdef0123456789abcdef01234567';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);

const row = (over: Partial<OutboxRow> = {}): OutboxRow => ({
  id: 11,
  key: `E11:invite:${USER}:1`,
  channel: 'email',
  template: 'E11',
  recipient_staff_id: null,
  recipient_emails: ['nadia@client.example'],
  payload: { app: 'Back Office', name: 'Nadia', link: LINK },
  attempts: 1,
  ...over,
});

const CONFIGURED: DrainConfig = { resendApiKey: 're_test_key', vapid: null, missing: [] };

function ports() {
  const sent: { url: string; headers: Record<string, string>; body: string }[] = [];
  const p: DrainPorts = {
    http: vi.fn(async (req) => {
      sent.push({ url: req.url, headers: req.headers, body: req.body as string });
      return { status: 200, text: async () => '{"id":"x"}' };
    }),
    subscriptionsFor: vi.fn(async () => []),
    deleteSubscription: vi.fn(async () => {}),
    download: vi.fn(async () => null),
    log: () => {},
  };
  return { p, sent };
}

describe('E11 — the account invitation (ADR-0052)', () => {
  it('is an extension that says why it exists, not a §8 code', () => {
    expect(EXTENSION_CODES as readonly string[]).toContain('E11');
    expect(SCOPE_CODES as readonly string[]).not.toContain('E11');
    expect(template('E11').trigger).toMatch(/Not in §8/);
    expect(template('E11').trigger).toContain('ADR-0052');
    expect(template('E11').mandatory).toBeUndefined();
  });

  it('is an email from the admin sender (§9.12), to the address on the row, with no deep link', () => {
    const entry = template('E11');
    expect(entry.channel).toBe('email');
    expect(entry.sender).toBe('admin');
    // The person's own address is on the row; the register pins none.
    expect(entry.recipients).toBeUndefined();
    expect(entry.deepLink).toBeUndefined();
  });

  it('names the app in the subject', () => {
    expect(render(template('E11').title, { app: 'Back Office' })).toBe(
      'Your THC Back Office login',
    );
    expect(render(template('E11').title, { app: 'Client Portal' })).toBe(
      'Your THC Client Portal login',
    );
  });

  it('carries the link, that it works once and expires after 24 hours, and what to do then', () => {
    const copy = body('E11');
    expect(placeholders(copy)).toContain('link');
    expect(copy).toContain('works once');
    expect(copy).toContain('expires after 24 hours');
    expect(copy).toContain(
      'If it has expired, reply to this email and we will send you a new one.',
    );
  });

  it('says 24 hours because GoTrue’s otp_expiry is 24 hours', () => {
    const config = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../../../supabase/config.toml'),
      'utf8',
    );
    const seconds = Number(/^\s*otp_expiry\s*=\s*(\d+)/m.exec(config)?.[1]);
    expect(seconds / 3600, 'change E11’s copy with otp_expiry').toBe(24);
  });

  it('asks only for values the database writes', () => {
    const asked = new Set([...placeholders(template('E11').title), ...placeholders(body('E11'))]);
    expect([...asked].sort()).toEqual([...INVITE_PAYLOAD_KEYS].sort());
  });

  it('keys each issued link apart: E11:invite:<user>:<sequence>', () => {
    expect(outboxKey('E11', 'invite', USER, '2')).toBe(`E11:invite:${USER}:2`);
    expect(outboxKey('E11', 'invite', USER, '1')).not.toBe(outboxKey('E11', 'invite', USER, '2'));
  });

  it('renders with no placeholder left', () => {
    const message = messageFor(row());
    expect(message).toMatchObject({
      kind: 'email',
      sender: 'admin',
      to: ['nadia@client.example'],
      subject: 'Your THC Back Office login',
    });
    if (message.kind !== 'email') throw new Error('not an email');
    expect(message.body).toContain(`Set your password to sign in: ${LINK}`);
    expect(message.body.startsWith('Hello Nadia,')).toBe(true);
    expect(message.body).not.toMatch(/[{}]/);
  });

  it('is sent by the drain to the person, from admin@, with the outbox key as the idempotency key', async () => {
    const { p, sent } = ports();
    const s = await drainRow(row(), CONFIGURED, { admin: 'admin@thc.example' }, p);
    expect(s).toMatchObject({ verdict: 'sent', detail: 'admin@thc.example' });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(RESEND_ENDPOINT);
    // Resend drops a second request with the same key: one row, one delivery,
    // even if a lease runs out mid-send and another run claims the row.
    expect(sent[0]!.headers['Idempotency-Key']).toBe(`E11:invite:${USER}:1`);
    const payload = JSON.parse(sent[0]!.body);
    expect(payload.to).toEqual(['nadia@client.example']);
    expect(payload.from).toBe('The Hospitality Company <admin@thc.example>');
    expect(payload.reply_to).toBe('admin@thc.example');
    expect(payload.text).toContain(LINK);
  });

  it('fails a row with no address at once, rather than retrying it', async () => {
    const { p, sent } = ports();
    const s = await drainRow(row({ recipient_emails: null }), CONFIGURED, null, p);
    expect(s).toMatchObject({ verdict: 'failed' });
    expect(sent).toHaveLength(0);
  });
});
