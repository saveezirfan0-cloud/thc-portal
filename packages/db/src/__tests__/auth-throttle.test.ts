import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The per-account throttle (packages/db/src/auth-throttle.ts) against a
 * mocked service-role client: the keys it sends, a definite `false`
 * honoured, an error failing OPEN.
 */
const rpc = vi.hoisted(() => vi.fn());
// The build-time fence throws outside a react-server build (server-only.test.ts).
vi.mock('server-only', () => ({}));
vi.mock('../admin', () => ({ createAdminClient: () => ({ rpc }) }));

const {
  authAttemptAllowed,
  callerIp,
  emailKey,
  ipKey,
  isCredentialFailure,
  recordAuthAttempt,
  recoveryRequestAllowed,
  signInKeys,
  userKey,
} = await import('../auth-throttle');

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

beforeEach(() => {
  rpc.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('keys', () => {
  it('lowercase hex sha256 of the normalised email, of ip:<addr>, of the user id', async () => {
    expect(await emailKey('  Gisela@THC.Example ')).toBe(sha('gisela@thc.example'));
    expect(await ipKey('203.0.113.9')).toBe(sha('ip:203.0.113.9'));
    expect(await userKey('u-1')).toBe(sha('u-1'));
    expect(await emailKey('a@b.c')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a sign-in counts under the account and, when known, the address', async () => {
    expect(await signInKeys('a@b.c', '198.51.100.1')).toEqual([
      sha('a@b.c'),
      sha('ip:198.51.100.1'),
    ]);
    expect(await signInKeys('a@b.c', null)).toEqual([sha('a@b.c')]);
  });
});

describe('callerIp', () => {
  const h = (values: Record<string, string>) => ({ get: (n: string) => values[n] ?? null });

  it("prefers Vercel's own header, then the first x-forwarded-for entry", () => {
    expect(callerIp(h({ 'x-vercel-forwarded-for': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' }))).toBe(
      '1.1.1.1',
    );
    expect(callerIp(h({ 'x-forwarded-for': ' 3.3.3.3 , 10.0.0.1' }))).toBe('3.3.3.3');
    expect(callerIp(h({}))).toBeNull();
    expect(callerIp(null)).toBeNull();
  });
});

describe('authAttemptAllowed', () => {
  it('asks once per key with the contract arguments', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await authAttemptAllowed('sign_in', ['k1', 'k2'])).toBe(true);
    expect(rpc).toHaveBeenCalledWith('auth_attempt_allowed', {
      p_kind: 'sign_in',
      p_key_hash: 'k1',
    });
    expect(rpc).toHaveBeenCalledWith('auth_attempt_allowed', {
      p_kind: 'sign_in',
      p_key_hash: 'k2',
    });
  });

  it('one definite false refuses', async () => {
    rpc.mockImplementation(async (_fn: string, args: { p_key_hash: string }) => ({
      data: args.p_key_hash !== 'ip',
      error: null,
    }));
    expect(await authAttemptAllowed('sign_in', ['email', 'ip'])).toBe(false);
  });

  it('fails OPEN on an RPC error, and says so in the log', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'function does not exist' } });
    expect(await authAttemptAllowed('verify', ['k'])).toBe(true);
    expect(console.error).toHaveBeenCalled();
  });

  it('fails OPEN when the admin client cannot even be made', async () => {
    rpc.mockRejectedValue(new Error('Missing SUPABASE_SERVICE_ROLE_KEY'));
    expect(await authAttemptAllowed('recover', ['k'])).toBe(true);
  });
});

describe('recordAuthAttempt', () => {
  it('records every key, and never throws', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await recordAuthAttempt('sign_in', ['a', 'b'], true);
    expect(rpc).toHaveBeenCalledWith('record_auth_attempt', {
      p_kind: 'sign_in',
      p_key_hash: 'a',
      p_failed: true,
    });
    expect(rpc).toHaveBeenCalledTimes(2);
    rpc.mockRejectedValue(new Error('down'));
    await expect(recordAuthAttempt('sign_in', ['a'], true)).resolves.toBeUndefined();
  });
});

describe('recoveryRequestAllowed', () => {
  it('allowed: the request is counted, then let through', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await recoveryRequestAllowed('A@B.c')).toBe(true);
    expect(rpc).toHaveBeenLastCalledWith('record_auth_attempt', {
      p_kind: 'recover',
      p_key_hash: sha('a@b.c'),
      p_failed: true,
    });
  });

  it('refused: nothing more is recorded', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await recoveryRequestAllowed('a@b.c')).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe('isCredentialFailure', () => {
  it('a wrong password counts; an outage or GoTrue’s own 429 does not', () => {
    expect(isCredentialFailure({ status: 400, code: 'invalid_credentials' })).toBe(true);
    expect(isCredentialFailure({ status: 400 })).toBe(true);
    expect(isCredentialFailure({ status: 429, code: 'over_request_rate_limit' })).toBe(false);
    expect(isCredentialFailure({ status: 500 })).toBe(false);
    expect(isCredentialFailure({})).toBe(false);
    expect(isCredentialFailure(null)).toBe(false);
  });
});
