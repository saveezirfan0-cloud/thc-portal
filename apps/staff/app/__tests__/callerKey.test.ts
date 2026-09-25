import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FALLBACK_SALT,
  callerBucket,
  callerHash,
  callerKey,
  callerSalt,
  clientIp,
} from '../../lib/callerKey';

/**
 * The per-caller key for the /apply throttle — ADR-0024, §1.7.
 *
 * Three things must hold or the design is not the one the ADR describes:
 * the key is stable (the same caller lands in the same bucket on every
 * serverless instance), it is salted (the table cannot be walked back to
 * addresses without the salt), and it never contains the address itself.
 */

const headers = (entries: Record<string, string>) => ({
  get: (name: string) => entries[name.toLowerCase()] ?? null,
});

const IP = '203.0.113.7';
const SALT = 'unit-test-salt';
const HEX64 = /^[0-9a-f]{64}$/;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('callerHash (§1.7)', () => {
  it('is stable: one address, one salt, one key — on every instance', () => {
    expect(callerHash(IP, SALT)).toBe(callerHash(IP, SALT));
    expect(callerHash(` ${IP} `, SALT)).toBe(callerHash(IP, SALT));
  });

  it('is the shape apply_caller_check() insists on: 64 lower-case hex characters', () => {
    expect(callerHash(IP, SALT)).toMatch(HEX64);
  });

  it('is HMAC-SHA256 under the salt, not a bare digest of the address', () => {
    // Pinned so the construction cannot quietly become sha256(ip), which a
    // rainbow table over the IPv4 space reverses in minutes.
    expect(callerHash(IP, SALT)).toBe(createHmac('sha256', SALT).update(IP).digest('hex'));
  });

  it('is salted: a different salt gives an unrelated key', () => {
    expect(callerHash(IP, SALT)).not.toBe(callerHash(IP, 'another-salt'));
    expect(callerHash(IP, SALT)).not.toBe(callerHash(IP, FALLBACK_SALT));
  });

  it('never contains the address, in any form', () => {
    const key = callerHash(IP, SALT);
    expect(key).not.toContain(IP);
    expect(key).not.toContain('203.0.113');
    expect(key).not.toContain(IP.replace(/\./g, ''));
    const v6 = '2001:db8:85a3::8a2e:370:7334';
    expect(callerHash(v6, SALT)).not.toContain('2001:db8');
    expect(callerHash(v6, SALT)).toMatch(HEX64);
  });

  it('distinguishes two addresses', () => {
    expect(callerHash(IP, SALT)).not.toBe(callerHash('203.0.113.8', SALT));
  });
});

describe('clientIp — what the platform reports', () => {
  it('takes the first hop of x-forwarded-for: the client, not the proxies after it', () => {
    expect(clientIp(headers({ 'x-forwarded-for': `${IP}, 10.0.0.1, 10.0.0.2` }))).toBe(IP);
    expect(clientIp(headers({ 'x-forwarded-for': `  ${IP}  ` }))).toBe(IP);
  });

  it('falls back to x-real-ip', () => {
    expect(clientIp(headers({ 'x-real-ip': IP }))).toBe(IP);
    expect(clientIp(headers({ 'x-forwarded-for': '', 'x-real-ip': IP }))).toBe(IP);
  });

  it('prefers x-forwarded-for when both are present', () => {
    expect(clientIp(headers({ 'x-forwarded-for': IP, 'x-real-ip': '198.51.100.9' }))).toBe(IP);
  });

  it('is null when the request carries no address at all', () => {
    expect(clientIp(headers({}))).toBeNull();
    expect(clientIp(headers({ 'x-forwarded-for': '   ', 'x-real-ip': '' }))).toBeNull();
  });
});

describe('callerBucket — what one caller can and cannot vary', () => {
  it('keeps an IPv4 address as it is', () => {
    expect(callerBucket(IP)).toBe(IP);
  });

  it('unwraps an IPv4-mapped IPv6 address to the IPv4 inside it', () => {
    expect(callerBucket(`::ffff:${IP}`)).toBe(IP);
    expect(callerBucket(`::FFFF:${IP}`)).toBe(IP);
  });

  it('buckets IPv6 by /64, so rotating inside the prefix a subscriber is given mints no new key', () => {
    const a = callerBucket('2001:db8:85a3:0001::1');
    const b = callerBucket('2001:0db8:85a3:1:ffff:ffff:ffff:ffff');
    expect(a).toBe('2001:0db8:85a3:0001::/64');
    expect(b).toBe(a);
    expect(callerHash('2001:db8:85a3:0001::1', SALT)).toBe(
      callerHash('2001:0db8:85a3:1:ffff:ffff:ffff:ffff', SALT),
    );
  });

  it('but a different /64 is a different caller', () => {
    expect(callerBucket('2001:db8:85a3:0002::1')).not.toBe(callerBucket('2001:db8:85a3:0001::1'));
  });

  it('drops a zone id and expands the shortest forms', () => {
    expect(callerBucket('fe80::1%eth0')).toBe('fe80:0000:0000:0000::/64');
    expect(callerBucket('::1')).toBe('0000:0000:0000:0000::/64');
  });

  it('keeps anything it cannot parse as typed, so it still hashes and still buckets alone', () => {
    expect(callerBucket('Not-An-Address')).toBe('not-an-address');
    expect(callerBucket('1:::2')).toBe('1:::2');
  });
});

describe('callerSalt', () => {
  it('reads APPLY_CALLER_SALT', () => {
    expect(callerSalt({ APPLY_CALLER_SALT: SALT })).toBe(SALT);
  });

  it('reads APPLY_THROTTLE_SALT too — the name the Vercel project already holds (docs/16 §3.1)', () => {
    expect(callerSalt({ APPLY_THROTTLE_SALT: SALT })).toBe(SALT);
    expect(callerSalt({ APPLY_CALLER_SALT: 'wins', APPLY_THROTTLE_SALT: SALT })).toBe('wins');
  });

  it('falls back to the built-in salt when it is unset or empty, so a fresh environment still throttles', () => {
    expect(callerSalt({})).toBe(FALLBACK_SALT);
    expect(callerSalt({ APPLY_CALLER_SALT: '' })).toBe(FALLBACK_SALT);
  });
});

describe('callerKey — the request to the hash', () => {
  it('hashes the reported address under the configured salt', () => {
    const env = { APPLY_CALLER_SALT: SALT };
    expect(callerKey(headers({ 'x-forwarded-for': `${IP}, 10.0.0.1` }), env)).toBe(
      callerHash(IP, SALT),
    );
    expect(callerKey(headers({ 'x-real-ip': IP }), env)).toBe(callerHash(IP, SALT));
  });

  it('is null when there is no address, so the action skips the limit rather than sharing one bucket', () => {
    expect(callerKey(headers({}), { APPLY_CALLER_SALT: SALT })).toBeNull();
  });

  it('says so, once, when the salt is the fallback', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const env = {};
    expect(callerKey(headers({ 'x-real-ip': IP }), env)).toBe(callerHash(IP, FALLBACK_SALT));
    callerKey(headers({ 'x-real-ip': IP }), env);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/APPLY_CALLER_SALT/);
    // Never the address, never the key: the warning is about configuration.
    expect(JSON.stringify(warn.mock.calls)).not.toContain(IP);
  });
});
