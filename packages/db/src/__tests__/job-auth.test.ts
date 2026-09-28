import { describe, expect, it } from 'vitest';
import {
  VERIFIED_TTL_MS,
  claimsWorthChecking,
  holdsServiceRole,
  matchesAnyKey,
  presentedToken,
  projectRef,
  serviceKeys,
  unverifiedClaims,
} from '../job-auth';
import type { Fetcher, ServiceRoleCheckDeps } from '../job-auth';

/**
 * The job endpoints (supabase/functions/_shared/job.ts) refused every
 * pg_cron call on 28.09.2026: the vault's legacy service_role JWT was
 * compared byte for byte with an injected SUPABASE_SERVICE_ROLE_KEY that
 * was a different string. No job ran, no Willo invite, no email. These
 * pin the replacement: any injected key, or a token Auth confirms.
 */
const REF = 'dgxtqvalfiisfpbwodew';
const URL_ = `https://${REF}.supabase.co`;
const NOW_MS = Date.UTC(2026, 8, 28, 12, 0, 0);

function b64url(value: object): string {
  return Buffer.from(JSON.stringify(value))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function jwt(claims: Record<string, unknown>, signature = 'sig'): string {
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(claims)}.${signature}`;
}

const SERVICE_JWT = jwt({ iss: 'supabase', ref: REF, role: 'service_role', exp: 2105331740 });
const ANON_JWT = jwt({ iss: 'supabase', ref: REF, role: 'anon', exp: 2105331740 });

function headers(values: Record<string, string>) {
  const lower = Object.fromEntries(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name: string) => lower[name.toLowerCase()] ?? null };
}

function deps(
  vars: Record<string, string>,
  status = 200,
  over: Partial<ServiceRoleCheckDeps> = {},
): ServiceRoleCheckDeps & { calls: string[] } {
  const calls: string[] = [];
  const fetch: Fetcher = async (url) => {
    calls.push(url);
    return { status, body: null };
  };
  return {
    env: (name) => vars[name],
    fetch,
    nowMs: () => NOW_MS,
    verified: new Map(),
    calls,
    ...over,
  };
}

const ENV = { SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_injected' };

describe('presentedToken', () => {
  it('reads the bearer, else the apikey header', () => {
    expect(presentedToken(headers({ Authorization: 'Bearer abc' }))).toBe('abc');
    expect(presentedToken(headers({ apikey: 'xyz' }))).toBe('xyz');
    expect(presentedToken(headers({ Authorization: 'Basic abc' }))).toBeNull();
    expect(presentedToken(headers({ Authorization: 'Bearer ' }))).toBeNull();
    expect(presentedToken(headers({}))).toBeNull();
  });
});

describe('serviceKeys / matchesAnyKey', () => {
  it('collects the legacy key and every SUPABASE_SECRET_KEYS value', () => {
    const keys = serviceKeys(
      (name) =>
        ({
          SUPABASE_SERVICE_ROLE_KEY: 'legacy',
          SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_a', jobs: 'sb_secret_b' }),
        })[name],
    );
    expect(keys).toEqual(['legacy', 'sb_secret_a', 'sb_secret_b']);
    expect(matchesAnyKey('sb_secret_b', keys)).toBe(true);
    expect(matchesAnyKey('sb_secret_', keys)).toBe(false);
  });

  it('ignores a malformed SUPABASE_SECRET_KEYS and an empty set matches nothing', () => {
    expect(
      serviceKeys((name) => (name === 'SUPABASE_SECRET_KEYS' ? 'not json' : undefined)),
    ).toEqual([]);
    expect(matchesAnyKey('', [])).toBe(false);
  });
});

describe('claims pre-filter', () => {
  it('reads the project ref from the URL', () => {
    expect(projectRef(URL_)).toBe(REF);
    expect(projectRef('http://kong:8000')).toBeNull();
    expect(projectRef(undefined)).toBeNull();
  });

  it('only a service_role token for this project, unexpired, is worth asking about', () => {
    const now = NOW_MS / 1000;
    expect(claimsWorthChecking(unverifiedClaims(SERVICE_JWT), REF, now)).toBe(true);
    expect(claimsWorthChecking(unverifiedClaims(ANON_JWT), REF, now)).toBe(false);
    expect(
      claimsWorthChecking(unverifiedClaims(jwt({ role: 'service_role', ref: 'other' })), REF, now),
    ).toBe(false);
    expect(
      claimsWorthChecking(unverifiedClaims(jwt({ role: 'service_role', exp: now - 1 })), REF, now),
    ).toBe(false);
    expect(unverifiedClaims('sb_secret_abc')).toBeNull();
  });
});

describe('holdsServiceRole', () => {
  it('accepts a token equal to an injected key without asking anybody', async () => {
    const d = deps(ENV, 500);
    expect(await holdsServiceRole(headers({ Authorization: 'Bearer sb_secret_injected' }), d)).toBe(
      true,
    );
    expect(await holdsServiceRole(headers({ apikey: 'sb_secret_injected' }), d)).toBe(true);
    expect(d.calls).toEqual([]);
  });

  it('the 28.09 case: a service_role JWT that is not the injected string, confirmed by Auth', async () => {
    const d = deps(ENV, 200);
    expect(await holdsServiceRole(headers({ Authorization: `Bearer ${SERVICE_JWT}` }), d)).toBe(
      true,
    );
    expect(d.calls).toEqual([`${URL_}/auth/v1/admin/users?page=1&per_page=1`]);
  });

  it('refuses a service_role JWT Auth does not confirm (forged signature)', async () => {
    const d = deps(ENV, 401);
    expect(await holdsServiceRole(headers({ Authorization: `Bearer ${SERVICE_JWT}` }), d)).toBe(
      false,
    );
    expect(d.verified.size).toBe(0);
  });

  it('refuses the anon key, a user token and no token, without a round trip', async () => {
    const d = deps(ENV, 200);
    expect(await holdsServiceRole(headers({ Authorization: `Bearer ${ANON_JWT}` }), d)).toBe(false);
    expect(
      await holdsServiceRole(
        headers({ Authorization: `Bearer ${jwt({ role: 'authenticated', ref: REF })}` }),
        d,
      ),
    ).toBe(false);
    expect(await holdsServiceRole(headers({}), d)).toBe(false);
    expect(d.calls).toEqual([]);
  });

  it('refuses when Auth cannot be reached — never fails open', async () => {
    const d = deps(ENV, 200, {
      fetch: async () => {
        throw new Error('network down');
      },
    });
    expect(await holdsServiceRole(headers({ Authorization: `Bearer ${SERVICE_JWT}` }), d)).toBe(
      false,
    );
  });

  it('refuses when SUPABASE_URL is missing', async () => {
    const d = deps({ SUPABASE_SERVICE_ROLE_KEY: 'x' }, 200);
    expect(await holdsServiceRole(headers({ Authorization: `Bearer ${SERVICE_JWT}` }), d)).toBe(
      false,
    );
    expect(d.calls).toEqual([]);
  });

  it('remembers a confirmed token for ten minutes, by hash, then asks again', async () => {
    let now = NOW_MS;
    const d = deps(ENV, 200, { nowMs: () => now });
    const h = headers({ Authorization: `Bearer ${SERVICE_JWT}` });
    expect(await holdsServiceRole(h, d)).toBe(true);
    expect(await holdsServiceRole(h, d)).toBe(true);
    expect(d.calls).toHaveLength(1);
    expect([...d.verified.keys()][0]).toMatch(/^[0-9a-f]{64}$/);
    expect([...d.verified.keys()][0]).not.toContain(SERVICE_JWT);

    now += VERIFIED_TTL_MS + 1;
    expect(await holdsServiceRole(h, d)).toBe(true);
    expect(d.calls).toHaveLength(2);
  });
});
