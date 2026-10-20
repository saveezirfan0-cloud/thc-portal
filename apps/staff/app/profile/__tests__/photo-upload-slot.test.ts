import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * startPhotoUpload() — Profile details' selfie for a worker who has none
 * (§1.6, §10.1). The browser gets a path and a one-object URL signed by the
 * worker's OWN session (photos_worker_insert_own), and uploads with one PUT,
 * loading no Supabase client (ADR-0162; /profile/details had kept it).
 */
const rpc = vi.hoisted(() => vi.fn());
const createSignedUploadUrl = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn(() => ({ createSignedUploadUrl })));

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ rpc, storage: { from } }) }));
vi.mock('@thc/db/admin', () => ({
  createAdminClient: () => {
    throw new Error('the selfie slot never uses the service key');
  },
}));

const { startPhotoUpload } = await import('../actions');

const saved = { ...process.env };
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
});
afterAll(() => {
  process.env = saved;
});
beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: { staffId: 'staff-1', photoLocked: false }, error: null });
  createSignedUploadUrl.mockResolvedValue({
    data: { signedUrl: 'http://127.0.0.1:54321/storage/v1/object/upload/sign/photos/x?token=t' },
    error: null,
  });
});

describe('startPhotoUpload()', () => {
  it('signs exactly the session-built path in photos, with the worker’s own session', async () => {
    const slot = await startPhotoUpload();
    expect(slot.ok).toBe(true);
    const path = slot.ok ? slot.path : '';
    expect(path).toMatch(/^staff-1\/selfie-\d+\.jpg$/);
    expect(from).toHaveBeenCalledWith('photos');
    expect(createSignedUploadUrl).toHaveBeenCalledWith(path);
    expect(slot.ok && slot.url).toContain('token=t');
  });

  it('a locked photo gets no slot, and nothing is signed', async () => {
    rpc.mockResolvedValue({ data: { staffId: 'staff-1', photoLocked: true }, error: null });
    expect((await startPhotoUpload()).ok).toBe(false);
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('Storage refusing to sign is "could not start", not a crash', async () => {
    createSignedUploadUrl.mockResolvedValue({ data: null, error: { message: 'denied' } });
    expect(await startPhotoUpload()).toEqual({
      ok: false,
      message: 'That upload couldn’t start. Please try again.',
    });
  });
});
