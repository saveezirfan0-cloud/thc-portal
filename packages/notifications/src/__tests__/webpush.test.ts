import { createECDH, createPublicKey, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MAX_PUSH_PLAINTEXT,
  audienceOf,
  b64urlDecode,
  b64urlEncode,
  buildPushRequest,
  classifyPushStatus,
  encryptPayload,
  vapidAuthorization,
} from '../webpush';
import { decrypt } from './decrypt-push';

function browser() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = Buffer.from(crypto.getRandomValues(new Uint8Array(16)));
  return {
    privateKey: ecdh.getPrivateKey(),
    publicKey: ecdh.getPublicKey(),
    subscription: {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
      p256dh: b64urlEncode(ecdh.getPublicKey()),
      auth: b64urlEncode(auth),
    },
    auth,
  };
}

function vapidPair() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    publicKey: b64urlEncode(ecdh.getPublicKey()),
    privateKey: b64urlEncode(ecdh.getPrivateKey()),
    subject: 'mailto:admin@thehospitalitycompany.co.uk',
  };
}

describe('RFC 8291 Appendix A — the worked example, byte for byte', () => {
  it('produces exactly the message the RFC prints', async () => {
    const body = await encryptPayload(
      new TextEncoder().encode('When I grow up, I want to be a watermelon'),
      {
        p256dh:
          'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
        auth: 'BTBZMqHH6r4Tts7J_aSIgg',
      },
      {
        salt: b64urlDecode('DGv6ra1nlYgDCS1FRnbzlw'),
        senderKeys: {
          publicKey: b64urlDecode(
            'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
          ),
          privateKey: b64urlDecode('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'),
        },
      },
    );
    expect(b64urlEncode(body)).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    );
  });
});

describe('encryption round-trips through an independent decrypter', () => {
  it('a browser can read what the drain sends', async () => {
    const b = browser();
    const payload = JSON.stringify({
      title: 'Shift confirmed',
      body: 'You are booked',
      url: '/shifts/41',
    });
    const body = await encryptPayload(new TextEncoder().encode(payload), b.subscription);
    expect(decrypt(body, b.privateKey, b.publicKey, b.auth)).toBe(payload);
  });

  it('uses a fresh salt and sender key per message', async () => {
    const b = browser();
    const one = await encryptPayload(new TextEncoder().encode('x'), b.subscription);
    const two = await encryptPayload(new TextEncoder().encode('x'), b.subscription);
    expect(b64urlEncode(one)).not.toBe(b64urlEncode(two));
  });

  it('refuses a payload bigger than one record', async () => {
    const b = browser();
    await expect(
      encryptPayload(new Uint8Array(MAX_PUSH_PLAINTEXT + 1), b.subscription),
    ).rejects.toThrow(/limit/);
  });

  it('refuses a malformed subscription key', async () => {
    await expect(
      encryptPayload(new Uint8Array(1), { p256dh: b64urlEncode(new Uint8Array(10)), auth: 'AAAA' }),
    ).rejects.toThrow(/not an uncompressed P-256/);
  });
});

describe('VAPID (RFC 8292)', () => {
  it('signs an ES256 JWT for the push service origin that the public key verifies', async () => {
    const vapid = vapidPair();
    const header = await vapidAuthorization(
      'https://updates.push.services.mozilla.com/wpush/v2/xyz',
      vapid,
      1_800_000_000,
    );
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, h, c, s, k] = match!;
    expect(k).toBe(vapid.publicKey);
    expect(JSON.parse(Buffer.from(b64urlDecode(h!)).toString())).toEqual({
      typ: 'JWT',
      alg: 'ES256',
    });
    expect(JSON.parse(Buffer.from(b64urlDecode(c!)).toString())).toEqual({
      aud: 'https://updates.push.services.mozilla.com',
      exp: 1_800_000_000 + 12 * 3600,
      sub: 'mailto:admin@thehospitalitycompany.co.uk',
    });

    const pub = b64urlDecode(vapid.publicKey);
    const key = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: b64urlEncode(pub.slice(1, 33)),
        y: b64urlEncode(pub.slice(33)),
      },
      format: 'jwk',
    });
    const ok = verify(
      'sha256',
      Buffer.from(`${h}.${c}`),
      { key, dsaEncoding: 'ieee-p1363' },
      Buffer.from(b64urlDecode(s!)),
    );
    expect(ok).toBe(true);
  });

  it('refuses a subject that is not mailto: or https:', async () => {
    await expect(
      vapidAuthorization('https://fcm.googleapis.com/x', {
        ...vapidPair(),
        subject: 'admin@x.com',
      }),
    ).rejects.toThrow(/VAPID_SUBJECT/);
  });

  it('refuses a plain-http endpoint', () => {
    expect(() => audienceOf('http://push.example.com/x')).toThrow(/https/);
  });
});

describe('the request', () => {
  it('carries the headers a push service requires', async () => {
    const b = browser();
    const req = await buildPushRequest(
      b.subscription,
      { title: 't', body: 'b', url: '/x' },
      vapidPair(),
    );
    expect(req.url).toBe(b.subscription.endpoint);
    expect(req.headers['Content-Encoding']).toBe('aes128gcm');
    expect(req.headers.TTL).toBe(String(12 * 3600));
    expect(req.headers.Urgency).toBe('high');
    expect(req.headers.Authorization).toMatch(/^vapid t=/);
    expect(JSON.parse(decrypt(req.body, b.privateKey, b.publicKey, b.auth))).toEqual({
      title: 't',
      body: 'b',
      url: '/x',
    });
  });
});

describe('push service answers', () => {
  it.each([
    [201, 'delivered'],
    [200, 'delivered'],
    [404, 'gone'],
    [410, 'gone'],
    [400, 'rejected'],
    [403, 'rejected'],
    [413, 'rejected'],
    [429, 'retry'],
    [500, 'retry'],
    [503, 'retry'],
  ] as const)('%i is %s', (status, verdict) => {
    expect(classifyPushStatus(status)).toBe(verdict);
  });
});
