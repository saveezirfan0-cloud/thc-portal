import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The office's one way from a private `photos` path to something an
 * `<img>` can load (audit 2026-09-24: photos never displayed in the office).
 * Three things are held here: the signing goes through the signed-in
 * manager's own session (Storage's `photos_admin_read` decides, never the
 * service key), it is ONE batch per page, and every failure degrades to
 * "no URL" — initials — rather than a broken screen.
 */

const state = vi.hoisted(() => ({
  signed: [] as { path: string | null; signedUrl: string; error: string | null }[],
  signError: null as { message: string } | null,
  throws: false,
}));

const createSignedUrls = vi.fn(async (paths: string[], ttl: number) => {
  void ttl;
  if (state.throws) throw new Error('storage down');
  // Storage answers for the paths it was asked about, as createSignedUrls does.
  const asked = state.signed.filter((entry) => entry.path && paths.includes(entry.path));
  return { data: state.signError ? null : asked, error: state.signError };
});
const from = vi.fn(() => ({ createSignedUrls }));
const createClient = vi.fn(() => ({ storage: { from } }));
const createAdminClient = vi.fn(() => {
  throw new Error('the service key must not sign office photos');
});

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('@thc/db/admin', () => ({ createAdminClient }));
vi.mock('@thc/db/server', () => ({ createClient }));

const {
  PHOTO_CACHE_ENTRIES,
  PHOTO_URL_REUSE_MS,
  PHOTO_URL_TTL_SECONDS,
  photoUrls,
  signStaffPhotos,
  signedUrlCache,
  withPhotoUrls,
} = await import('../photos');

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
};

