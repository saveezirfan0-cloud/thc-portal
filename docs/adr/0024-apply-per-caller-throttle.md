# ADR-0024 · A per-caller limit on /apply, at the app edge and backed by the database

Status: accepted · 26.09.2026 · closes docs/14 §4 D2 ("`/apply` is still unthrottled per caller") and the last of D1 (the consent tick on the shared Checkbox)

## Context

`submit_application()` is granted to `anon` by design (§2.1: a public URL, no
registration). `20260922183012` bounded it per email and per mobile from
`settings.apply_throttle`, and said in its own header what that leaves open: a
distributed caller with a fresh email and mobile each time is bounded by nothing
at all. Every accepted call writes a `staff` row, an `applications` row and an
`audit_log` row (§1.7 data the office then holds), and once Willo is wired
(ADR-0021) it also costs an interview.

The scope names no captcha, and a genuine applicant must never meet a challenge
they cannot pass (docs/13 D2). The only thing every request from one source has
in common is where it comes from.

Separately, the consent tick on `/apply` was still a hand-rolled input: D1 moved
the focusable `.check-input` rule into `packages/ui`, but the form kept its copy
for the coral box border the wireframe draws when consent is missing, which the
shared `Checkbox` has no prop for.

## Decision

1. **The key is the caller's address, hashed, never stored.**
   `apps/staff/lib/callerKey.ts` takes the first hop of `x-forwarded-for` (else
   `x-real-ip`) — on Vercel both are written by Vercel's proxy and cannot be
   supplied by the caller — buckets it (IPv4 as-is; IPv6 by its /64, because a
   subscriber is handed the whole prefix and hashing the full address would give
   one attacker 2⁶⁴ keys; an IPv4-mapped IPv6 address is its IPv4) and takes
   HMAC-SHA256 under `APPLY_CALLER_SALT`. What reaches the database is 64 hex
   characters. The salt never does, so a row cannot be walked back to an
   address by anyone who can read the table but not the app's environment
   (§1.7).

   **Fallback salt.** When `APPLY_CALLER_SALT` is unset the app uses a
   built-in salt (`FALLBACK_SALT`) and logs one warning per cold start, so a
   fresh environment throttles rather than fails. The fallback is in the
   repository: a hash made with it hides the address from being *read*, not
   from a brute-force over the IPv4 space by someone holding both the table and
   the source. Set the real salt before go-live — any long random string, on
   the Staff Vercel project (docs/12, OWNER-TODO).

2. **The count is in the database, not in memory.** `apply_caller_attempts`
   (`caller_hash`, `attempted_at`) and `apply_caller_check(p_caller_hash)`
   (`20260926100000`). An in-process counter is one per serverless instance and
   is reset by every cold start, which is exactly the shape an attacker gets
   for free. The RPC is SECURITY DEFINER with its search_path pinned,
   executable by `anon` and `authenticated` (the form's own SSR client is the
   anon key), takes a per-caller advisory lock so two racing requests cannot
   both read n−1, records the attempt when allowed, and answers
   `{allowed, retry_after_seconds}`. The column CHECK admits only a
   64-character hex digest, so an address cannot be stored even by a bug.

   **RLS on, no policy, grants revoked.** Nobody reads this table through
   PostgREST — not the admin either: a list of hashes is no use to the office,
   and the fewer readers of a pseudonymous identifier the better. This is the
   one policy-less table in `public` on purpose; `001_rls_guard` asserts none
   is policy-less *by omission*, so it needs this table named in assertions 1
   and 7 (a shared file, not part of this change).

3. **Two windows, from `settings.apply_caller_throttle`** (§9.12): 5 attempts
   in 10 minutes and 20 in 24 hours by default. The short one is a household
   applying together; the long one is a recruitment stand or a college IT suite
   behind one address for a day. The function carries the same defaults key by
   key, so a missing key or a deleted row cannot turn the limit off; a zero is
   floored to one. The `/settings` page does not list the key yet.

   **Refused attempts are not recorded**, so `retry_after_seconds` is exact: a
   caller told to wait N seconds is let in after N seconds however often they
   tried in between. An attacker hammering the endpoint costs a lock and a
   count per call, and nothing is written.

   **No `p_now`.** A clock the caller supplies is a clock the caller can set to
   last week, and the function is granted to anon. pgTAP 520 moves time by
   ageing `attempted_at` as the migration role instead.

   **Pruning is opportunistic**: every call deletes rows older than the longer
   window, which nothing would read again. The table holds at most a day.

4. **The action asks before it submits, and fails open.**
   `apps/staff/app/apply/actions.ts` calls `apply_caller_check` after
   validation and before `submit_application`. Refused → one plain banner,
   *"Too many applications from this connection — please try again in a few
   minutes."* — which names neither the limit nor the wait, so the endpoint
   gives away nothing about where the line is. The RPC failing for any reason
   (not deployed yet, network, a malformed answer) is logged and treated as
   allowed: a database hiccup must never become a refused applicant, and the
   per-email and per-mobile limits underneath are still in force. A request
   with no client address at all — only off the platform, a bare `next dev` —
   is allowed too, rather than sharing one bucket: if the platform ever stopped
   sending the header, that bucket would refuse the whole world at five per ten
   minutes.

   §2.12 is untouched: the check never looks at who is applying, so a
   returning applicant is treated exactly as a new one and still sees the
   ordinary "Check your inbox".

5. **The consent tick is the shared `Checkbox`.** Same copy, same `name`, same
   error text. The coral box border for the missing-consent state is a
   `.consent-missing` class on the wrapper and one rule in `apply.css`
   (`border-color: var(--coral)`, the wireframe's own token), rather than a
   prop on the shared control or a second copy of it.

## Consequences

- New env var on the Staff Vercel project: `APPLY_CALLER_SALT` (any long random
  string; rotating it resets every caller's count, which is harmless). Until it
  is set the fallback is used and the log says so. docs/12 and the
  `.env.example` should list it (shared files).
- `001_rls_guard` assertions 1 and 7 need `apply_caller_attempts` named (a
  deliberate policy-less table), or the full suite is red on it.
- The limit is per *address bucket*: a whole office or a whole IPv6 /64 shares
  one. The numbers are settings so that cost can be tuned without a release.
- What this does not close: `anon` still holds EXECUTE on
  `submit_application`, so the direct PostgREST door (anon key + `POST
  /rest/v1/rpc/submit_application`) bypasses this check entirely — it is an
  edge in front of the *form*, not in front of PostgREST. Closing that means
  the action holding the service key and `anon` losing EXECUTE, which is the
  `packages/db` change `20260922183012` already recorded.
- Tests: `apps/staff/app/__tests__/callerKey.test.ts` (stable, salted, never
  contains the address, IPv6 bucketing, header precedence, fallback warning);
  `supabase/tests/520_apply_caller_throttle.sql` (RLS for all four roles, anon
  executes the RPC, the Nth+1 refusal in both windows, reset after the window,
  pruning, the settings override and the defaults behind it).
