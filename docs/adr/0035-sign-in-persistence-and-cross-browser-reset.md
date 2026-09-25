# ADR-0035 · "Keep me signed in", and a reset link that works in any browser

Status: accepted · 25.09.2026 · WP-E fix round (audit 25.09 D12, D13; §1.4, §10.2)

## 1 · "Keep me signed in on this device" (office and client A0)

`wireframes/backoffice/login.html:39` and `wireframes/client/login.html:65`
draw the box, ticked. The wireframe note says it "only lengthens the token
lifetime on this device"; the client wireframe lists its duration as an
assumption to confirm.

**Decision.** Ticked (the default): the Supabase auth cookies are
persistent, as `@supabase/ssr` writes them (Max-Age 400 days; the refresh
token decides how long the session really lives). Unticked: they are
**session cookies** — no Max-Age, no Expires — so closing the browser ends
the sign-in on that device. Supabase has no per-session token lifetime, so
"shorter session" is expressed as "ends with the browser".

**How.** `@supabase/ssr` forces its own Max-Age onto every auth cookie
(`cookieOptions` cannot override it) and rewrites the cookies on every token
refresh — in middleware, in server actions and in the browser client. So:

- sign-in (`apps/{office,client}/app/login/actions.ts`) creates the client
  with `{ sessionOnly: !remember }` and, when unticked, sets a marker cookie
  `thc-session-only=1` (itself a session cookie; not httpOnly because the
  browser client reads it; it carries nothing but "1"). Ticked clears it.
- every `setAll` — the three middlewares, `@thc/db/server`'s `createClient`,
  `@thc/db/browser`'s `createClient` — passes its options through
  `sessionCookieOptions()` (`packages/db/src/session.ts`), which drops
  Max-Age/Expires while the marker is present. A deletion (Max-Age 0 or an
  Expires in the past) is never altered, so sign-out still clears the cookies.

The Staff App has no box (its wireframe draws none): a worker's phone stays
signed in.

**Known limit.** Browsers that restore the previous session ("continue where
you left off") also restore session cookies; that is the browser's choice
and the same for every site.

## 2 · The recovery link carries a token_hash; /auth/confirm spends it

The reset email used GoTrue's PKCE `/verify` link, which only works in the
browser that asked for it (the code verifier lives in that browser's
cookies). It failed from another device, in a mail app's in-app browser, and
on iOS when the request came from the installed PWA, whose cookie jar Safari
does not share (audit D13).

**Decision.**

- `supabase/templates/recovery.html` links to
  `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery&next=/reset`.
  `{{ .RedirectTo }}`, not `{{ .SiteURL }}`: the three apps share one Auth
  project and one Site URL, and each app's forgot action sends its own
  `<origin>/auth/confirm` (`recoveryRedirect()` in `packages/db/src/origin.ts`).
- Each app has `/auth/confirm`, which calls
  `verifyOtp({ type: 'recovery', token_hash })` and redirects to the safe
  `next` (default `/reset`). It accepts `type=recovery` only. It also takes a
  PKCE `code`, so a project still on the default template keeps working.
  `/auth/callback` stays for the code exchange.
- When GoTrue substitutes the Site URL for a redirect that is not on the
  allow-list, the link arrives at `/` with the token; every middleware
  forwards `/?token_hash=…` to `/auth/confirm`.
- The link's origin is the app's `NEXT_PUBLIC_{OFFICE,STAFF,CLIENT}_URL`
  and nothing else. In production without it the forgot action refuses in
  words: `VERCEL_URL` (a deployment URL, off the allow-list and behind
  Vercel SSO) and `127.0.0.1` are no longer fallbacks (`appOrigin()`).

**One reset flow in the office.** The unlinked `/login/forgot`,
`/login/forgot/sent`, `/login/reset` and `/login/callback` (and their own
`safeNext.ts`, which turned `/..//evil.com` into `//evil.com`, D12) are
deleted. `/forgot` → `/forgot/sent` → the email → `/auth/confirm` → `/reset`
is the one flow, as in the other two apps, and `next` is decided only by
`safeNextPath` in `packages/db/src/redirect.ts`.

**Known limit.** A link scanner that GETs every URL in an email spends the
token before the person clicks. GoTrue's own `/verify` link has the same
property, so this is no regression; an interstitial "Continue" button would
close it and is left for THC to ask for.

## Owner steps (hosted project)

- Authentication → Email Templates → Reset Password: the body of
  `supabase/templates/recovery.html`.
- Authentication → URL Configuration → Redirect URLs: for each app's public
  URL, `<url>/auth/callback**` and `<url>/auth/confirm**`.
- Vercel: `NEXT_PUBLIC_OFFICE_URL`, `NEXT_PUBLIC_STAFF_URL`,
  `NEXT_PUBLIC_CLIENT_URL` on their projects (Production and Preview).
- Authentication → Providers → Email / Sign In: sign-ups off, minimum
  password length 10 with letters and digits, secure password change on —
  as `supabase/config.toml` now sets locally.
