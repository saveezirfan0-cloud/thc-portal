/**
 * Is the caller of a §7 job the service role? — the check every job in
 * `supabase/functions/_shared/job.ts` (and willo-webhook's `/invite`)
 * runs before it does anything. Pure, so vitest holds it; the Edge
 * Functions import it by relative path (ADR-0006).
 *
 * Two key systems, both accepted (ADR-0165). Supabase switches the legacy
 * JWT keys off at the end of 2026, and the owner moves to the new keys
 * without a code change (docs/16 §10):
 *
 *   legacy  `service_role`, a JWT (`eyJ…`). pg_cron sent it as
 *           `Authorization: Bearer`, and since 20261020140000 sends it on
 *           `apikey` as well.
 *   new     `sb_secret_…`, NOT a JWT. pg_cron sends it on `apikey` only
 *           (`edge_call_headers()`); a caller that puts it in a bearer is
 *           read too.
 *
 * The caller's key is looked for in both headers, then:
 *
 *   1. equal to one of the function's own keys — the legacy
 *      `SUPABASE_SERVICE_ROLE_KEY`, or any key in the `SUPABASE_SECRET_KEYS`
 *      dictionary Supabase injects — → yes, at once (constant time);
 *   2. a JWT whose claims say `service_role` for THIS project is put to
 *      Supabase Auth itself (`confirm`, an admin call only a genuine
 *      service key passes). On the live project the pg_cron key and the
 *      function's own legacy key were both valid and still differed
 *      (28.09: every job answered 401), and Supabase shows no digest of
 *      its built-in secret to compare them by. The claims are read
 *      unverified only to avoid asking Auth about user and anon tokens;
 *      Auth's answer is the check.
 *   3. anything else — a publishable key, a user or anon token, an
 *      `sb_secret_…` that is not one of this project's — no. A new secret
 *      key is never sent to Auth to be judged: the runtime hands the
 *      function every secret key the project has, so one it does not hold
 *      is not the project's, and refusing it locally costs a forger
 *      nothing to learn from.
 *
 * The platform's own `verify_jwt` check stays on for the job functions. It
 * accepts the new keys on either header "for migration compatibility"
 * (Supabase docs, Authorization headers) but does not authenticate them;
 * this function does.
 */

import { timingSafeEqual } from './willo.ts';

const encoder = new TextEncoder();

/** The bearer token, or '' when there is none. */
export function bearerToken(header: string | null): string {
  if (!header?.startsWith('Bearer ')) return '';
  return header.slice(7).trim();
}

/** A JWT's payload, NOT verified. Null for anything that is not a JWT. */
export function unverifiedClaims(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  const normal = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  try {
    const json = atob(normal.padEnd(Math.ceil(normal.length / 4) * 4, '='));
    const claims: unknown = JSON.parse(json);
    return typeof claims === 'object' && claims !== null && !Array.isArray(claims)
      ? (claims as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** `https://<ref>.supabase.co` → `<ref>`; null for anything else (local). */
export function projectRef(supabaseUrl: string | undefined): string | null {
  const match = supabaseUrl?.match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/);
  return match?.[1] ?? null;
}

/** A new-format secret key (`sb_secret_…`). Bypasses RLS, like service_role. */
export function isSecretKey(token: string): boolean {
  return /^sb_secret_[A-Za-z0-9_-]+$/.test(token);
}

/** A new-format publishable key (`sb_publishable_…`), the anon key's successor. */
export function isPublishableKey(token: string): boolean {
  return /^sb_publishable_[A-Za-z0-9_-]+$/.test(token);
}

/** Something that answers header lookups: a `Request`'s `headers`, or a test's stand-in. */
export interface HeaderSource {
  get(name: string): string | null;
}

/**
 * The keys a caller presented: the bearer token and the `apikey` header,
 * each once, empty ones dropped. A bare string is read as the
 * `Authorization` header alone (the form this module took before ADR-0165).
 */
export function presentedKeys(source: HeaderSource | string | null): string[] {
  const bearer = bearerToken(
    typeof source === 'string' || source === null ? source : source.get('Authorization'),
  );
  const apikey =
    typeof source === 'string' || source === null ? '' : (source.get('apikey') ?? '').trim();
  return [...new Set([bearer, apikey].filter((key) => key !== ''))];
}

type EnvReader = (name: string) => string | undefined;

/**
 * `SUPABASE_SECRET_KEYS` — a JSON object of the project's secret keys by
 * name, which Supabase injects into every function (`{"default":
 * "sb_secret_…"}`) — read leniently: unset, malformed or not an object is
 * an empty dictionary, never a throw (a job that cannot parse it still
 * runs on the legacy key). Values that are not strings are skipped.
 */
export function secretKeyDictionary(env: EnvReader): Record<string, string> {
  const raw = env('SUPABASE_SECRET_KEYS');
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '',
      ),
    );
  } catch {
    return {};
  }
}

