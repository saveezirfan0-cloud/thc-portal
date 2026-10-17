import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Go-live audit M1: the header selfie keeps one URL for half an hour, so
 * the browser's image cache hits instead of downloading it on every screen.
 * The bucket stays private: every link is a signed one, from the worker's
 * own session.
 */
const createSignedUrl = vi.fn(async (path: string, ttl: number) => ({
  data: { signedUrl: `https://storage.test/${path}?token=${Math.random()}&ttl=${ttl}` },
  error: null,
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({ storage: { from: () => ({ createSignedUrl }) } }),
}));

const { ownPhotoUrls, signOwnPhoto, signedUrlCache } = await import('../photos');

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  createSignedUrl.mockClear();
  ownPhotoUrls.clear();
});

describe('signOwnPhoto', () => {
  it('signs for an hour, and hands the same link back on the next request', async () => {
    const first = await signOwnPhoto('staff-1/selfie-1.jpg');
    const second = await signOwnPhoto('staff-1/selfie-1.jpg');
    expect(first).toBe(second);
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
    expect(createSignedUrl).toHaveBeenCalledWith('staff-1/selfie-1.jpg', 3600);
  });

  it('a new selfie is a new path, so never the old link', async () => {
    const before = await signOwnPhoto('staff-1/selfie-1.jpg');
    const after = await signOwnPhoto('staff-1/selfie-2.jpg');
    expect(after).not.toBe(before);
    expect(createSignedUrl).toHaveBeenCalledTimes(2);
  });

  it('a failed signing is not remembered', async () => {
    createSignedUrl.mockResolvedValueOnce({ data: null, error: { message: 'x' } } as never);
    expect(await signOwnPhoto('staff-1/selfie-1.jpg')).toBeNull();
    expect(await signOwnPhoto('staff-1/selfie-1.jpg')).toMatch(/^https:\/\/storage\.test\//);
  });

  it('no path, no link', async () => {
    expect(await signOwnPhoto(null)).toBeNull();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });
});

describe('signedUrlCache', () => {
  it('reuses a link until its reuse window ends, then asks for a new one', () => {
    let t = 0;
    const cache = signedUrlCache({ max: 10, reuseMs: 1_800_000, now: () => t });
    cache.set('p', 'u');
    t = 1_799_999;
    expect(cache.get('p')).toBe('u');
    t = 1_800_000;
    expect(cache.get('p')).toBeUndefined();
  });

  it('is bounded, least recently used first', () => {
    const cache = signedUrlCache({ max: 2, reuseMs: 1_000, now: () => 0 });
    cache.set('a', '1');
    cache.set('b', '2');
    cache.get('a');
    cache.set('c', '3');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('1');
    expect(cache.get('c')).toBe('3');
  });
});
