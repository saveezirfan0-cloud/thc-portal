import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SALT,
  callerAddress,
  callerBucket,
  callerKey,
  hashCaller,
  isProductionRuntime,
} from '../caller';

/**
 * The per-caller key for the /apply throttle (ADR-0024): read from the
 * request the way Vercel supplies it, bucketed, and never sent anywhere
 * but as an HMAC under a server-side salt (§1.7).
 */
const h = (values: Record<string, string>) => ({
  get: (name: string) => values[name.toLowerCase()] ?? null,
});

describe('callerAddress', () => {
  it('takes the first hop of x-forwarded-for', () => {
    expect(callerAddress(h({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7');
  });
  it('falls back to x-real-ip, then to nothing', () => {
    expect(callerAddress(h({ 'x-real-ip': ' 198.51.100.4 ' }))).toBe('198.51.100.4');
    expect(callerAddress(h({ 'x-forwarded-for': ' , ' }))).toBeNull();
    expect(callerAddress(h({}))).toBeNull();
  });
});

describe('callerBucket', () => {
  it('keeps an IPv4 address and unwraps an IPv4-mapped one', () => {
    expect(callerBucket('203.0.113.7')).toBe('203.0.113.7');
    expect(callerBucket('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });
  it('keys IPv6 by its /64, however it is written', () => {
    const a = callerBucket('2001:db8:0:12:aaaa::1');
    expect(a).toBe('2001:db8:0:12::/64');
    expect(callerBucket('2001:0DB8:0000:0012:ffff:1:2:3')).toBe(a);
    expect(callerBucket('[2001:db8:0:12::9]')).toBe(a);
    expect(callerBucket('2001:db8:0:13::1')).not.toBe(a);
  });
});

describe('callerKey', () => {
  it('is a 64-hex HMAC — never the address', () => {
    const key = callerKey(h({ 'x-forwarded-for': '203.0.113.7' }), 'pepper')!;
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain('203');
    expect(key).toBe(createHmac('sha256', 'pepper').update('203.0.113.7').digest('hex'));
  });
  it('depends on the salt', () => {
    expect(hashCaller('203.0.113.7', 'a')).not.toBe(hashCaller('203.0.113.7', 'b'));
  });
  it('falls back to a constant salt, and says so once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const one = callerKey(h({ 'x-real-ip': '203.0.113.7' }), undefined);
    callerKey(h({ 'x-real-ip': '203.0.113.8' }), '  ');
    expect(one).toBe(hashCaller('203.0.113.7', DEFAULT_SALT));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('APPLY_THROTTLE_SALT');
    warn.mockRestore();
  });
  it('in production, refuses the constant: no key, one error, never the guessable digest', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(callerKey(h({ 'x-real-ip': '203.0.113.7' }), undefined, true)).toBeNull();
    expect(callerKey(h({ 'x-real-ip': '203.0.113.8' }), ' ', true)).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain('APPLY_THROTTLE_SALT');
    expect(warn).not.toHaveBeenCalled();
    error.mockRestore();
    warn.mockRestore();
  });
  it('in production, a configured salt is used as normal', () => {
    expect(callerKey(h({ 'x-real-ip': '203.0.113.7' }), 'pepper', true)).toBe(
      hashCaller('203.0.113.7', 'pepper'),
    );
  });
  it('treats NODE_ENV=production and VERCEL_ENV=production as production', () => {
    expect(isProductionRuntime({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(true);
    expect(
      isProductionRuntime({ NODE_ENV: 'test', VERCEL_ENV: 'production' } as NodeJS.ProcessEnv),
    ).toBe(true);
    expect(isProductionRuntime({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(false);
  });
  it('is null when the request carries no address (local development)', () => {
    expect(callerKey(h({}), 'pepper')).toBeNull();
  });
});
