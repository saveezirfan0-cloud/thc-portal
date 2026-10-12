import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Security round 12.10 — the onboarding wizard's server side:
 *
 *   item 7  the home pin is checked against the address's own postcode on
 *           the server (postcodes.io, the same lookup /profile/details
 *           uses); more than 5 km away is refused before the RPC, and the
 *           save is onboarding_save_address_geocoded() through the service
 *           key with the server's centroid (20261012121400) — the
 *           candidate's session never names a point.
 *   ADR-0113 step 9's bank save re-checks the current password first.
 *   item 8  lookupPostcode — callable without signing in — sends nothing to
 *           postcodes.io unless the input is a UK postcode's shape.
 *   item 5  an upload's stored bytes must be what its name says before it
 *           is attached (step 3 selfie, step 4 documents).
 */
const rpc = vi.hoisted(() => vi.fn());
const geocode = vi.hoisted(() => vi.fn());
const storedMedia = vi.hoisted(() => vi.fn());
const storage = vi.hoisted(() => ({
  list: vi.fn(),
  remove: vi.fn(),
}));
const adminRpc = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ getUser: vi.fn(), signInWithPassword: vi.fn() }));

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('../../db', () => ({
  supabaseConfigured: () => true,
  staffDb: () => ({ auth, rpc: (...args: unknown[]) => rpc(...args) }),
}));
vi.mock('@thc/db/admin', () => ({
  createAdminClient: () => ({
    rpc: (...args: unknown[]) => adminRpc(...args),
    storage: { from: () => storage },
  }),
}));
vi.mock('../../_lib/postcode', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  geocodePostcode: (...args: unknown[]) => geocode(...args),
}));
vi.mock('../../_lib/stored-media', () => ({
  checkStoredMedia: (...args: unknown[]) => storedMedia(...args),
}));
vi.mock('../../../lib/extract', () => ({ extractAfterResponse: vi.fn() }));

const { finishDocumentUpload, lookupPostcode, saveAddress, saveBank, saveSelfie } =
  await import('../actions');

const STAFF = 'd0000000-0000-4000-8000-000000000001';
const E2 = { lat: 51.5308, lng: -0.0424 }; // E2 0RY
const address = {
  flat: '',
  house: '22',
  street: 'Roman Road',
  area: 'Bethnal Green',
  town: 'London',
  postcode: 'E2 0RY',
};
const rpcNames = () => rpc.mock.calls.map(([fn]) => fn);
const adminRpcNames = () => adminRpc.mock.calls.map(([fn]) => fn);

beforeEach(() => {
  vi.clearAllMocks();
  process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'service';
  process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'http://127.0.0.1:54321';
  process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'anon';
  rpc.mockImplementation(async (fn: string) =>
    fn === 'staff_me'
      ? { data: { staffId: STAFF }, error: null }
      : { data: { docId: 'doc-1' }, error: null },
  );
  geocode.mockResolvedValue({ ok: true, ...E2, postcode: 'E2 0RY' });
  storedMedia.mockResolvedValue('match');
  adminRpc.mockResolvedValue({ data: true, error: null });
  auth.getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'cand@example.com' } } });
  auth.signInWithPassword.mockResolvedValue({ error: null });
  storage.list.mockImplementation(async (_folder: string, { search }: { search: string }) => ({
    data: [{ name: search, metadata: { size: 1000, mimetype: 'application/pdf' } }],
    error: null,
  }));
});

