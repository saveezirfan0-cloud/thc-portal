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
    data: { path, token: 't' },
    error: null,
  })),
}));

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('../../db', () => ({
  supabaseConfigured: () => true,
  staffDb: () => ({
    rpc: async (fn: string) =>
      fn === 'staff_me' ? { data: { staffId: 's1' }, error: null } : { data: {}, error: null },
  }),
}));
vi.mock('@thc/db/admin', () => ({
  createAdminClient: () => ({ storage: { from: () => storage } }),
}));
vi.mock('../../_lib/postcode', () => ({ geocodePostcode: vi.fn() }));
vi.mock('../../profile/photos', () => ({ photoPathFor: vi.fn() }));

const { startDocumentUpload } = await import('../actions');

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
