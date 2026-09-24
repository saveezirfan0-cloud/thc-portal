import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The office's one way from a private `photos` path to something an
 * `<img>` can load (audit 2026-09-24: photos never displayed in the office).
 * Three things are held here: the service key is reached only for an
 * admin, the signing is ONE batch per page, and every failure degrades to
 * "no URL" — initials — rather than a broken screen.
 */

const state = vi.hoisted(() => ({
  role: 'admin' as string | null,
  user: { id: 'u-admin' } as { id: string } | null,
  signed: [] as { path: string | null; signedUrl: string; error: string | null }[],
  signError: null as { message: string } | null,
  throws: false,
}));

const createSignedUrls = vi.fn(async (paths: string[], ttl: number) => {
  void paths;
  void ttl;
  if (state.throws) throw new Error('storage down');
  return { data: state.signError ? null : state.signed, error: state.signError };
});
const from = vi.fn(() => ({ createSignedUrls }));
const createAdminClient = vi.fn(() => ({ storage: { from } }));

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('@thc/db/admin', () => ({ createAdminClient }));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: state.role ? { role: state.role } : null }),
        }),
      }),
    }),
  }),
}));

const { PHOTO_URL_TTL_SECONDS, signStaffPhotos, withPhotoUrls } = await import('../photos');

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
};

beforeEach(() => {
  for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
  state.role = 'admin';
  state.user = { id: 'u-admin' };
  state.signed = [
    { path: 'a/selfie.jpg', signedUrl: 'https://signed/a', error: null },
    { path: 'b/selfie.jpg', signedUrl: 'https://signed/b', error: null },
  ];
  state.signError = null;
  state.throws = false;
  createSignedUrls.mockClear();
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

  it('keeps links short-lived', () => {
    expect(PHOTO_URL_TTL_SECONDS).toBeLessThanOrEqual(15 * 60);
  });

  it('never reaches for the service key for someone who is not an admin', async () => {
    state.role = 'staff';
    expect((await signStaffPhotos(['a/selfie.jpg'])).size).toBe(0);
    state.user = null;
    expect((await signStaffPhotos(['a/selfie.jpg'])).size).toBe(0);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('asks nothing when there is nothing to sign', async () => {
    expect((await signStaffPhotos([null, undefined])).size).toBe(0);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('signs nothing without a service key (every developer environment)', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    expect((await signStaffPhotos(['a/selfie.jpg'])).size).toBe(0);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('drops only the path that failed, not the page', async () => {
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
