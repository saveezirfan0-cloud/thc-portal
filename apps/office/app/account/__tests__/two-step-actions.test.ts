import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * /account — two-step sign-in (ADR-0051), with GoTrue's MFA API mocked.
 *
 *   startTwoStepSetup    clears an abandoned set-up, then enrolls a TOTP
 *                        factor named after the phone, issuer THC Back Office
 *   confirmTwoStepSetup  the first code is what turns it on
 *   cancelTwoStepSetup   removes an UNVERIFIED factor only
 *   removeTwoStep        a fresh code first, and only then unenroll
 */
const mfa = vi.hoisted(() => ({
  enroll: vi.fn(),
  challengeAndVerify: vi.fn(),
  unenroll: vi.fn(),
}));
const state = vi.hoisted(() => ({ factors: [] as unknown[], signedIn: true }));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({
        data: { user: state.signedIn ? { id: 'u1', factors: state.factors } : null },
      }),
      mfa,
    },
  }),
}));

const { cancelTwoStepSetup, confirmTwoStepSetup, removeTwoStep, startTwoStepSetup } =
  await import('../two-step-actions');
const { twoStepOf } = await import('../data');

const factor = (id: string, status: string) => ({
  id,
  factor_type: 'totp',
  status,
  friendly_name: 'My phone',
  created_at: '2026-09-25T09:00:00Z',
});

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
  state.factors = [];
  state.signedIn = true;
  mfa.enroll.mockResolvedValue({
    data: {
      id: 'new-factor',
      type: 'totp',
      totp: { qr_code: 'data:image/svg+xml;utf-8,<svg/>', secret: 'JBSWY3DP', uri: 'otpauth://' },
    },
    error: null,
  });
  mfa.challengeAndVerify.mockResolvedValue({ data: {}, error: null });
  mfa.unenroll.mockResolvedValue({ data: { id: 'x' }, error: null });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('startTwoStepSetup', () => {
  it('enrolls a TOTP factor named after the phone and hands back the QR code and key', async () => {
    const result = await startTwoStepSetup('  Gisela’s iPhone ');
    expect(mfa.enroll).toHaveBeenCalledWith({
      factorType: 'totp',
      friendlyName: 'Gisela’s iPhone',
      issuer: 'THC Back Office',
    });
    expect(result).toEqual({
      ok: true,
      factorId: 'new-factor',
      qrCode: 'data:image/svg+xml;utf-8,<svg/>',
      secret: 'JBSWY3DP',
    });
  });

  it('clears an abandoned set-up first, and nothing verified', async () => {
    state.factors = [factor('stale', 'unverified')];
    await startTwoStepSetup('My phone');
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: 'stale' });
    expect(mfa.unenroll.mock.invocationCallOrder[0]).toBeLessThan(
      mfa.enroll.mock.invocationCallOrder[0]!,
    );
  });

  it('refuses when two-step is already on', async () => {
    state.factors = [factor('live', 'verified')];
    expect(await startTwoStepSetup('My phone')).toEqual({
      ok: false,
      message: 'Two-step sign-in is already on for your login.',
    });
    expect(mfa.enroll).not.toHaveBeenCalled();
    expect(mfa.unenroll).not.toHaveBeenCalled();
  });

  it('needs a name for the phone', async () => {
    expect((await startTwoStepSetup('   ')).ok).toBe(false);
    expect(mfa.enroll).not.toHaveBeenCalled();
  });

  it('says so when the project has TOTP switched off', async () => {
    mfa.enroll.mockResolvedValue({
      data: null,
      error: { status: 422, code: 'mfa_totp_enroll_not_enabled', message: 'disabled' },
    });
    const result = await startTwoStepSetup('My phone');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(/switched off for this project/);
  });
});

describe('confirmTwoStepSetup', () => {
  it('checks the code format before GoTrue', async () => {
    expect(await confirmTwoStepSetup({ factorId: 'new-factor', code: '12' })).toEqual({
      ok: false,
      message: 'The code is 6 digits long. Check you have all of them.',
    });
    expect(mfa.challengeAndVerify).not.toHaveBeenCalled();
  });

  it('the first correct code turns it on', async () => {
    const result = await confirmTwoStepSetup({ factorId: 'new-factor', code: '123 456' });
    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({
      factorId: 'new-factor',
      code: '123456',
    });
    expect(result.ok).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith('/account');
  });

  it('a wrong code leaves it off', async () => {
    mfa.challengeAndVerify.mockResolvedValue({
      data: null,
      error: { status: 422, code: 'mfa_verification_failed', message: 'Invalid TOTP code' },
    });
    const result = await confirmTwoStepSetup({ factorId: 'new-factor', code: '000000' });
    expect(result.ok).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('cancelTwoStepSetup', () => {
  it('removes the unfinished set-up', async () => {
    state.factors = [factor('pending', 'unverified')];
    await cancelTwoStepSetup('pending');
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: 'pending' });
  });

  it('is not a way round the fresh code: a verified factor is left alone', async () => {
    state.factors = [factor('live', 'verified')];
    expect(await cancelTwoStepSetup('live')).toEqual({ ok: true });
    expect(mfa.unenroll).not.toHaveBeenCalled();
  });
});

describe('removeTwoStep', () => {
  beforeEach(() => {
    state.factors = [factor('live', 'verified')];
  });

  it('verifies a fresh code, then unenrolls', async () => {
    const result = await removeTwoStep('654 321');
    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'live', code: '654321' });
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: 'live' });
    expect(mfa.challengeAndVerify.mock.invocationCallOrder[0]).toBeLessThan(
      mfa.unenroll.mock.invocationCallOrder[0]!,
    );
    expect(result.ok).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith('/account');
  });

  it('a wrong code removes nothing', async () => {
    mfa.challengeAndVerify.mockResolvedValue({
      data: null,
      error: { status: 422, code: 'mfa_verification_failed', message: 'Invalid TOTP code' },
    });
    const result = await removeTwoStep('000000');
    expect(result.ok).toBe(false);
    expect(mfa.unenroll).not.toHaveBeenCalled();
  });

  it('no code, no call', async () => {
    expect((await removeTwoStep('')).ok).toBe(false);
    expect(mfa.challengeAndVerify).not.toHaveBeenCalled();
    expect(mfa.unenroll).not.toHaveBeenCalled();
  });

  it('a signed-out session is told so', async () => {
    state.signedIn = false;
    expect(await removeTwoStep('123456')).toEqual({
      ok: false,
      message: 'Your session has ended. Sign in again.',
    });
  });
});

describe('twoStepOf — what /account shows', () => {
  it('off with no verified authenticator', () => {
    expect(twoStepOf([factor('p', 'unverified')])).toEqual({
      on: false,
      deviceName: null,
      since: null,
    });
  });

  it('on, with the phone name and the set-up date', () => {
    expect(twoStepOf([factor('live', 'verified')])).toEqual({
      on: true,
      deviceName: 'My phone',
      since: '2026-09-25T09:00:00Z',
    });
  });
});
