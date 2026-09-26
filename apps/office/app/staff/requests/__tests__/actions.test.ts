import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The office's decision on a change request (ADR-0045) and the Emergency
 * contact writes (ADR-0044). Held here:
 *
 *   · a name is approved only with the evidence tick — asked again on the
 *     server, and the kind read from the request, never from the browser;
 *   · a rejection needs a reason before anything reaches the database;
 *   · an approval sends no reason (the worker would read it);
 *   · every call goes through the manager's SESSION (auth.uid() is the
 *     decider and the audit actor), never the service key;
 *   · the emergency contact is validated by the domain rule first.
 */
const state = vi.hoisted(() => ({
  kind: 'name' as 'name' | 'photo',
  rpcError: null as { message: string } | null,
}));

const rpc = vi.fn(async () => ({ data: { ok: true }, error: state.rpcError }));
const createAdminClient = vi.fn(() => ({ rpc }));

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('@thc/db/admin', () => ({ createAdminClient }));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({
    rpc,
    auth: { getUser: async () => ({ data: { user: { id: 'u-admin' } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { kind: state.kind, staff_id: 's1', evidence_path: 's1/change-requests/x.pdf' },
            error: null,
          }),
        }),
      }),
    }),
  }),
}));
vi.mock('../../data', () => ({ supabaseConfigured: () => true }));

const { decideChangeRequest } = await import('../actions');
const { saveEmergencyContact, clearEmergencyContact } = await import('../../[id]/actions');

beforeEach(() => {
  state.kind = 'name';
  state.rpcError = null;
  rpc.mockClear();
  createAdminClient.mockClear();
});

describe('decideChangeRequest (ADR-0045)', () => {
  it('refuses to approve a name without the evidence tick, before the database', async () => {
    const result = await decideChangeRequest('r1', true, '', false);
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('approves a name with the tick, through the session, sending no reason', async () => {
    expect(await decideChangeRequest('r1', true, 'ignored', true)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('office_decide_profile_change', {
      p_id: 'r1',
      p_approve: true,
      p_reason: null,
    });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('approves a photo without any tick', async () => {
    state.kind = 'photo';
    expect(await decideChangeRequest('r1', true, '', false)).toEqual({ ok: true });
  });

  it('refuses a rejection without a reason, before the database', async () => {
    const result = await decideChangeRequest('r1', false, '   ', false);
    expect(result).toEqual({ ok: false, message: 'Give a reason — the worker is shown it.' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects with the trimmed reason', async () => {
    await decideChangeRequest('r1', false, '  Too dark.  ', false);
    expect(rpc).toHaveBeenCalledWith('office_decide_profile_change', {
      p_id: 'r1',
      p_approve: false,
      p_reason: 'Too dark.',
    });
  });

  it('says in words when someone else decided first', async () => {
    state.rpcError = { message: 'already_decided' };
    const result = await decideChangeRequest('r1', true, '', true);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(/already been decided/);
  });
});

describe('Emergency contact writes (ADR-0044)', () => {
  it('validates with the domain rule first and sends the E.164 number', async () => {
    const bad = await saveEmergencyContact('s1', {
      name: 'Grace',
      relationship: 'Parent',
      phone: '07700 900456',
    });
    expect(bad.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();

    expect(
      await saveEmergencyContact('s1', {
        name: ' Grace Kalu ',
        relationship: 'Parent',
        phone: '+44 7700 900456',
      }),
    ).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('office_save_emergency_contact', {
      p_staff: 's1',
      p_name: 'Grace Kalu',
      p_relationship: 'Parent',
      p_phone: '+447700900456',
    });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('clears through the session', async () => {
    expect(await clearEmergencyContact('s1')).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('office_clear_emergency_contact', { p_staff: 's1' });
  });
});