/**
 * Every new-format secret key the function holds: the injected dictionary,
 * plus `SUPABASE_SECRET_KEY`, the single-key form the CLI uses locally.
 */
export function secretKeysFromEnv(env: EnvReader): string[] {
  const single = env('SUPABASE_SECRET_KEY');
  return [...new Set([...Object.values(secretKeyDictionary(env)), ...(single ? [single] : [])])];
}

export type ServiceKeyChoice =
  { ok: true; key: string; source: string } | { ok: false; error: string };

/**
 * The key a function's OWN client (its database calls) uses.
 *
 *   THC_SECRET_KEY_NAME set → that entry of SUPABASE_SECRET_KEYS, or a loud
 *       error naming what is missing. The owner sets this function secret
 *       when switching to the new keys (docs/16 §10), BEFORE turning the
 *       legacy keys off — Supabase may go on injecting a legacy key that no
 *       longer works, so its presence proves nothing.
 *   otherwise → the legacy SUPABASE_SERVICE_ROLE_KEY, exactly as before;
 *   and only when that is absent → SUPABASE_SECRET_KEYS.default, then
 *       SUPABASE_SECRET_KEY.
 */
export function serviceKeyFromEnv(env: EnvReader): ServiceKeyChoice {
  const name = env('THC_SECRET_KEY_NAME')?.trim();
  const dictionary = secretKeyDictionary(env);
  if (name) {
    const key = dictionary[name];
    return key
      ? { ok: true, key, source: `SUPABASE_SECRET_KEYS.${name}` }
      : {
          ok: false,
          error: `THC_SECRET_KEY_NAME is "${name}", but SUPABASE_SECRET_KEYS holds no key by that name (it has: ${Object.keys(dictionary).join(', ') || 'none'})`,
        };
  }
  const legacy = env('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return { ok: true, key: legacy, source: 'SUPABASE_SERVICE_ROLE_KEY' };
  if (dictionary['default'])
    return { ok: true, key: dictionary['default'], source: 'SUPABASE_SECRET_KEYS.default' };
  const single = env('SUPABASE_SECRET_KEY');
  if (single) return { ok: true, key: single, source: 'SUPABASE_SECRET_KEY' };
  return {
    ok: false,
    error:
      'no service key: none of SUPABASE_SERVICE_ROLE_KEY, SUPABASE_SECRET_KEYS, SUPABASE_SECRET_KEY is set',
  };
}

export interface ServiceCallerCheck {
  /** The function's own legacy `SUPABASE_SERVICE_ROLE_KEY`. */
  expected: string | undefined;
  /** The function's own new-format secret keys (`secretKeysFromEnv`). */
  secretKeys?: readonly string[];
  /** The project the token must name, when known. */
  ref: string | null;
  /** Ask Supabase Auth whether this legacy JWT is a working service key. */
  confirm: (token: string) => Promise<boolean>;
}

function sameKey(a: string, b: string): boolean {
  return timingSafeEqual(encoder.encode(a), encoder.encode(b));
}

export async function isServiceCaller(
  source: HeaderSource | string | null,
  check: ServiceCallerCheck,
): Promise<boolean> {
  const presented = presentedKeys(source);
  if (presented.length === 0) return false;

  const own = [check.expected, ...(check.secretKeys ?? [])].filter(
    (key): key is string => typeof key === 'string' && key !== '',
  );
  for (const token of presented) {
    for (const key of own) if (sameKey(token, key)) return true;
  }

  for (const token of presented) {
    const claims = unverifiedClaims(token);
    if (claims?.['role'] !== 'service_role') continue;
    if (check.ref && claims['ref'] !== check.ref) continue;
    try {
      if (await check.confirm(token)) return true;
    } catch {
      // An Auth error is a refusal, never a pass.
    }
  }
  return false;
}
