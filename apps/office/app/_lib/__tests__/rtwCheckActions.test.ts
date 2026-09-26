import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "Compare the photos before you verify" (ADR-0041): rtwCheckPhotos() is
 * the only way the gov.uk photo reaches the browser. It must refuse anyone
 * who is not an admin BEFORE reading or signing anything, read both paths
 * through the session (never from the caller's arguments), and sign the
 * gov.uk photo for 60 seconds only once the check has finished.
 */

const state = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  role: 'admin' as string | null,
  check: {
    staff_id: 's1',
    status: 'needs_review',
    photo_path: 's1/share-code-report/rtw-check-k1-photo.png',
  } as { staff_id: string; status: string; photo_path: string | null } | null,
  selfie: 's1/selfie.jpg' as string | null,
  reads: [] as { table: string; column: string; value: string }[],
}));

function table(name: string) {
  return {
    select: () => ({
      eq: (column: string, value: string) => {
        state.reads.push({ table: name, column, value });
        return {
          maybeSingle: async () => ({
            data:
              name === 'profiles'
                ? state.role
                  ? { role: state.role }
                  : null
                : name === 'rtw_checks_latest_v'
                  ? state.check
                  : name === 'staff_profile_v'
                    ? { photo_path: state.selfie }
                    : null,
            error: null,
          }),
        };
      },
    }),
  };
}

const createSignedUrls = vi.fn(async (paths: string[]) => ({
  data: paths.map((path) => ({ path, signedUrl: `https://signed/session/${path}`, error: null })),
  error: null,
}));
const createClient = vi.fn(() => ({
  auth: { getUser: async () => ({ data: { user: state.user } }) },
  from: vi.fn(table),
  storage: { from: () => ({ createSignedUrls }) },
}));
const createSignedUrl = vi.fn(async (path: string, ttl: number) => ({
  data: { signedUrl: `https://signed/admin/${path}?ttl=${ttl}` },
  error: null,
}));
const adminFrom = vi.fn(() => ({ createSignedUrl }));
const createAdminClient = vi.fn(() => ({ storage: { from: adminFrom } }));

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@thc/db/server', () => ({ createClient }));
vi.mock('@thc/db/admin', () => ({ createAdminClient }));

const { rtwCheckPhotos } = await import('../rtwCheckActions');

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  state.user = { id: 'u1' };
  state.role = 'admin';
  state.check = {
    staff_id: 's1',
    status: 'needs_review',
    photo_path: 's1/share-code-report/rtw-check-k1-photo.png',
  };
  state.selfie = 's1/selfie.jpg';
  state.reads = [];
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('rtwCheckPhotos', () => {
  it('refuses a signed-in worker before reading or signing anything', async () => {
    state.role = 'staff';
    const result = await rtwCheckPhotos('k1');
    expect(result).toEqual({ ok: false, message: expect.stringMatching(/Only the office/) });
    expect(state.reads.map((r) => r.table)).toEqual(['profiles']);
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it('refuses a caller with no session', async () => {
    state.user = null;
    const result = await rtwCheckPhotos('k1');
    expect(result.ok).toBe(false);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('for an admin: both paths read through the session, gov.uk photo signed for 60 s', async () => {
    const result = await rtwCheckPhotos('k1');
    expect(state.reads).toContainEqual({
      table: 'rtw_checks_latest_v',
      column: 'check_id',
      value: 'k1',
    });
    expect(state.reads).toContainEqual({ table: 'staff_profile_v', column: 'id', value: 's1' });
    expect(adminFrom).toHaveBeenCalledWith('documents');
    expect(createSignedUrl).toHaveBeenCalledWith('s1/share-code-report/rtw-check-k1-photo.png', 60);
    expect(result).toEqual({
      ok: true,
      govPhotoUrl: 'https://signed/admin/s1/share-code-report/rtw-check-k1-photo.png?ttl=60',
      selfieUrl: 'https://signed/session/s1/selfie.jpg',
      hasGovPhoto: true,
      hasSelfie: true,
    });
  });

  it('says plainly when there is no photo, and never signs a running check’s', async () => {
    state.check = { staff_id: 's1', status: 'needs_review', photo_path: null };
    state.selfie = null;
    expect(await rtwCheckPhotos('k1')).toEqual({
      ok: true,
      govPhotoUrl: null,
      selfieUrl: null,
      hasGovPhoto: false,
      hasSelfie: false,
    });

    state.check = { staff_id: 's1', status: 'running', photo_path: 's1/share-code-report/p.png' };
    const running = await rtwCheckPhotos('k1');
    expect(running).toMatchObject({ ok: true, govPhotoUrl: null, hasGovPhoto: false });
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('a check this admin cannot see (or no longer the latest) signs nothing', async () => {
    state.check = null;
    const result = await rtwCheckPhotos('k9');
    expect(result.ok).toBe(false);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
