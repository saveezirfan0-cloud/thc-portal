# ADR-0165 · Both Supabase key systems work everywhere; the Edge Functions' client is pinned on npm

Status: accepted · 19.10.2026

Upgrade-readiness audit 17.10 (H1, M5, M6) · docs/22 §3 "Before 31.12.2026" ·
`packages/db/src/{service-caller,env}.ts` · `supabase/functions/_shared/job.ts` ·
`supabase/functions/{notify-drain,willo-webhook}/index.ts` · `apps/*/next.config.ts` ·
`supabase/migrations/20261020140000_edge_calls_send_apikey.sql` ·
`supabase/tests/900_edge_call_headers.sql` · docs/16 §10

## Context

Supabase switches the legacy API keys off at the end of 2026. They are the long JWTs
(`eyJ…`): `anon`, which the browser and server clients carry, and `service_role`, which
bypasses RLS. Their replacements are a **publishable** key, `sb_publishable_…`, and
**secret** keys, `sb_secret_…`. Neither new key is a JWT.

On 17.10 every path was wired to the legacy keys:

- `isServiceCaller()` accepted a byte-equal copy of `SUPABASE_SERVICE_ROLE_KEY`, or else
  only a JWT with `role = service_role`.
- pg_cron, `willo_invite_nudge()` and `auto_assign_first_round()` sent the Vault secret
  `service_role_key` as `Authorization: Bearer`.
- The Edge Functions imported `https://esm.sh/@supabase/supabase-js@2.45.4` (September
  2024) and read only `SUPABASE_SERVICE_ROLE_KEY`.
- docs/16 told the owner to avoid `sb_secret_…`.

If the legacy keys had been disabled that day, nobody could have signed in, no job would
have run, and no invite would have gone out.

The audit quoted Supabase docs as saying `verify_jwt` rejects the new keys. The current
docs ("Authorization headers") say otherwise. "For migration compatibility", `verify_jwt`
accepts publishable and secret keys on either header. Passing that check does not
authenticate the caller. The docs say service calls should put the key on `apikey`.

## Decision

**Accept both key forms everywhere, so that the switch is a change of settings
(docs/16 §10).**

1. **Callers of the jobs** (`service-caller.ts`):
   - The caller's key is read from `apikey` and from the bearer.
   - The key passes at once if it equals the function's legacy key or any key in the
     injected `SUPABASE_SECRET_KEYS` dictionary. `SUPABASE_SECRET_KEY` is the CLI's
     single-key form and counts too. The comparison is constant-time.
   - A legacy JWT with `role = service_role` for this project still goes to Auth to be
     confirmed (the 28.09 case).
   - A new secret key is **never** sent to Auth. The runtime gives the function every
     secret key the project has, so a key it does not hold does not belong to the
     project, and a forged one learns nothing.
   - A publishable key never passes.
2. **The functions' own client.** `serviceKeyFromEnv()` returns the legacy key until the
   owner sets the function secret `THC_SECRET_KEY_NAME`. From then on it returns that
   entry of `SUPABASE_SECRET_KEYS`; if the entry is missing it raises an error naming the
   problem, and never falls back to the legacy key. Supabase may go on injecting a
   legacy key after it stops working, so the presence of that key proves nothing. Nothing
   changes at deploy time.
3. **The database's calls.** `edge_call_headers(key)` builds the headers for every call
   to an Edge Function:
   - The key always goes on `apikey`.
   - It goes on `Authorization: Bearer` only when it is a JWT.

   `install_job_schedules()`, `willo_invite_nudge()` and `auto_assign_first_round()` now
   use it. With the legacy key the request is the same as supabase-js has always sent.
   The Vault secret keeps its name, `service_role_key`, whichever form of key it holds.
   The Back Office jobs keep their own `rtw_job_secret` bearer, unchanged.
4. **`verify_jwt` stays as it was.** It is on for the job functions and off for
   willo-webhook. With either key form, our own check is the one that authenticates. If
   Supabase ever withdraws the compatibility, the gateway answers 401 `Invalid JWT` and
   no `job_runs` row is written. The fix is then to deploy the job functions with
   `--no-verify-jwt`. That is safe because the in-code check is complete; it costs only
   an invocation for each unauthenticated call (docs/16 §10.7). Switching it off now
   would have changed the gateway in front of production for no gain.
