import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_EVENT_AGE_HOURS,
  isStaleEvent,
  verifyWilloSignature,
  willoDeliveryKey,
  willoMaxEventAgeHours,
} from '../willo';
import type { WilloSignatureConfig } from '../willo';

/**
 * Willo replays (ADR-0164, security audit L2). Willo signs nothing, so the
 * webhook's secret is a token in its address; a captured delivery could be
 * posted again. The receiver keys each delivery on its raw body (the
 * database applies a key once, pgTAP 897), refuses one whose own time is
 * too old, and checks a configured timestamp header on the token path too.
 */
const SECRET = 'whsec_test_only_not_a_real_secret_0123';
const BODY = JSON.stringify({ event: 'Stage Change', data: { stage: { name: 'Rejected' } } });
const NOW = 1_790_000_000;

function headers(map: Record<string, string>) {
  const lower = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name: string) => lower[name.toLowerCase()] ?? null };
}

describe('willoDeliveryKey', () => {
  it('is the SHA-256 of the exact body, as Node computes it', async () => {
    const expected = createHash('sha256').update(BODY).digest('hex');
    await expect(willoDeliveryKey(BODY)).resolves.toBe(`sha256:${expected}`);
  });

  it('differs for any change to the body, and is stable for the same bytes', async () => {
    const a = await willoDeliveryKey(BODY);
    expect(await willoDeliveryKey(BODY)).toBe(a);
    expect(await willoDeliveryKey(`${BODY} `)).not.toBe(a);
  });

  it('fits the database column (8–200 characters)', async () => {
    const key = await willoDeliveryKey('');
    expect(key.length).toBe(71);
  });
});

describe('isStaleEvent', () => {
  const nowMs = Date.parse('2026-10-19T12:00:00Z');

  it('refuses a delivery whose own time is older than the window', () => {
    expect(isStaleEvent('2026-10-12T11:59:00Z', nowMs, 168)).toBe(true);
    expect(isStaleEvent('2026-10-12T12:01:00Z', nowMs, 168)).toBe(false);
  });

  it('never judges a delivery that names no time, or an unreadable one', () => {
    expect(isStaleEvent(null, nowMs, 168)).toBe(false);
    expect(isStaleEvent('yesterday-ish', nowMs, 168)).toBe(false);
  });

  it('reads WILLO_MAX_EVENT_AGE_HOURS, defaulting to a week', () => {
    expect(willoMaxEventAgeHours(() => undefined)).toBe(DEFAULT_MAX_EVENT_AGE_HOURS);
    expect(DEFAULT_MAX_EVENT_AGE_HOURS).toBe(168);
    expect(willoMaxEventAgeHours((n) => (n === 'WILLO_MAX_EVENT_AGE_HOURS' ? '48' : undefined))).toBe(48);
    for (const bad of ['0', '-1', 'abc', '']) {
      expect(willoMaxEventAgeHours(() => bad)).toBe(DEFAULT_MAX_EVENT_AGE_HOURS);
    }
  });
});

describe('the token path with a timestamp header configured', () => {
  const config: WilloSignatureConfig = {
    secret: SECRET,
    signatureHeader: 'x-willo-signature',
    timestampHeader: 'x-willo-timestamp',
    toleranceSeconds: 300,
  };

  it('accepts the right token inside the window', async () => {
    await expect(
      verifyWilloSignature(BODY, headers({ 'x-willo-timestamp': String(NOW - 10) }), config, NOW, SECRET),
    ).resolves.toEqual({ ok: true });
  });

  it('refuses a replay from outside the window, right token or not', async () => {
    await expect(
      verifyWilloSignature(BODY, headers({ 'x-willo-timestamp': String(NOW - 301) }), config, NOW, SECRET),
    ).resolves.toEqual({ ok: false, reason: 'timestamp_out_of_window' });
  });

  it('refuses a missing timestamp', async () => {
    await expect(verifyWilloSignature(BODY, headers({}), config, NOW, SECRET)).resolves.toEqual({
      ok: false,
      reason: 'timestamp_missing',
    });
  });

  it('with no timestamp header configured, the token alone still decides (ADR-0066)', async () => {
    await expect(
      verifyWilloSignature(BODY, headers({}), { ...config, timestampHeader: null }, NOW, SECRET),
    ).resolves.toEqual({ ok: true });
  });
});
