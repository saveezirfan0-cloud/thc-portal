import { describe, expect, it, vi } from 'vitest';
import { bearerToken, isServiceCaller, projectRef, unverifiedClaims } from '../service-caller';

/**
 * Who may run a §7 job (supabase/functions/_shared/job.ts). The live
 * project's pg_cron key and the functions' own key are both valid service
 * keys and still differ (28.09), so an exact match is the fast path and
 * Supabase Auth decides the rest.
 */
function jwt(claims: Record<string, unknown>): string {
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.signature-not-checked-here`;
}

const REF = 'dgxtqvalfiisfpbwodew';
const FUNCTION_KEY = jwt({ role: 'service_role', ref: REF, iat: 1 });
const VAULT_KEY = jwt({ role: 'service_role', ref: REF, iat: 2 });

describe('isServiceCaller', () => {
  it("the function's own key passes without asking Auth", async () => {
    const confirm = vi.fn(async () => false);
    await expect(
      isServiceCaller(`Bearer ${FUNCTION_KEY}`, { expected: FUNCTION_KEY, ref: REF, confirm }),
    ).resolves.toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('a different service key for this project passes only if Auth confirms it', async () => {
    const yes = vi.fn(async () => true);
    await expect(
      isServiceCaller(`Bearer ${VAULT_KEY}`, { expected: FUNCTION_KEY, ref: REF, confirm: yes }),
    ).resolves.toBe(true);
    expect(yes).toHaveBeenCalledWith(VAULT_KEY);

    const no = vi.fn(async () => false);
    await expect(
      isServiceCaller(`Bearer ${VAULT_KEY}`, { expected: FUNCTION_KEY, ref: REF, confirm: no }),
    ).resolves.toBe(false);
  });

  it('anon, user and other-project tokens are refused without asking Auth', async () => {
    const confirm = vi.fn(async () => true);
    const check = { expected: FUNCTION_KEY, ref: REF, confirm };
    for (const token of [
      jwt({ role: 'anon', ref: REF }),
      jwt({ role: 'authenticated', sub: 'u-1' }),
      jwt({ role: 'service_role', ref: 'someoneelse' }),
      jwt({ role: 'service_role' }),
      'sb_secret_not_a_jwt',
      'garbage',
    ]) {
      await expect(isServiceCaller(`Bearer ${token}`, check)).resolves.toBe(false);
    }
    expect(confirm).not.toHaveBeenCalled();
  });

  it('no header, no bearer, or an Auth error is a refusal', async () => {
    const confirm = vi.fn(async () => {
      throw new Error('network');
    });
    const check = { expected: FUNCTION_KEY, ref: REF, confirm };
    await expect(isServiceCaller(null, check)).resolves.toBe(false);
    await expect(isServiceCaller(FUNCTION_KEY, check)).resolves.toBe(false);
    await expect(isServiceCaller('Bearer ', check)).resolves.toBe(false);
    await expect(isServiceCaller(`Bearer ${VAULT_KEY}`, check)).resolves.toBe(false);
  });

  it('with no key of its own the function still defers to Auth', async () => {
    await expect(
      isServiceCaller(`Bearer ${VAULT_KEY}`, {
        expected: undefined,
        ref: REF,
        confirm: async () => true,
      }),
    ).resolves.toBe(true);
  });
});

describe('helpers', () => {
  it('bearerToken', () => {
    expect(bearerToken('Bearer abc')).toBe('abc');
    expect(bearerToken('bearer abc')).toBe('');
    expect(bearerToken(null)).toBe('');
  });

  it('unverifiedClaims reads a payload and rejects non-JWTs', () => {
    expect(unverifiedClaims(VAULT_KEY)).toMatchObject({ role: 'service_role', ref: REF });
    expect(unverifiedClaims('a.b')).toBeNull();
    expect(unverifiedClaims('a.!!!.c')).toBeNull();
    expect(unverifiedClaims(`a.${Buffer.from('[1]').toString('base64url')}.c`)).toBeNull();
  });

  it('projectRef takes the ref from a hosted URL only', () => {
    expect(projectRef(`https://${REF}.supabase.co`)).toBe(REF);
    expect(projectRef('http://127.0.0.1:54321')).toBeNull();
    expect(projectRef(undefined)).toBeNull();
  });
});
