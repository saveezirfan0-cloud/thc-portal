import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * saveContactDetails() — §10.1 Profile details, §6 proximity (security
 * audit 27.09, invariant 4; 20260927182100).
 *
 * The rule under test is WHO says where the pin goes:
 *
 *   - the worker is resolved from their own session (`staff_me()`), never
 *     from an argument;
 *   - the point is this action's postcode lookup, never the form's;
 *   - the save goes through the service-role client with that id, and the
 *     worker's session never calls the RPC — it holds no grant on it.
 */
const sessionRpc = vi.hoisted(() => vi.fn());
const adminRpc = vi.hoisted(() => vi.fn());
const adminClient = vi.hoisted(() => ({ fail: false }));
const locate = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ rpc: sessionRpc }) }));
vi.mock('@thc/db/admin', () => ({
  createAdminClient: () => {
    if (adminClient.fail) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');
    return { rpc: adminRpc };
  },
}));
vi.mock('../geocode', () => ({
  locateAddress: (address: string) => locate(address),
  addressSavedNote: () => 'Saved. We’ve let the office and payroll know your address changed.',
}));

const { saveContactDetails } = await import('../actions');

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
  adminClient.fail = false;
  sessionRpc.mockResolvedValue({ data: { staffId: 's1', firstName: 'Amara' }, error: null });
  adminRpc.mockResolvedValue({
    data: { ok: true, changed: ['home address'], located: true },
    error: null,
  });
  locate.mockResolvedValue({ located: true, lat: 51.5178, lng: -0.0786, postcode: 'E1 6AN' });
});

describe('saveContactDetails() — who names the worker and the point', () => {
  it('resolves the worker from the session, geocodes, and saves through the service role', async () => {
    const result = await saveContactDetails('+447700900011', '12 New Street, London E1 6AN');

    expect(sessionRpc).toHaveBeenCalledTimes(1);
    expect(sessionRpc).toHaveBeenCalledWith('staff_me');
    expect(locate).toHaveBeenCalledWith('12 New Street, London E1 6AN');
    expect(adminRpc).toHaveBeenCalledTimes(1);
    expect(adminRpc).toHaveBeenCalledWith('staff_update_contact_geocoded', {
      p_staff: 's1',
      p_phone: '+447700900011',
      p_home_address: '12 New Street, London E1 6AN',
      p_lat: 51.5178,
      p_lng: -0.0786,
    });
    expect(result).toEqual({
      ok: true,
      note: 'Saved. We’ve let the office and payroll know your address changed.',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/profile/details');
  });

  it('the worker’s session never calls the RPC — the point is not theirs to name', async () => {
    await saveContactDetails('+447700900011', '12 New Street, London E1 6AN');
    const sessionCalls = sessionRpc.mock.calls.map(([fn]) => fn);
    expect(sessionCalls).not.toContain('staff_update_contact_geocoded');
    expect(sessionCalls).not.toContain('staff_update_contact');
  });

  it('a failed lookup still saves the address, with no point (the RPC flags it stale)', async () => {
    locate.mockResolvedValue({ located: false, reason: 'not_found', postcode: 'E1 6AN' });
    adminRpc.mockResolvedValue({
      data: { ok: true, changed: ['home address'], located: false },
      error: null,
    });

    const result = await saveContactDetails('+447700900011', '12 New Street, London E1 6AN');
    expect(adminRpc.mock.calls[0]![1]).toMatchObject({ p_staff: 's1', p_lat: null, p_lng: null });
    expect(result.ok).toBe(true);
  });

  it('no worker behind the session: nothing is sent', async () => {
    sessionRpc.mockResolvedValue({ data: null, error: null });
    const result = await saveContactDetails('+447700900011', '12 New Street, London E1 6AN');
    expect(result).toEqual({
      ok: false,
      message: 'We couldn’t find your record. Please contact the office.',
    });
    expect(adminRpc).not.toHaveBeenCalled();
    expect(locate).not.toHaveBeenCalled();
  });

  it('a deployment without the service key says so, and never falls back to the session', async () => {
    adminClient.fail = true;
    const result = await saveContactDetails('+447700900011', '12 New Street, London E1 6AN');
    expect(result).toEqual({ ok: false, message: 'That didn’t go through. Please try again.' });
    expect(sessionRpc).toHaveBeenCalledTimes(1); // staff_me only
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it('a phone-only change is saved and reported as such', async () => {
    adminRpc.mockResolvedValue({
      data: { ok: true, changed: ['phone number'], located: null },
      error: null,
    });
    const result = await saveContactDetails(
      '+447700900999',
      'Flat 4, 22 Roman Road, London E2 0RY',
    );
    expect(result).toEqual({ ok: true, note: 'Saved.' });
  });

  it.each([
    ['not_editable', 'Your profile is closed to edits.'],
    ['phone_required', 'Please enter a mobile number we can reach you on.'],
    ['pin_outside_uk', 'That postcode isn’t in the UK. Please check your address.'],
    ['no_postcode', 'Please include your postcode at the end of your address'],
  ])('the RPC’s %s comes back as a sentence', async (code, sentence) => {
    adminRpc.mockResolvedValue({ data: null, error: { message: code } });
    const result = await saveContactDetails('+447700900011', '12 New Street, London E1 6AN');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain(sentence);
  });
});
