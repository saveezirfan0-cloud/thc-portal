# ADR-0108 · The Back Office middleware verifies the token locally and asks GoTrue once a minute

**Status:** Accepted · **Amends** ADR-0057 decision 3 ("which user record is trusted") · **§1.4, §10.2**

## Context

`apps/office/middleware.ts` ran on every request, prefetches included, and every run began with `supabase.auth.getUser()`: a network round trip from the Vercel function to Supabase Auth before the page could start. That is the first link of a chain (middleware, then the layout's reads, then the page's own queries), so each page paid for it every time.

The project signs its tokens with an asymmetric key (ES256, published at `/auth/v1/.well-known/jwks.json`), so a token can be checked without asking GoTrue.

## Decision

1. **Identity, role and assurance level come from the verified token.** The middleware calls `auth.getClaims()`, which checks the signature against the project's cached public key and the expiry, and refreshes a token about to expire (rewriting the cookies through the same `withSessionPersistence` wrapper, so ADR-0032 holds). `sub`, `app_metadata.role` and `aal` are read from those claims. `user_metadata` is still never read for a role.
2. **GoTrue is asked at most once a minute per session.** What a token cannot say is whether its session has since been revoked, and whether the login has a verified authenticator factor. `getUser()` still answers both, the factor list still comes from GoTrue and not from the editable cookie copy (ADR-0057), and the answer is remembered in the server's memory for `SESSION_RECHECK_MS` (60 s), keyed by `sub:session_id:aal` of the claims just verified (`app/login/session-check.ts`). The browser contributes nothing to the cache. A session GoTrue no longer knows is treated as signed out, with the refreshed cookies carried on the redirect.
3. **The two-step rule is unchanged.** `twoStepDecision()` is still the one rule; the current level is now the verified `aal` claim (anything but a literal `aal2` counts as not aal2, so the gate fails closed) instead of a claim read from `getSession()`'s copy. The middleware no longer calls `getSession()` at all.
4. **The layout's lookup follows suit.** `officeUser()` and `/users` read the id from `getClaims()` (PR "drop a duplicate auth round trip"). Server actions and anything that writes keep `getUser()`.

## What this changes, and what it does not

- **Revocation, for the page shell only.** A session signed out elsewhere or switched off used to be refused on the next request. It is now refused within a minute. The data was never at stake in that minute: `current_app_role()` (20261001200500) runs inside every RLS policy and admin RPC and answers NULL for a switched-off login and for a Back Office login below aal2, and `office_can()` reads the office role from `profiles` on every call. A server action that uses the service key asks `current_app_role()` first (`sessionIsAdmin`). The middleware is the first gate, the database the one that protects the rows.
- **A new factor takes up to a minute to be enforced by the middleware.** A login that enrols an authenticator on another device is sent to the code step on its next page after the entry expires. The database refuses its data at aal1 from the moment the factor is verified.
- **Role changes** were already carried in the token until it refreshed; unchanged.
- **Cost.** A manager clicking through the menu makes one `getUser()` a minute per server instance instead of one per page. A cold instance, or a Vercel region switch, simply asks again.

## Alternatives rejected

- **Trust the token and never ask GoTrue.** Loses the factor list (`aal1` plus an enrolled authenticator is exactly the case that must redirect), and removes revocation from the shell entirely.
- **Skip `getUser()` only for `aal2` sessions.** Safe but pointless today: no admin has two-step on, so nothing would be saved.
- **A signed marker cookie.** Needs a secret in the middleware's environment and a rotation story, to save what a 60-second server-side memory saves.

## Consequences

- `apps/office/middleware.ts`, `apps/office/app/login/session-check.ts`, tests in `app/__tests__/middleware-session.test.ts` and `app/login/__tests__/session-check.test.ts`; the middleware mocks in `signin.test.ts`, `keep-signed-in.test.tsx` and `two-step-flow.test.ts` now provide `getClaims`.
- If the project's signing key is ever switched back to a shared secret, `getClaims()` falls back to asking GoTrue itself: correct, just no faster.
- The Staff App and Client Portal middleware are unchanged.
