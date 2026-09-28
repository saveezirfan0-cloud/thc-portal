# ADR-0067 · A job's caller is confirmed by Supabase Auth, not by byte-equality with the function's key

Status: accepted · 28.09.2026

`supabase/functions/_shared/job.ts` · `packages/db/src/service-caller.ts` · docs/01 §4

## Context

Every §7 job (and willo-webhook's `/invite`) accepted a call only if its bearer token was
byte-for-byte equal to the function's `SUPABASE_SERVICE_ROLE_KEY`. pg_cron sends the
Vault's `service_role_key`. On the live project the two are **both valid service-role keys
for the project and still differ**: from 26 to 28.09 every scheduled call (booking-tick,
notify-drain, auto-staffing, compliance-daily, finance-reports, gdpr-purge, the Willo
invite) was answered 401 "service role required". Supabase's gateway had verified the
token, so our own equality check was what refused it. The Vault key was checked on 28.09:
role `service_role`, `ref` = this project, expiry 2036, no whitespace. Supabase shows no
digest for its built-in `SUPABASE_SERVICE_ROLE_KEY` (it is marked deprecated in favour of
`SUPABASE_SECRET_KEYS`), so the owner cannot compare the two.

## Decision

`isServiceCaller()` (pure, vitest):

1. equal to the function's key → accepted (constant time), as before;
2. otherwise the token's claims are read, **unverified**, only to skip everything that
   is not `role: service_role` for this project's `ref` (anon, users, other projects,
   non-JWTs);
3. what remains is put to Supabase Auth: `GET /auth/v1/admin/users?per_page=1` with the
   token as `apikey` and bearer. Auth answers 200 only to a genuine service key, so Auth,
   not our parsing, is the check. A yes is remembered per isolate for ten minutes.

## Consequences

- The jobs run with the Vault key the owner already stored; no key needs finding.
- A forged token costs at most one Auth call. Functions deployed with JWT verification
  never see one, because the gateway rejects it first; only willo-webhook (`--no-verify-jwt`)
  reaches step 3 with an unverified token, and Auth refuses it.
- Moving to the new `sb_secret_…` keys (end of 2026) is a separate change: they are not
  JWTs and go in the `apikey` header, which pg_net's calls do not send today.