describe('saveAddress — the pin against the postcode (item 7)', () => {
  it('a pin on the street is saved through the service key, with the server’s centroid', async () => {
    const result = await saveAddress({ address, lat: 51.531, lng: -0.043 });
    expect(result.ok).toBe(true);
    expect(geocode).toHaveBeenCalledWith('E2 0RY');
    expect(adminRpc).toHaveBeenCalledWith('onboarding_save_address_geocoded', {
      p_staff: STAFF,
      p_line: '22 Roman Road, Bethnal Green',
      p_town: 'London',
      p_postcode: 'E2 0RY',
      p_lat: 51.531,
      p_lng: -0.043,
      p_postcode_lat: E2.lat,
      p_postcode_lng: E2.lng,
    });
    // The candidate's own session never names a point.
    expect(rpcNames()).not.toContain('onboarding_save_address');
    expect(rpcNames()).not.toContain('onboarding_save_address_geocoded');
  });

  it('a pin more than 5 km from the postcode is refused before the RPC', async () => {
    // Heathrow is ~27 km from E2 0RY.
    const result = await saveAddress({ address, lat: 51.47, lng: -0.4543 });
    expect(result).toEqual({
      ok: false,
      message:
        'Your pin is more than 5 km from that postcode. Move the pin to your home, or check the postcode.',
      reason: 'pin_far_from_postcode',
    });
    expect(adminRpcNames()).not.toContain('onboarding_save_address_geocoded');
  });

  it('the database’s own refusal reads as the same sentence', async () => {
    adminRpc.mockResolvedValue({ data: null, error: { message: 'pin_far_from_postcode' } });
    const result = await saveAddress({ address, ...E2 });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('pin_far_from_postcode');
  });

  it('a postcode postcodes.io does not know is refused (a made-up one cannot skip the check)', async () => {
    geocode.mockResolvedValue({ ok: false, reason: 'not_found' });
    const result = await saveAddress({ address: { ...address, postcode: 'ZZ9 9ZZ' }, ...E2 });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('postcode_not_located');
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it('postcodes.io being down is a "try again", never an unchecked save', async () => {
    geocode.mockResolvedValue({ ok: false, reason: 'unreachable' });
    const result = await saveAddress({ address, ...E2 });
    expect(result).toEqual({
      ok: false,
      message: 'We couldn’t check your postcode just now. Please try again in a minute.',
      reason: 'postcode_unreachable',
    });
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it('a pin that is not a number is refused', async () => {
    const result = await saveAddress({ address, lat: Number.NaN, lng: 0 });
    expect(result.ok).toBe(false);
    expect(geocode).not.toHaveBeenCalled();
  });

  it('with no service key the save is refused, never sent as the candidate', async () => {
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    const result = await saveAddress({ address, ...E2 });
    expect(result.ok).toBe(false);
    expect(rpcNames()).not.toContain('onboarding_save_address');
    expect(adminRpc).not.toHaveBeenCalled();
  });
});

describe('saveBank — step 9 re-checks the password (ADR-0113)', () => {
  const bank = { accountHolder: 'A Kalu', sortCode: '40-47-84', accountNumber: '31926819' };

  it('a wrong password saves nothing', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    const result = await saveBank({ ...bank, currentPassword: 'wrong' });
    expect(result).toEqual({ ok: false, message: 'That current password isn’t right.' });
    expect(rpcNames()).not.toContain('onboarding_save_bank');
  });

  it('the right password signs in as the session’s account, then saves', async () => {
    const result = await saveBank({ ...bank, currentPassword: 'Correct-horse-1' });
    expect(result.ok).toBe(true);
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'cand@example.com',
      password: 'Correct-horse-1',
    });
    expect(rpcNames()).toContain('onboarding_save_bank');
  });

  it('reauth_required from the database reads as a sentence', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'reauth_required' } });
    const result = await saveBank({ ...bank, currentPassword: 'Correct-horse-1' });
    expect(result).toEqual({
      ok: false,
      message: 'For your security, please enter your current password again.',
      reason: 'reauth_required',
    });
  });
});

describe('lookupPostcode — no open proxy (item 8)', () => {
  it.each(['', 'hello', '../../etc', 'E2 0RY?x=1', 'E2 0RY/../../', 'A'.repeat(500), 'E2'])(
    '%j is refused without a lookup',
    async (input) => {
      const result = await lookupPostcode(input);
      expect(result).toEqual({ ok: false, message: 'Enter a UK postcode, e.g. E2 0RY.' });
      expect(geocode).not.toHaveBeenCalled();
    },
  );

  it('a non-string from the wire is refused', async () => {
    expect((await lookupPostcode(42 as never)).ok).toBe(false);
    expect(geocode).not.toHaveBeenCalled();
  });

  it('a real postcode is looked up', async () => {
    expect(await lookupPostcode('e2 0ry')).toEqual({ ok: true, ...E2 });
    expect(geocode).toHaveBeenCalledWith('e2 0ry');
  });
});

describe('uploads are what their name says (item 5)', () => {
  const path = `${STAFF}/passport/0b2c6f2e-1111-4222-8333-444455556666.pdf`;

  it('step 4: matching bytes are attached', async () => {
    const result = await finishDocumentUpload({ docType: 'passport', path, fileName: 'p.pdf' });
    expect(result.ok).toBe(true);
    expect(storedMedia).toHaveBeenCalledWith(expect.anything(), 'documents', path);
    expect(rpcNames()).toContain('onboarding_attach_document');
  });

  it('step 4: bytes that are not a PDF are refused, discarded and never attached', async () => {
    storedMedia.mockResolvedValue('mismatch');
    const result = await finishDocumentUpload({ docType: 'passport', path, fileName: 'p.pdf' });
    expect(result).toEqual({
      ok: false,
      message: 'We take PDF, JPG, PNG or HEIC files only.',
      reason: 'file_type',
    });
    expect(rpcNames()).not.toContain('onboarding_attach_document');
    expect(storage.remove).toHaveBeenCalledWith([path]);
  });

  it('step 4: an object that cannot be read is never attached', async () => {
    storedMedia.mockResolvedValue('unreadable');
    const result = await finishDocumentUpload({ docType: 'passport', path, fileName: 'p.pdf' });
    expect(result.ok).toBe(false);
    expect(rpcNames()).not.toContain('onboarding_attach_document');
  });

  it('step 3: a selfie that is not a JPEG is never set', async () => {
    storedMedia.mockResolvedValue('mismatch');
    const result = await saveSelfie(`${STAFF}/selfie-1.jpg`);
    expect(result.ok).toBe(false);
    expect(storedMedia).toHaveBeenCalledWith(expect.anything(), 'photos', `${STAFF}/selfie-1.jpg`);
    expect(rpcNames()).not.toContain('staff_set_photo');
  });

  it('step 3: a real JPEG is set', async () => {
    const result = await saveSelfie(`${STAFF}/selfie-1.jpg`);
    expect(result.ok).toBe(true);
    expect(rpcNames()).toContain('staff_set_photo');
  });
});
