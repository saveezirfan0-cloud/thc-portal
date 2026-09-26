import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * §10.1 Security settings and §10.6 — the two profile actions whose
 * behaviour is a call, not a sentence (audit D51, D52).
 *
 *   changePassword  re-checks the current password against the SESSION's
 *                   address, never the one the browser sent;
 *   requestP45      a manual block is refused by the database with
 *                   `blocked_manual`, and the worker reads the on-hold line.
 */
const auth = vi.hoisted(() => ({
  getUser: vi.fn(),
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
}));
const rpc = vi.hoisted(() => vi.fn());

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../../db', () => ({
  staffDb: () => ({ auth, rpc }),
  supabaseConfigured: () => true,
}));

const { changePassword, requestP45 } = await import('../actions');

beforeEach(() => {
  vi.clearAllMocks();
  auth.getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'tom.reid@example.com' } } });
  auth.signInWithPassword.mockResolvedValue({ error: null });
  auth.updateUser.mockResolvedValue({ error: null });
});

describe('changePassword (§10.1)', () => {
  it('checks the current password against the signed-in account, whatever address the form sent', async () => {
    const out = await changePassword(
      'someone.else@example.com',
      'Old-password-1',
      'New-password-22',
    );
    expect(out).toEqual({ ok: true, note: 'Password updated.' });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'tom.reid@example.com',
      password: 'Old-password-1',
    });
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'New-password-22' });
  });

  it('with no session there is nothing to change', async () => {
    auth.getUser.mockResolvedValue({ data: { user: null } });
    const out = await changePassword('tom.reid@example.com', 'Old-password-1', 'New-password-22');
    expect(out.ok).toBe(false);
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('a wrong current password changes nothing', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    const out = await changePassword('', 'wrong', 'New-password-22');
    expect(out).toEqual({ ok: false, message: 'That current password isn’t right.' });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
});

describe('requestP45 (§10.6, §10.1 lock case 2)', () => {
  it('a manual block is refused with the on-hold line, never the manager’s reason', async () => {
    rpc.mockResolvedValue({ error: { message: 'blocked_manual' } });
    const out = await requestP45('Leaving');
    expect(out).toEqual({
      ok: false,
      message:
        'Your account is on hold. Please contact the office at: admin@thehospitalitycompany.co.uk',
    });
  });
});
