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
const storedMedia = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => 'match'));

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../../_lib/stored-media', () => ({
  checkStoredMedia: (...args: unknown[]) => storedMedia(...args),
}));
vi.mock('../../db', () => ({
  staffDb: () => ({ auth, rpc }),
  supabaseConfigured: () => true,
}));

const { changePassword, finishPhotoUpload, requestEmailChange, requestP45, saveBankDetails } =
  await import('../actions');

beforeEach(() => {
  vi.clearAllMocks();
  auth.getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'tom.reid@example.com' } } });
  auth.signInWithPassword.mockResolvedValue({ error: null });
  auth.updateUser.mockResolvedValue({ error: null });
  rpc.mockResolvedValue({ data: { ok: true }, error: null });
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
    const out = await requestP45('Leaving', 'Correct-horse-1');
    expect(out).toEqual({
      ok: false,
      message:
        'Your account is on hold. Please contact the office at: admin@thehospitalitycompany.co.uk',
    });
  });
});

/**
 * ADR-0113 (security round 12.10, item 1): a stolen phone that is still
 * signed in cannot change bank details, request a P45 or move the email
 * address. Each re-checks the current password against the SESSION's
 * address — the same step changePassword makes — immediately before the
 * write, and the write never happens when the password is wrong.
 */
describe('the current-password step in front of bank, P45 and email (ADR-0113)', () => {
  const writes = [
    {
      name: 'saveBankDetails',
      run: (password: string) => saveBankDetails('A Kalu', '40-47-84', '31926819', password),
      wrote: () => rpc.mock.calls.some(([fn]) => fn === 'staff_save_bank'),
    },
    {
      name: 'requestP45',
      run: (password: string) => requestP45('Moving away', password),
      wrote: () => rpc.mock.calls.some(([fn]) => fn === 'request_my_p45'),
    },
    {
      name: 'requestEmailChange',
      run: (password: string) => requestEmailChange('amara.new@example.com', password),
      wrote: () => auth.updateUser.mock.calls.length > 0,
    },
  ];

  for (const write of writes) {
    it(`${write.name}: a wrong current password writes nothing`, async () => {
      auth.signInWithPassword.mockResolvedValue({
        error: { message: 'Invalid login credentials' },
      });
      const out = await write.run('wrong');
      expect(out).toEqual({ ok: false, message: 'That current password isn’t right.' });
      expect(write.wrote()).toBe(false);
    });

    it(`${write.name}: no password typed, no sign-in attempt and no write`, async () => {
      const out = await write.run('');
      expect(out.ok).toBe(false);
      expect(auth.signInWithPassword).not.toHaveBeenCalled();
      expect(write.wrote()).toBe(false);
    });

    it(`${write.name}: the right password signs in as the session's account, then writes`, async () => {
      const out = await write.run('Correct-horse-1');
      expect(out.ok).toBe(true);
      expect(auth.signInWithPassword).toHaveBeenCalledWith({
        email: 'tom.reid@example.com',
        password: 'Correct-horse-1',
      });
      expect(write.wrote()).toBe(true);
      // Immediately before: the sign-in comes first.
      const signIn = auth.signInWithPassword.mock.invocationCallOrder[0]!;
      const writeOrder =
        write.name === 'requestEmailChange'
          ? auth.updateUser.mock.invocationCallOrder[0]!
          : rpc.mock.invocationCallOrder[rpc.mock.calls.length - 1]!;
      expect(signIn).toBeLessThan(writeOrder);
    });
  }

  it('the database’s reauth_required reads as a sentence, never the code', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'reauth_required' } });
    const bank = await saveBankDetails('A Kalu', '40-47-84', '31926819', 'Correct-horse-1');
    expect(bank).toEqual({
      ok: false,
      message: 'For your security, please enter your current password again.',
    });
    const p45 = await requestP45('', 'Correct-horse-1');
    expect(p45).toEqual(bank);
  });

  it('with no session there is nothing to re-check, and nothing is written', async () => {
    auth.getUser.mockResolvedValue({ data: { user: null } });
    const out = await saveBankDetails('A Kalu', '40-47-84', '31926819', 'Correct-horse-1');
    expect(out.ok).toBe(false);
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

/** Security round 12.10, item 4: a refusal nobody mapped is not shown raw. */
describe('unmapped refusals', () => {
  it('a raw database error becomes the generic line and is logged on the server', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'duplicate key value violates unique constraint "staff_bank_pkey"' },
    });
    const out = await saveBankDetails('A Kalu', '40-47-84', '31926819', 'Correct-horse-1');
    expect(out).toEqual({ ok: false, message: 'That didn’t go through. Please try again.' });
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

/** Security round 12.10, item 5: the selfie's stored bytes must be a JPEG. */
describe('finishPhotoUpload', () => {
  it('reads the photo back through the worker’s own session and sets a real JPEG', async () => {
    storedMedia.mockResolvedValue('match');
    const out = await finishPhotoUpload('s1/selfie-1.jpg');
    expect(out.ok).toBe(true);
    expect(storedMedia).toHaveBeenCalledWith(expect.anything(), 'photos', 's1/selfie-1.jpg');
    expect(rpc).toHaveBeenCalledWith('staff_set_photo', { p_path: 's1/selfie-1.jpg' });
  });

  it('bytes that are not a JPEG are never set', async () => {
    storedMedia.mockResolvedValue('mismatch');
    const out = await finishPhotoUpload('s1/selfie-1.jpg');
    expect(out).toEqual({
      ok: false,
      message: 'That photo didn’t come through as a picture. Please take it again.',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('a photo that cannot be read is never set', async () => {
    storedMedia.mockResolvedValue('unreadable');
    expect((await finishPhotoUpload('s1/selfie-1.jpg')).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
