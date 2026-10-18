import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ADR-0060, residual gap: Accept creates the candidate's login through the
 * GoTrue Admin API (service key) BEFORE `onboarding_accept_with_account`
 * is asked, so the database's read-only refusal would come after a user
 * already existed. The office's write permission — `office_can('write')`,
 * asked of the database — is checked first; a viewer, a switched-off login
 * and a login below aal2 never reach the service key. Resend is the same.
 */
const state = vi.hoisted(() => ({
  user: { id: 'manager-1' } as { id: string } | null,
  appRole: 'admin' as string | null,
  officeRole: 'manager' as string,
}));
const sessionRpc = vi.hoisted(() =>
  vi.fn(async (fn: string) => {
    if (fn === 'current_app_role') return { data: state.appRole, error: null };
    if (fn === 'office_can')
      return { data: state.appRole === 'admin' && state.officeRole !== 'viewer', error: null };
    return { data: null, error: null };
  }),
);
const createAdminClient = vi.hoisted(() =>
  vi.fn(() => ({ auth: { admin: {} }, storage: { from: () => ({}) } })),
);

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../../staff/data', () => ({ supabaseConfigured: () => true }));
vi.mock('@thc/db/admin', () => ({ createAdminClient }));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { id: 's1', email: 'a@b.test', user_id: null, status: 'interview_completed' },
            error: null,
          }),
        }),
      }),
    }),
    rpc: sessionRpc,
  }),
}));
// The GoTrue half is activation.ts's own test; here only "was it reached?".
const acceptWithAccount = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
const resendActivation = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock('../activation', () => ({ acceptWithAccount, resendActivation }));

const { acceptCandidate, resendActivationLink } = await import('../actions');

beforeEach(() => {
  vi.clearAllMocks();
  state.user = { id: 'manager-1' };
  state.appRole = 'admin';
  state.officeRole = 'manager';
  process.env['NEXT_PUBLIC_STAFF_URL'] = 'https://staff.test';
  delete process.env['NEXT_PUBLIC_OFFICE_URL'];
});

describe('the activation link is never built on the Back Office itself', () => {
  const LINK_MISSING =
    'The activation link could not be built — set NEXT_PUBLIC_STAFF_URL for the Back Office.';

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env['NEXT_PUBLIC_OFFICE_URL'] = 'https://office.test';
  });

  it('Accept refuses before any login is minted when the staff origin is the office', async () => {
    process.env['NEXT_PUBLIC_STAFF_URL'] = 'https://office.test/';
    expect(await acceptCandidate('s1', ['r1'], '')).toEqual({ ok: false, message: LINK_MISSING });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(acceptWithAccount).not.toHaveBeenCalled();
  });

  it('Resend refuses the same way, whatever the case or slash', async () => {
    process.env['NEXT_PUBLIC_STAFF_URL'] = 'HTTPS://Office.test///';
    expect(await resendActivationLink('s1')).toEqual({ ok: false, message: LINK_MISSING });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(resendActivation).not.toHaveBeenCalled();
  });

  it('a Staff App origin different from the office goes through', async () => {
    expect(await acceptCandidate('s1', ['r1'], '')).toEqual({ ok: true });
    expect(acceptWithAccount).toHaveBeenCalledTimes(1);
  });
});

describe('Accept and Resend ask office_can("write") before the service key (ADR-0060)', () => {
  it('a manager reaches GoTrue', async () => {
    expect(await acceptCandidate('s1', ['r1'], '')).toEqual({ ok: true });
    expect(createAdminClient).toHaveBeenCalledTimes(1);
    expect(acceptWithAccount).toHaveBeenCalledTimes(1);
    expect(sessionRpc).toHaveBeenCalledWith('office_can', { p_perm: 'write' });
  });

  it('a viewer is refused with no login created', async () => {
    state.officeRole = 'viewer';
    expect(await acceptCandidate('s1', ['r1'], '')).toEqual({
      ok: false,
      message: 'Your login is read-only, so this cannot be changed.',
    });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(acceptWithAccount).not.toHaveBeenCalled();
  });

  it('a viewer cannot have an activation link minted either', async () => {
    state.officeRole = 'viewer';
    expect((await resendActivationLink('s1')).ok).toBe(false);
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(resendActivation).not.toHaveBeenCalled();
  });

  it('a switched-off login, one below aal2, or a worker gets the office refusal', async () => {
    state.appRole = null;
    state.officeRole = 'owner';
    expect(await acceptCandidate('s1', ['r1'], '')).toEqual({
      ok: false,
      message: 'Only the office can do this.',
    });
    state.appRole = 'staff';
    expect((await resendActivationLink('s1')).ok).toBe(false);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('nobody signed in reaches nothing', async () => {
    state.user = null;
    expect((await acceptCandidate('s1', ['r1'], '')).ok).toBe(false);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
