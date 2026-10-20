import { describe, expect, it, vi } from 'vitest';
import {
  bearerToken,
  isPublishableKey,
  isSecretKey,
  isServiceCaller,
  presentedKeys,
  projectRef,
  secretKeyDictionary,
  secretKeysFromEnv,
  serviceKeyFromEnv,
  unverifiedClaims,
} from '../service-caller';

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

/** A request's headers, as `isServiceCaller` reads them from Deno's `Request`. */
function headers(values: Record<string, string>) {
  return new Headers(values);
}

const SECRET = 'sb_secret_EdgeJobsKey0123456789abcdef';
const OTHER_SECRET = 'sb_secret_SomeOtherProject0123456789';
const PUBLISHABLE = 'sb_publishable_Default0123456789abcd';

describe('isServiceCaller with the new API keys (ADR-0165)', () => {
  it('pg_cron after the switch: an sb_secret_ key on apikey alone passes, without asking Auth', async () => {
    const confirm = vi.fn(async () => true);
    await expect(
      isServiceCaller(headers({ apikey: SECRET }), {
        expected: FUNCTION_KEY,
        secretKeys: [SECRET],
        ref: REF,
        confirm,
      }),
    ).resolves.toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('a caller that puts the secret key in a bearer is read too', async () => {
    await expect(
      isServiceCaller(headers({ Authorization: `Bearer ${SECRET}` }), {
        expected: undefined,
        secretKeys: ['sb_secret_another', SECRET],
        ref: REF,
        confirm: async () => false,
      }),
    ).resolves.toBe(true);
  });

  it("an sb_secret_ key that is not one of the function's own is refused, and never sent to Auth", async () => {
    const confirm = vi.fn(async () => true);
    for (const secretKeys of [[SECRET], [], undefined]) {
      await expect(
        isServiceCaller(
          headers({ apikey: OTHER_SECRET, Authorization: `Bearer ${OTHER_SECRET}` }),
          {
            expected: FUNCTION_KEY,
            secretKeys,
            ref: REF,
            confirm,
          },
        ),
      ).resolves.toBe(false);
    }
    expect(confirm).not.toHaveBeenCalled();
  });

  it('the publishable key is never a service caller', async () => {
    const confirm = vi.fn(async () => true);
    await expect(
      isServiceCaller(headers({ apikey: PUBLISHABLE, Authorization: `Bearer ${PUBLISHABLE}` }), {
        expected: FUNCTION_KEY,
        secretKeys: [SECRET],
        ref: REF,
        confirm,
      }),
    ).resolves.toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('pg_cron before the switch: the legacy JWT on apikey AND bearer passes as it always did', async () => {
    const both = headers({ apikey: FUNCTION_KEY, Authorization: `Bearer ${FUNCTION_KEY}` });
    await expect(
      isServiceCaller(both, {
        expected: FUNCTION_KEY,
        secretKeys: [SECRET],
        ref: REF,
        confirm: async () => false,
      }),
    ).resolves.toBe(true);

    // The 28.09 case — a different valid legacy key — still goes to Auth.
    const yes = vi.fn(async () => true);
    await expect(
      isServiceCaller(headers({ apikey: VAULT_KEY, Authorization: `Bearer ${VAULT_KEY}` }), {
        expected: FUNCTION_KEY,
        secretKeys: [SECRET],
        ref: REF,
        confirm: yes,
      }),
    ).resolves.toBe(true);
    expect(yes).toHaveBeenCalledTimes(1);
    expect(yes).toHaveBeenCalledWith(VAULT_KEY);
  });

  it('a user session in the bearer and the anon key on apikey (supabase-js from a browser) is refused', async () => {
    const confirm = vi.fn(async () => true);
    await expect(
      isServiceCaller(
        headers({
          apikey: jwt({ role: 'anon', ref: REF }),
          Authorization: `Bearer ${jwt({ role: 'authenticated', sub: 'u-1', ref: REF })}`,
        }),
        { expected: FUNCTION_KEY, secretKeys: [SECRET], ref: REF, confirm },
      ),
    ).resolves.toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('no credentials at all, or empty headers, is a refusal', async () => {
    const check = {
      expected: FUNCTION_KEY,
      secretKeys: [SECRET],
      ref: REF,
      confirm: async () => true,
    };
    await expect(isServiceCaller(headers({}), check)).resolves.toBe(false);
    await expect(
      isServiceCaller(headers({ apikey: '  ', Authorization: 'Bearer ' }), check),
    ).resolves.toBe(false);
  });

  it("empty strings in the function's own key list match nothing", async () => {
    await expect(
      isServiceCaller(headers({ apikey: 'x' }), {
        expected: '',
        secretKeys: [''],
        ref: REF,
        confirm: async () => false,
      }),
    ).resolves.toBe(false);
  });
});

describe('the keys a function holds', () => {
  const env =
    (values: Record<string, string>) =>
    (name: string): string | undefined =>
      values[name];

  it('secretKeysFromEnv reads the injected dictionary and the CLI single key', () => {
    expect(
      secretKeysFromEnv(
        env({
          SUPABASE_SECRET_KEYS: JSON.stringify({
            default: SECRET,
            automations: OTHER_SECRET,
            bad: 3,
          }),
          SUPABASE_SECRET_KEY: SECRET,
        }),
      ),
    ).toEqual([SECRET, OTHER_SECRET]);
  });

  it('a malformed or missing dictionary is empty, never a throw', () => {
    expect(secretKeysFromEnv(env({}))).toEqual([]);
    expect(secretKeysFromEnv(env({ SUPABASE_SECRET_KEYS: '{not json' }))).toEqual([]);
    expect(secretKeysFromEnv(env({ SUPABASE_SECRET_KEYS: '["sb_secret_x"]' }))).toEqual([]);
    expect(secretKeyDictionary(env({ SUPABASE_SECRET_KEYS: 'null' }))).toEqual({});
  });

  it('serviceKeyFromEnv keeps the legacy key until the owner names a new one', () => {
    const both = {
      SUPABASE_SERVICE_ROLE_KEY: FUNCTION_KEY,
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET, 'edge-jobs': OTHER_SECRET }),
    };
    expect(serviceKeyFromEnv(env(both))).toEqual({
      ok: true,
      key: FUNCTION_KEY,
      source: 'SUPABASE_SERVICE_ROLE_KEY',
    });
    expect(serviceKeyFromEnv(env({ ...both, THC_SECRET_KEY_NAME: 'edge-jobs' }))).toEqual({
      ok: true,
      key: OTHER_SECRET,
      source: 'SUPABASE_SECRET_KEYS.edge-jobs',
    });
  });

  it('a named key that is not there is a loud error, never a silent fall back to the legacy key', () => {
    const choice = serviceKeyFromEnv(
      env({
        THC_SECRET_KEY_NAME: 'edge-jobs',
        SUPABASE_SERVICE_ROLE_KEY: FUNCTION_KEY,
        SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET }),
      }),
    );
    expect(choice.ok).toBe(false);
    expect(choice.ok ? '' : choice.error).toMatch(/edge-jobs.*default/);
  });

  it('with no legacy key at all, the default secret key, then the CLI single key', () => {
    expect(
      serviceKeyFromEnv(env({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET }) })),
    ).toMatchObject({ ok: true, key: SECRET, source: 'SUPABASE_SECRET_KEYS.default' });
    expect(serviceKeyFromEnv(env({ SUPABASE_SECRET_KEY: SECRET }))).toMatchObject({
      ok: true,
      key: SECRET,
      source: 'SUPABASE_SECRET_KEY',
    });
    expect(serviceKeyFromEnv(env({})).ok).toBe(false);
  });
});

describe('helpers', () => {
  it('presentedKeys reads both headers, once each, and a bare string as Authorization', () => {
    expect(presentedKeys(headers({ apikey: SECRET, Authorization: `Bearer ${SECRET}` }))).toEqual([
      SECRET,
    ]);
    expect(
      presentedKeys(headers({ apikey: SECRET, Authorization: `Bearer ${FUNCTION_KEY}` })),
    ).toEqual([FUNCTION_KEY, SECRET]);
    expect(presentedKeys(`Bearer ${FUNCTION_KEY}`)).toEqual([FUNCTION_KEY]);
    expect(presentedKeys(null)).toEqual([]);
  });

  it('key forms', () => {
    expect(isSecretKey(SECRET)).toBe(true);
    expect(isSecretKey(PUBLISHABLE)).toBe(false);
    expect(isSecretKey(FUNCTION_KEY)).toBe(false);
    expect(isSecretKey('sb_secret_')).toBe(false);
    expect(isPublishableKey(PUBLISHABLE)).toBe(true);
    expect(isPublishableKey(SECRET)).toBe(false);
  });

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