5. **The apps.**
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is read as an alternative to
     `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and wins when both are set. `env.ts` reads both.
   - Each app's `next.config.ts` maps the new name onto the old one at build time. About
     fifty literal `process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY` "is it configured?"
     checks, including the three middlewares, therefore see the same value without being
     edited.
   - `SUPABASE_SERVICE_ROLE_KEY` keeps its name and simply holds the `sb_secret_…` value.
     A second name would have split the dozen server-side presence checks.
   - supabase-js 2.118 sends a new key to PostgREST and Auth as before. It sends it to
     Edge Functions on `apikey` only.
6. **One supabase-js for the functions.** All three imports are now
   `npm:@supabase/supabase-js@2.118.0`, the version the apps resolve. The `npm:`
   specifier is native to the Deno 2 Edge Runtime (`deno_version = 2`), so no deno.json
   or import map is added. A Vitest guard (`edge-supabase-js.test.ts`) requires one exact
   `npm:` pin, equal to `pnpm-lock.yaml`.

## Library versions (19.10.2026)

| Package | Before | After | Note |
|---|---|---|---|
| `@supabase/supabase-js` (apps, packages/db) | 2.116.0 | 2.118.0 | floor `^2.118.0` |
| Edge Functions' supabase-js | esm.sh 2.45.4 | `npm:` 2.118.0 | |
| `next` | 15.5.27 | 15.5.28 | Next 16 is a major: not taken |
| `react`, `react-dom` | 19.3.0 | 19.3.1 | |
| `@serwist/next`, `serwist` | 9.5.12 | 9.5.13 | brings `zod` 4.6.5, which no code imports |
| `typescript-eslint` | 8.70.0 | 8.70.1 | patch only |
| Vitest, Playwright, TypeScript, ESLint | 3.2.7, 1.63.0, 5.9.3, 9.39.5 | unchanged | already the newest patch of their minor |
| Supabase CLI (CI) | 2.120.0 | 2.121.0 | both jobs |
| `@supabase/ssr` | 0.8.0 | 0.12.7 | see below |

**`@supabase/ssr`.** Versions 0.9 to 0.12 change cookie handling:

- server writes that would not change a cookie are skipped;
- PKCE verifier slots are flushed on the server;
- a host-only cookie is cleared beside a domain-scoped one;
- cookie chunks that decode to invalid JSON are treated as absent;
- the server client initialises lazily (`skipAutoInitialize`);
- `setAll(cookies, headers)` gains a second argument carrying no-store cache headers.

The default cookie options (400 days, `lax`, `/`) did not change.

ADR-0032's "keep me signed in" wrapper rewrites the lifetime on every write, so the upgrade
had to be proved against the real library. Every other session test stubs it.
`packages/db/src/__tests__/session-real-ssr.test.ts` drives the real library through our
server and browser clients, with only GoTrue faked. It covers sign-in, refresh and sign-out,
each for ticked, unticked and each app's fallback.

That file passes on 0.8.0 (committed first) and on 0.12.7 unchanged. So do the existing
session, middleware-session, session-lifetime, keep-signed-in and login tests.

`withSessionPersistence` now forwards the `headers` argument it used to drop (0.8 never sent
one). Applying those headers in the middlewares is left to the middlewares' owners.

The Playwright end-to-end run of "Keep me signed in" was not possible in this sandbox (no
Docker for `supabase start`). Run it once on the PR's CI.

## Consequences

- The owner's switch is docs/16 §10. In order: re-install the schedules once, set
  `THC_SECRET_KEY_NAME`, update the Vault, update the Vercel values, watch for a week,
  then deactivate the legacy keys. Every step can be undone until the last one.
- `edge_call_headers()` is the single place where the database decides how a key is
  sent. A new caller that posts to an Edge Function must use it (pgTAP 900).
- The legacy code paths stay until the legacy keys are revoked. Removing them is a later
  change.
