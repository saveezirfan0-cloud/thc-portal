import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_API_BASE,
  eventTime,
  isPermanentRefusal,
  parseTimestamp,
  parseWilloEvent,
  readInviteAnswer,
  signatureCandidates,
  stageMapKey,
  timingSafeEqual,
  verifyWilloSignature,
  willoApiConfig,
  willoInviteRequest,
  willoSignatureConfig,
} from '../willo';
import type { WilloSignatureConfig } from '../willo';

/**
 * The pure half of the Willo integration (§2.4, ADR-0021). The signature
 * is checked against Node's own HMAC, so the Web Crypto path the Edge
 * Function runs is held to an independent implementation.
 */
const SECRET = 'whsec_test_only_not_a_real_secret';
const BODY = JSON.stringify({
  event: 'Stage Change',
  id: 'evt_1',
  created_at: '2026-09-23T10:00:00Z',
  data: { candidate: { key: 'W-abc' }, stage: { name: 'Accepted' } },
});

function hex(message: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(message).digest('hex');
}
function b64(message: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(message).digest('base64');
}

function headers(map: Record<string, string>) {
  const lower = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name: string) => lower[name.toLowerCase()] ?? null };
}

const BASE: WilloSignatureConfig = {
  secret: SECRET,
  signatureHeader: 'x-willo-signature',
  timestampHeader: null,
  toleranceSeconds: 300,
};
const NOW = 1_790_000_000;

