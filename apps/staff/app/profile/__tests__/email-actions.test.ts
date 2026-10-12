import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The two halves of the email change (§10.1, §8 E7), with the Supabase
 * client mocked: "a new email is verified via a confirmation code before it
 * replaces the old one".
 *
 *   requestEmailChange   validates, normalises, and asks Auth to send the
 *                        code to the NEW address; nothing on `staff` moves.
 *   confirmEmailChange   verifies the code as an `email_change` OTP and
 *                        only THEN calls staff_sync_email(), which is what
 *                        moves staff.email and queues E7 (330 pins the SQL).
 */
const auth = vi.hoisted(() => ({
  getUser: vi.fn(),
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
  verifyOtp: vi.fn(),
}));
const rpc = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ auth, rpc }) }));

const { confirmEmailChange, requestEmailChange } = await import('../actions');

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
  auth.getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'amara@example.com' } } });
  auth.signInWithPassword.mockResolvedValue({ error: null });
  auth.updateUser.mockResolvedValue({ error: null });
  auth.verifyOtp.mockResolvedValue({ error: null });
  rpc.mockResolvedValue({ data: { ok: true, changed: true }, error: null });
});

describe('requestEmailChange — step one', () => {
  it('refuses an address that is not one, without asking Auth', async () => {
    const result = await requestEmailChange('not an email', 'Correct-horse-1');
    expect(result).toEqual({ ok: false, message: 'Please enter a valid email address.' });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('normalises the address and sends the code to it; the old one stays', async () => {
    const result = await requestEmailChange('  Amara.New@Example.COM ', 'Correct-horse-1');
    expect(auth.updateUser).toHaveBeenCalledWith({ email: 'amara.new@example.com' });
    expect(result.ok).toBe(true);
    expect(result.ok && result.note).toContain('We sent a 6-digit code to amara.new@example.com');
    expect(result.ok && result.note).toContain('Your current email stays in place');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('a rate limit reads as a sentence', async () => {
    auth.updateUser.mockResolvedValue({
      error: { code: 'over_email_send_rate_limit', message: 'Email rate limit exceeded' },
    });
    expect(await requestEmailChange('a@b.co', 'Correct-horse-1')).toEqual({
      ok: false,
      message: 'Too many codes have been asked for. Please wait a few minutes and try again.',
    });
  });

  it('an address already on another account gets the same answer as a free one (no enumeration)', async () => {
    const free = await requestEmailChange('taken@example.com', 'Correct-horse-1');
    auth.updateUser.mockResolvedValue({
      error: {
        code: 'email_exists',
        message: 'A user with this email address has already been registered',
      },
    });
    const taken = await requestEmailChange('taken@example.com', 'Correct-horse-1');
    expect(taken).toEqual(free);
    auth.updateUser.mockResolvedValue({
      error: { message: 'A user with this email address has already been registered' },
    });
    expect(await requestEmailChange('taken@example.com', 'Correct-horse-1')).toEqual(free);
  });

  it('any other Auth refusal is the generic line, never Auth’s wording', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    auth.updateUser.mockResolvedValue({
      error: { code: 'unexpected_failure', message: 'Database error saving new user' },
    });
    expect(await requestEmailChange('a@b.co', 'Correct-horse-1')).toEqual({
      ok: false,
      message: 'That didn’t go through. Please try again.',
    });
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

describe('confirmEmailChange — step two', () => {
  it('verifies the code as an email_change OTP and only then syncs staff.email', async () => {
    const result = await confirmEmailChange(' Amara.New@Example.com ', ' 123456 ');
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      email: 'amara.new@example.com',
      token: '123456',
      type: 'email_change',
    });
    expect(rpc).toHaveBeenCalledWith('staff_sync_email', {});
    expect(auth.verifyOtp.mock.invocationCallOrder[0]).toBeLessThan(
      rpc.mock.invocationCallOrder[0]!,
    );
    expect(result).toEqual({ ok: true, note: 'Your email address has been updated.' });
    expect(revalidatePath).toHaveBeenCalledWith('/profile/details');
  });

  it('a wrong or expired code stops everything: no sync, no E7', async () => {
    auth.verifyOtp.mockResolvedValue({ error: { message: 'Token has expired or is invalid' } });
    const result = await confirmEmailChange('amara.new@example.com', '000000');
    expect(result).toEqual({
      ok: false,
      message: 'That code didn’t match, or it has expired. Ask for a new one and try again.',
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('maps the RPC’s reason code to a sentence', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'unknown_staff' } });
    const result = await confirmEmailChange('amara.new@example.com', '123456');
    expect(result).toEqual({
      ok: false,
      message: 'We couldn’t find your record. Please contact the office.',
    });
  });
});