beforeEach(() => {
  for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
  // No service key anywhere: the office must sign without one.
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
  state.signed = [
    { path: 'a/selfie.jpg', signedUrl: 'https://signed/a', error: null },
    { path: 'b/selfie.jpg', signedUrl: 'https://signed/b', error: null },
  ];
  state.signError = null;
  state.throws = false;
  createSignedUrls.mockClear();
  // The instance's link cache outlives a request by design; each test starts cold.
  photoUrls.clear();
  createClient.mockClear();
  createAdminClient.mockClear();
  from.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('signStaffPhotos', () => {
  it('signs every distinct path in one batch from the private photos bucket', async () => {
    const urls = await signStaffPhotos(['a/selfie.jpg', null, 'b/selfie.jpg', 'a/selfie.jpg', '']);
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith('photos');
    expect(createSignedUrls).toHaveBeenCalledWith(
      ['a/selfie.jpg', 'b/selfie.jpg'],
      PHOTO_URL_TTL_SECONDS,
    );
    expect(urls.get('a/selfie.jpg')).toBe('https://signed/a');
    expect(urls.get('b/selfie.jpg')).toBe('https://signed/b');
  });

  it('signs through the caller’s own session, never the service-role key', async () => {
    await signStaffPhotos(['a/selfie.jpg']);
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('signs for an hour and reuses a link for the first half of it (ADR-0161)', () => {
    expect(PHOTO_URL_TTL_SECONDS).toBe(60 * 60);
    expect(PHOTO_URL_REUSE_MS).toBe(30 * 60 * 1000);
  });

  it('asks nothing when there is nothing to sign', async () => {
    expect((await signStaffPhotos([null, undefined])).size).toBe(0);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('asks nothing without a configured project', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    expect((await signStaffPhotos(['a/selfie.jpg'])).size).toBe(0);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('drops only the path Storage refused or could not find, not the page', async () => {
    state.signed = [
      { path: 'a/selfie.jpg', signedUrl: 'https://signed/a', error: null },
      { path: 'gone.jpg', signedUrl: '', error: 'Object not found' },
    ];
    const urls = await signStaffPhotos(['a/selfie.jpg', 'gone.jpg']);
    expect([...urls.keys()]).toEqual(['a/selfie.jpg']);
  });

  it('degrades to initials when storage refuses or is down', async () => {
    state.signError = { message: 'boom' };
    expect((await signStaffPhotos(['a/selfie.jpg'])).size).toBe(0);
    state.signError = null;
    state.throws = true;
    expect((await signStaffPhotos(['a/selfie.jpg'])).size).toBe(0);
  });
});

describe('withPhotoUrls', () => {
  it('sets photo_url per row, null where there is no path or no signature', async () => {
    const rows = await withPhotoUrls([
      { id: '1', photo_path: 'a/selfie.jpg' },
      { id: '2', photo_path: null },
      { id: '3', photo_path: 'missing.jpg' },
    ]);
    expect(rows.map((row) => row.photo_url)).toEqual(['https://signed/a', null, null]);
    expect(rows[0]?.id).toBe('1');
  });
});

describe('signed links are reused across refreshes (ADR-0161, as ADR-0133)', () => {
  it('a second render inside the half-life signs nothing and hands out the same URL', async () => {
    const first = await signStaffPhotos(['a/selfie.jpg', 'b/selfie.jpg']);
    const second = await signStaffPhotos(['b/selfie.jpg', 'a/selfie.jpg']);
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(second.get('a/selfie.jpg')).toBe(first.get('a/selfie.jpg'));
    expect(second.get('b/selfie.jpg')).toBe('https://signed/b');
  });

  it('signs only the faces it has not seen, in one batch', async () => {
    await signStaffPhotos(['a/selfie.jpg']);
    createSignedUrls.mockClear();
    await signStaffPhotos(['a/selfie.jpg', 'b/selfie.jpg']);
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls).toHaveBeenCalledWith(['b/selfie.jpg'], PHOTO_URL_TTL_SECONDS);
  });

  it('never caches a path Storage refused: the next render asks again', async () => {
    state.signed = [{ path: 'gone.jpg', signedUrl: '', error: 'Object not found' }];
    await signStaffPhotos(['gone.jpg']);
    await signStaffPhotos(['gone.jpg']);
    expect(createSignedUrls).toHaveBeenCalledTimes(2);
  });

  it('a failed batch caches nothing', async () => {
    state.signError = { message: 'boom' };
    await signStaffPhotos(['a/selfie.jpg']);
    state.signError = null;
    expect((await signStaffPhotos(['a/selfie.jpg'])).get('a/selfie.jpg')).toBe('https://signed/a');
    expect(createSignedUrls).toHaveBeenCalledTimes(2);
  });

  it('holds a bounded number of links', () => {
    expect(PHOTO_CACHE_ENTRIES).toBeGreaterThanOrEqual(2000);
    expect(PHOTO_CACHE_ENTRIES).toBeLessThanOrEqual(10_000);
  });
});

describe('signedUrlCache', () => {
  it('hands a link out until reuseMs after signing, then asks for a new one', () => {
    let clock = 0;
    const cache = signedUrlCache({ max: 10, reuseMs: 1000, now: () => clock });
    cache.set('p', 'https://signed/p');
    clock = 999;
    expect(cache.get('p')).toBe('https://signed/p');
    clock = 1000;
    expect(cache.get('p')).toBeUndefined();
    // An expired entry is dropped, not kept to be found again.
    expect(cache.size).toBe(0);
  });

  it('drops the least recently used past its bound', () => {
    const cache = signedUrlCache({ max: 2, reuseMs: 60_000, now: () => 0 });
    cache.set('a', 'A');
    cache.set('b', 'B');
    cache.get('a'); // a is now the most recent
    cache.set('c', 'C');
    expect(cache.size).toBe(2);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('A');
    expect(cache.get('c')).toBe('C');
  });

  it('a re-signed path replaces its old link and its clock', () => {
    let clock = 0;
    const cache = signedUrlCache({ max: 10, reuseMs: 1000, now: () => clock });
    cache.set('p', 'old');
    clock = 900;
    cache.set('p', 'new');
    clock = 1500;
    expect(cache.get('p')).toBe('new');
  });
});
