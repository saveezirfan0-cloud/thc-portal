import { describe, expect, it } from 'vitest';
import {
  MAX_ENTRIES,
  SESSION_RECHECK_MS,
  createSessionCheckCache,
  sessionKey,
} from '../session-check';

describe('sessionKey', () => {
  it('separates sessions and users', () => {
    const a = sessionKey({ sub: 'u1', session_id: 's1' });
    expect(sessionKey({ sub: 'u1', session_id: 's2' })).not.toBe(a);
    expect(sessionKey({ sub: 'u2', session_id: 's1' })).not.toBe(a);
  });

  it('falls back to iat when a token carries no session_id', () => {
    expect(sessionKey({ sub: 'u1', iat: 10 })).not.toBe(sessionKey({ sub: 'u1', iat: 11 }));
  });
});

describe('session check cache', () => {
  it('remembers an answer for the recheck interval, then asks again', () => {
    let t = 1_000;
    const cache = createSessionCheckCache(() => t);
    expect(cache.get('k')).toBeNull();
    cache.set('k', { valid: true });
    t += SESSION_RECHECK_MS - 1;
    expect(cache.get('k')).toEqual({ valid: true });
    t += 1;
    expect(cache.get('k')).toBeNull();
  });

  it('remembers a revoked session too, so it is not re-asked on every request', () => {
    const cache = createSessionCheckCache(() => 0);
    cache.set('k', { valid: false });
    expect(cache.get('k')).toEqual({ valid: false });
  });

  it('stays bounded: the oldest entry goes first', () => {
    const cache = createSessionCheckCache(() => 0);
    for (let i = 0; i <= MAX_ENTRIES; i++) cache.set(`k${i}`, { valid: true });
    expect(cache.get('k0')).toBeNull();
    expect(cache.get('k1')).not.toBeNull();
    expect(cache.get(`k${MAX_ENTRIES}`)).not.toBeNull();
  });
});