describe('the signature', () => {
  it('accepts an HMAC-SHA256 of the raw body, hex or base64, with or without sha256=', async () => {
    for (const value of [hex(BODY), `sha256=${hex(BODY)}`, b64(BODY), `sha256=${b64(BODY)}`]) {
      await expect(
        verifyWilloSignature(BODY, headers({ 'X-Willo-Signature': value }), BASE, NOW),
      ).resolves.toEqual({ ok: true });
    }
  });

  it('refuses a body changed by a single byte — the raw bytes are what is signed', async () => {
    const verdict = await verifyWilloSignature(
      BODY.replace('Accepted', 'Accepteq'),
      headers({ 'x-willo-signature': hex(BODY) }),
      BASE,
      NOW,
    );
    expect(verdict).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('refuses the right body signed with another secret', async () => {
    const verdict = await verifyWilloSignature(
      BODY,
      headers({ 'x-willo-signature': hex(BODY, 'another') }),
      BASE,
      NOW,
    );
    expect(verdict).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('never accepts anything when the secret is not configured', async () => {
    const verdict = await verifyWilloSignature(
      BODY,
      headers({ 'x-willo-signature': hex(BODY, '') }),
      { ...BASE, secret: null },
      NOW,
    );
    expect(verdict).toEqual({ ok: false, reason: 'secret_missing' });
  });

  it('a missing or malformed header is refused, not compared', async () => {
    await expect(verifyWilloSignature(BODY, headers({}), BASE, NOW)).resolves.toEqual({
      ok: false,
      reason: 'signature_missing',
    });
    await expect(
      verifyWilloSignature(BODY, headers({ 'x-willo-signature': 'abc' }), BASE, NOW),
    ).resolves.toEqual({ ok: false, reason: 'signature_malformed' });
    // A truncated digest is malformed, never "a prefix that matched".
    await expect(
      verifyWilloSignature(
        BODY,
        headers({ 'x-willo-signature': hex(BODY).slice(0, 62) }),
        BASE,
        NOW,
      ),
    ).resolves.toEqual({ ok: false, reason: 'signature_malformed' });
  });

  it('several digests may be offered (secret rotation); one match is enough', async () => {
    const value = `${hex(BODY, 'old-secret')}, ${hex(BODY)}`;
    await expect(
      verifyWilloSignature(BODY, headers({ 'x-willo-signature': value }), BASE, NOW),
    ).resolves.toEqual({ ok: true });
  });

  it('the header name is configuration', async () => {
    const config = { ...BASE, signatureHeader: 'x-signature' };
    await expect(
      verifyWilloSignature(BODY, headers({ 'X-Signature': hex(BODY) }), config, NOW),
    ).resolves.toEqual({ ok: true });
    await expect(
      verifyWilloSignature(BODY, headers({ 'x-willo-signature': hex(BODY) }), config, NOW),
    ).resolves.toEqual({ ok: false, reason: 'signature_missing' });
  });

  describe('with a timestamp header configured', () => {
    const config = { ...BASE, timestampHeader: 'x-willo-timestamp' };
    const stamp = String(NOW - 60);

    it('signs `{timestamp}.{body}` and accepts inside the window', async () => {
      const verdict = await verifyWilloSignature(
        BODY,
        headers({ 'x-willo-timestamp': stamp, 'x-willo-signature': hex(`${stamp}.${BODY}`) }),
        config,
        NOW,
      );
      expect(verdict).toEqual({ ok: true });
    });

    it('refuses a replay from outside the window, however well signed', async () => {
      const old = String(NOW - 301);
      const verdict = await verifyWilloSignature(
        BODY,
        headers({ 'x-willo-timestamp': old, 'x-willo-signature': hex(`${old}.${BODY}`) }),
        config,
        NOW,
      );
      expect(verdict).toEqual({ ok: false, reason: 'timestamp_out_of_window' });
    });

    it('refuses a missing timestamp, and a body-only signature', async () => {
      await expect(
        verifyWilloSignature(BODY, headers({ 'x-willo-signature': hex(BODY) }), config, NOW),
      ).resolves.toEqual({ ok: false, reason: 'timestamp_missing' });
      await expect(
        verifyWilloSignature(
          BODY,
          headers({ 'x-willo-timestamp': stamp, 'x-willo-signature': hex(BODY) }),
          config,
          NOW,
        ),
      ).resolves.toEqual({ ok: false, reason: 'signature_mismatch' });
    });

    it('reads seconds, milliseconds and ISO 8601', () => {
      expect(parseTimestamp('1790000000')).toBe(1_790_000_000);
      expect(parseTimestamp('1790000000123')).toBe(1_790_000_000);
      expect(parseTimestamp('2026-09-23T10:00:00Z')).toBe(
        Date.parse('2026-09-23T10:00:00Z') / 1000,
      );
      expect(parseTimestamp('yesterday')).toBeNull();
    });
  });

  it('compares in constant time over equal lengths, and refuses unequal ones', () => {
    const a = new Uint8Array([1, 2, 3]);
    expect(timingSafeEqual(a, new Uint8Array([1, 2, 3]))).toBe(true);
    expect(timingSafeEqual(a, new Uint8Array([1, 2, 4]))).toBe(false);
    expect(timingSafeEqual(a, new Uint8Array([1, 2]))).toBe(false);
  });

  it('only 32-byte digests are candidates', () => {
    expect(signatureCandidates(`v1=${hex(BODY)}`)).toHaveLength(1);
    expect(signatureCandidates('deadbeef')).toBeNull();
  });

  it('reads its configuration from the environment, with defaults', () => {
    const env = (values: Record<string, string>) => (name: string) => values[name];
    expect(willoSignatureConfig(env({ WILLO_WEBHOOK_SECRET: ' s ' }))).toEqual({
      secret: 's',
      signatureHeader: 'x-willo-signature',
      timestampHeader: null,
      toleranceSeconds: 300,
    });
    expect(
      willoSignatureConfig(
        env({
          WILLO_WEBHOOK_SECRET: 's',
          WILLO_SIGNATURE_HEADER: 'X-Sig',
          WILLO_TIMESTAMP_HEADER: 'X-Ts',
          WILLO_TIMESTAMP_TOLERANCE_SECONDS: '60',
        }),
      ),
    ).toEqual({
      secret: 's',
      signatureHeader: 'x-sig',
      timestampHeader: 'x-ts',
      toleranceSeconds: 60,
    });
    expect(willoSignatureConfig(env({})).secret).toBeNull();
  });
});

describe('the payload → a settings.willo_stage_map key', () => {
  it('a stage change becomes the stage (Accepted → accepted)', () => {
    const out = parseWilloEvent(BODY);
    expect(out).toEqual({
      ok: true,
      event: {
        deliveryId: 'evt_1',
        willoCandidateId: 'W-abc',
        eventKey: 'accepted',
        rawType: 'Stage Change',
        stage: 'Accepted',
        occurredAt: '2026-09-23T10:00:00.000Z',
        details: {},
      },
    });
  });

  it('any other event becomes its own name (New Response → new_response)', () => {
    const out = parseWilloEvent(
      JSON.stringify({
        type: 'New Response',
        candidate_key: 'W-1',
        answers_done: 5,
        answers_total: 5,
      }),
    );
    expect(out).toMatchObject({
      ok: true,
      event: {
        eventKey: 'new_response',
        willoCandidateId: 'W-1',
        details: { answersDone: 5, answersTotal: 5 },
      },
    });
  });

  it('a stage THC has not mapped still parses — the map decides it changes nothing', () => {
    const out = parseWilloEvent(
      JSON.stringify({ event: 'stage_changed', candidate: { id: 42 }, stage: 'On hold' }),
    );
    expect(out).toMatchObject({ ok: true, event: { eventKey: 'on_hold', willoCandidateId: '42' } });
  });

  it('progress is tracking only', () => {
    const out = parseWilloEvent(
      JSON.stringify({
        event: 'progress',
        data: { candidate_key: 'W-2', progress: { answered: 2, total: 5 } },
      }),
    );
    expect(out).toMatchObject({
      ok: true,
      event: { eventKey: 'progress', details: { answersDone: 2, answersTotal: 5 } },
    });
  });

  it('refuses what cannot be applied', () => {
    expect(parseWilloEvent('not json')).toEqual({ ok: false, reason: 'not_json' });
    expect(parseWilloEvent('[1,2]')).toEqual({ ok: false, reason: 'not_json' });
    expect(parseWilloEvent('{"candidate_key":"W"}')).toEqual({
      ok: false,
      reason: 'no_event_type',
    });
    expect(parseWilloEvent('{"event":"new_response"}')).toEqual({
      ok: false,
      reason: 'no_candidate',
    });
    expect(parseWilloEvent('{"event":"stage_change","candidate_key":"W"}')).toEqual({
      ok: false,
      reason: 'no_stage',
    });
  });

  it('normalises like the /settings map keys', () => {
    expect(stageMapKey('  Stage Change ')).toBe('stage_change');
    expect(stageMapKey('Rejected!')).toBe('rejected');
    expect(stageMapKey('Interview — completed')).toBe('interview_completed');
  });

  it('records Willo’s time unless it is missing or in the future', () => {
    const now = Date.parse('2026-09-23T12:00:00Z');
    expect(eventTime('2026-09-23T10:00:00.000Z', now)).toBe('2026-09-23T10:00:00.000Z');
    expect(eventTime(null, now)).toBe('2026-09-23T12:00:00.000Z');
    expect(eventTime('2026-09-24T10:00:00.000Z', now)).toBe('2026-09-23T12:00:00.000Z');
  });
});

describe('database refusals', () => {
  it('stops Willo retrying only what no retry can change', () => {
    expect(isPermanentRefusal('unknown_willo_candidate')).toBe(true);
    expect(isPermanentRefusal('account_email_mismatch')).toBe(true);
    expect(isPermanentRefusal('unsupported_willo_mapping: accepted -> quiz')).toBe(true);
    expect(isPermanentRefusal('canceling statement due to lock timeout')).toBe(false);
    expect(isPermanentRefusal('activation_link_required')).toBe(false);
  });
});

describe('create candidate in Willo', () => {
  const env = (values: Record<string, string>) => (name: string) => values[name];

  it('does nothing without both keys', () => {
    expect(willoApiConfig(env({}))).toBeNull();
    expect(willoApiConfig(env({ WILLO_API_KEY: 'k' }))).toBeNull();
  });

  it('builds the request from configuration, key in a header, never in the URL', () => {
    const config = willoApiConfig(env({ WILLO_API_KEY: 'key-1', WILLO_INTERVIEW_KEY: 'int 1' }))!;
    expect(config.apiBase).toBe(DEFAULT_API_BASE);
    const spec = willoInviteRequest(config, {
      staffId: 's-1',
      firstName: 'Mei',
      lastName: 'Lin',
      email: 'mei@example.com',
      phone: '+447700900001',
    });
    expect(spec.url).toBe(`${DEFAULT_API_BASE}/interviews/int%201/candidates/`);
    expect(spec.url).not.toContain('key-1');
    expect(spec.headers['Authorization']).toBe('Bearer key-1');
    expect(JSON.parse(spec.body)).toEqual({
      first_name: 'Mei',
      last_name: 'Lin',
      email: 'mei@example.com',
      phone_number: '+447700900001',
      external_id: 's-1',
      send_invite: true,
    });
  });

  it('the auth header and prefix are configuration (an empty prefix is allowed)', () => {
    const config = willoApiConfig(
      env({
        WILLO_API_KEY: 'k',
        WILLO_INTERVIEW_KEY: 'i',
        WILLO_API_AUTH_HEADER: 'X-Api-Key',
        WILLO_API_AUTH_PREFIX: '',
        WILLO_API_BASE: 'https://willo.example/api/',
        WILLO_INVITE_PATH: 'interviews/{interviewKey}/invite',
      }),
    )!;
    const spec = willoInviteRequest(config, {
      staffId: 's',
      firstName: 'a',
      lastName: 'b',
      email: 'c@d.e',
      phone: null,
    });
    expect(spec.url).toBe('https://willo.example/api/interviews/i/invite');
    expect(spec.headers['X-Api-Key']).toBe('k');
  });

  it('reads the candidate key from the answer, or fails', () => {
    expect(readInviteAnswer(201, '{"key":"W-9"}')).toEqual({ ok: true, willoCandidateId: 'W-9' });
    expect(readInviteAnswer(200, '{"data":{"candidate":{"key":"W-8"}}}')).toEqual({
      ok: true,
      willoCandidateId: 'W-8',
    });
    expect(readInviteAnswer(200, '{}')).toMatchObject({
      ok: false,
      reason: 'response_without_candidate_key',
    });
    expect(readInviteAnswer(503, 'down')).toMatchObject({ ok: false, retry: true });
    expect(readInviteAnswer(401, 'nope')).toMatchObject({ ok: false, retry: false });
  });
});
