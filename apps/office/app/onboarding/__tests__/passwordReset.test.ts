import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ADR-0207 (TK-4): Send password reset. The caller may pass a staff id and
 * nothing else; the database answers with the login address, and the
 * email goes to that address, back to the Staff App's /auth/confirm. A
 * viewer, a missing Staff App origin and a missing service key are all
 * refused before the database is asked, so nothing is audited for them.
 */
const state = vi.hoisted(() => ({
  user: { id: 'manager-1' } as { id: string } | null,
  officeRole: 'manager' as string,
  request: {
    data: { staffId: 's1', email: 'rohan@reset.test', retryAfter: '10:42' },
    error: null,
  } as {
    data: { staffId?: string; email?: string; retryAfter?: string } | null;
    error: { message: string } | null;
  },
  allowed: true,
  sendError: null as { status: number; message: string } | null,
}));
const sessionRpc = vi.hoisted(() =>
  vi.fn(async (fn: string, _args?: unknown) => {
    if (fn === 'current_app_role') return { data: 'admin', error: null };
    if (fn === 'office_can') return { data: state.officeRole !== 'viewer', error: null };
    if (fn === 'onboarding_password_reset_request') return state.request;
    return { data: null, error: null };
  }),
);
const resetPasswordForEmail = vi.hoisted(() =>
  vi.fn(async (_email: string, _options: { redirectTo: string }) => ({ error: state.sendError })),
);
const createAdminClient = vi.hoisted(() => vi.fn(() => ({ auth: { resetPasswordForEmail } })));
const recoveryRequestAllowed = vi.hoisted(() => vi.fn(async (_email: string) => state.allowed));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('../../staff/data', () => ({ supabaseConfigured: () => true }));
vi.mock('@thc/db/admin', () => ({ createAdminClient }));
vi.mock('@thc/db/auth-throttle', () => ({ recoveryRequestAllowed }));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: sessionRpc,
  }),
}));

const { sendPasswordReset } = await import('../actions');

function asked(fn: string): boolean {
  return sessionRpc.mock.calls.some(([name]) => name === fn);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  state.user = { id: 'manager-1' };
  state.officeRole = 'manager';
  state.request = {
    data: { staffId: 's1', email: 'rohan@reset.test', retryAfter: '10:42' },
    error: null,
  };
  state.allowed = true;
  state.sendError = null;
  process.env['NEXT_PUBLIC_STAFF_URL'] = 'https://staff.test/';
  delete process.env['NEXT_PUBLIC_OFFICE_URL'];
});

describe('Send password reset (ADR-0207)', () => {
  it('sends the recovery email to the address the database returns, back to the Staff App', async () => {
    expect(await sendPasswordReset('s1')).toEqual({ ok: true });
    expect(sessionRpc).toHaveBeenCalledWith('onboarding_password_reset_request', { p_staff: 's1' });
    expect(recoveryRequestAllowed).toHaveBeenCalledWith('rohan@reset.test');
    expect(resetPasswordForEmail).toHaveBeenCalledWith('rohan@reset.test', {
      redirectTo: 'https://staff.test/auth/confirm',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/onboarding/s1');
    expect(revalidatePath).toHaveBeenCalledWith('/staff/s1');
  });

  it('refuses a viewer before the service key or the database request', async () => {
    state.officeRole = 'viewer';
    const result = await sendPasswordReset('s1');
    expect(result.ok).toBe(false);
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(asked('onboarding_password_reset_request')).toBe(false);
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('refuses when the Staff App origin is missing or is the Back Office, before anything is audited', async () => {
    process.env['NEXT_PUBLIC_OFFICE_URL'] = 'https://office.test';
    process.env['NEXT_PUBLIC_STAFF_URL'] = 'https://OFFICE.test/';
    const result = await sendPasswordReset('s1');
    expect(result.ok).toBe(false);
    expect(asked('onboarding_password_reset_request')).toBe(false);
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('refuses without the service key before the database request', async () => {
    createAdminClient.mockImplementationOnce(() => {
      throw new Error('no key');
    });
    const result = await sendPasswordReset('s1');
    expect(result.ok).toBe(false);
    expect(asked('onboarding_password_reset_request')).toBe(false);
  });

  it("explains the database's refusals in the office's words", async () => {
    state.request = { data: null, error: { message: 'not_activated' } };
    expect(await sendPasswordReset('s1')).toEqual({
      ok: false,
      message: 'This person has not set a password yet — use Resend activation link instead.',
    });
    state.request = { data: null, error: { message: 'reset_too_soon: 10:42' } };
    expect(await sendPasswordReset('s1')).toEqual({
      ok: false,
      message:
        'A password reset email was sent less than 10 minutes ago. You can send another after 10:42 (UK time).',
    });
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('says when to try again if the hourly limit stops the email, and sends nothing', async () => {
    state.allowed = false;
    const result = await sendPasswordReset('s1');
    expect(result).toEqual({
      ok: false,
      message:
        'Three password reset emails have already gone to this address in the last hour, so none was sent. Try again later — the earliest is after 10:42 (UK time).',
    });
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('never promises a retry sooner than the database allows when the send fails', async () => {
    state.sendError = { status: 429, message: 'rate limited' };
    expect(await sendPasswordReset('s1')).toEqual({
      ok: false,
      message:
        'The password reset email could not be sent. You can try again after 10:42 (UK time).',
    });
  });
});
