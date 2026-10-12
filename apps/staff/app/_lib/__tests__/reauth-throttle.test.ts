import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The current-password step (ADR-0113) counts under the sign-in form's
 * per-account limit: a stolen session cannot guess the password here any
 * faster than at /login (security round 12.10, QA).
 */
const throttle = vi.hoisted(() => ({
  allowed: vi.fn(async (_email: string) => true),
  record: vi.fn(async (_email: string) => {}),
}));
vi.mock('server-only', () => ({}));
vi.mock('@thc/db/auth-throttle', () => ({
  currentPasswordCheckAllowed: throttle.allowed,
  recordCurrentPasswordFailure: throttle.record,
}));

const { confirmCurrentPassword, TOO_MANY_TRIES, WRONG_PASSWORD } = await import('../reauth');

const signIn = vi.fn();
const supabase = {
  auth: {
    getUser: async () => ({ data: { user: { email: 'tom@example.com' } } }),
    signInWithPassword: signIn,
  },
} as unknown as Parameters<typeof confirmCurrentPassword>[0];

beforeEach(() => {
  vi.clearAllMocks();
  throttle.allowed.mockResolvedValue(true);
});

describe('confirmCurrentPassword is throttled per account', () => {
  it('over the limit: no sign-in is tried', async () => {
    throttle.allowed.mockResolvedValueOnce(false);
    expect(await confirmCurrentPassword(supabase, 'guess')).toBe(TOO_MANY_TRIES);
    expect(signIn).not.toHaveBeenCalled();
  });

  it('a wrong password is counted against the session’s own address', async () => {
    signIn.mockResolvedValueOnce({ error: { message: 'Invalid login credentials' } });
    expect(await confirmCurrentPassword(supabase, 'guess')).toBe(WRONG_PASSWORD);
    expect(throttle.record).toHaveBeenCalledWith('tom@example.com');
  });

  it('the right password is not counted', async () => {
    signIn.mockResolvedValueOnce({ error: null });
    expect(await confirmCurrentPassword(supabase, 'right')).toBeNull();
    expect(throttle.record).not.toHaveBeenCalled();
  });
});
