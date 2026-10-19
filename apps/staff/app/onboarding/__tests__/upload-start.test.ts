import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * §2.5 pt 7 — the upload path is built from the session and a DOCUMENT
 * TYPE OF OURS, never from a request field as typed. A forged docType such
 * as `../x` reached `documentPath()` and got a signed upload URL for a key
 * nothing would ever record or clean up; now it is refused before the
 * service key is touched. `finishDocumentUpload` and the RPC refuse it too
 * (paths.test.ts, pgTAP) — this pins the FIRST gate.
 */
const storage = vi.hoisted(() => ({
  createSignedUploadUrl: vi.fn(async (path: string) => ({
    data: { path, token: 't', signedUrl: `https://abc.supabase.co/sign/documents/${path}?token=t` },
    error: null,
  })),
}));
/** The worker's OWN session's Storage (the selfie), not the service key's. */
const sessionStorage = vi.hoisted(() => ({
  bucket: vi.fn(),
  createSignedUploadUrl: vi.fn(async (path: string) => ({
    data: { path, token: 's', signedUrl: `https://abc.supabase.co/sign/photos/${path}?token=s` },
    error: null as null | { message: string },
  })),
}));
const photoPathFor = vi.hoisted(() => vi.fn((staffId: string) => `${staffId}/selfie-1.jpg`));

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('../../db', () => ({
  supabaseConfigured: () => true,
  staffDb: () => ({
    rpc: async (fn: string) =>
      fn === 'staff_me' ? { data: { staffId: 's1' }, error: null } : { data: {}, error: null },
    storage: {
      from: (bucket: string) => {
        sessionStorage.bucket(bucket);
        return { createSignedUploadUrl: sessionStorage.createSignedUploadUrl };
      },
    },
  }),
}));
vi.mock('@thc/db/admin', () => ({
  createAdminClient: () => ({ storage: { from: () => storage } }),
}));
vi.mock('../../_lib/postcode', () => ({ geocodePostcode: vi.fn() }));
vi.mock('../../profile/photos', () => ({ photoPathFor }));

const { startDocumentUpload, startSelfieUpload } = await import('../actions');

beforeEach(() => {
  process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'service';
  storage.createSignedUploadUrl.mockClear();
});

const file = { fileName: 'passport.jpg', fileSize: 120_000, fileType: 'image/jpeg' };

describe('startDocumentUpload — the docType gate', () => {
  it('mints a signed upload for one of our document types, under the session’s folder', async () => {
    const result = await startDocumentUpload({ docType: 'passport', ...file });
    expect(result.ok).toBe(true);
    expect(storage.createSignedUploadUrl).toHaveBeenCalledTimes(1);
    const [path] = storage.createSignedUploadUrl.mock.calls[0]!;
    expect(path).toMatch(/^s1\/passport\/[0-9a-f-]{36}\.jpg$/);
    // Go-live audit L1: the browser PUTs the file to this URL with the
    // server's content type, and loads no Supabase client to do it.
    expect(result).toEqual({
      ok: true,
      path,
      url: `https://abc.supabase.co/sign/documents/${path}?token=t`,
      contentType: 'image/jpeg',
    });
  });

  it.each(['../x', 'a/b', 'p45', ''])(
    'refuses %j before the service key is touched',
    async (forged) => {
      const result = await startDocumentUpload({ docType: forged as never, ...file });
      expect(result.ok).toBe(false);
      expect(storage.createSignedUploadUrl).not.toHaveBeenCalled();
    },
  );
});

describe('startSelfieUpload — signed by the worker’s own session', () => {
  beforeEach(() => {
    sessionStorage.bucket.mockClear();
    sessionStorage.createSignedUploadUrl.mockClear();
  });

  it('signs the session’s own photo path in `photos`, never with the service key', async () => {
    const result = await startSelfieUpload();
    expect(photoPathFor).toHaveBeenCalledWith('s1');
    expect(sessionStorage.bucket).toHaveBeenCalledWith('photos');
    expect(sessionStorage.createSignedUploadUrl).toHaveBeenCalledWith('s1/selfie-1.jpg');
    expect(storage.createSignedUploadUrl).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      path: 's1/selfie-1.jpg',
      url: 'https://abc.supabase.co/sign/photos/s1/selfie-1.jpg?token=s',
    });
  });

  it('says try again when Storage refuses to sign (photos_worker_insert_own)', async () => {
    sessionStorage.createSignedUploadUrl.mockResolvedValueOnce({
      data: null as never,
      error: { message: 'new row violates row-level security policy' },
    });
    const result = await startSelfieUpload();
    expect(result).toEqual({ ok: false, message: 'That upload couldn’t start. Please try again.' });
  });
});
