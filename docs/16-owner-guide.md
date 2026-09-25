# 16 · Owner's guide: finishing the deployment

Everything that only the owner (or THC) can do, in the order to do it, with every
console path, variable name, command and check. `OWNER-TODO.md` is the checklist
you tick; `docs/14-handover.md` §5 is the background; this page is the
instructions. The numbering here is stable so the checklist can point at it.

Conventions on this page:

- `<LIKE_THIS>` is a placeholder for a value you paste. No real key appears here,
  and none should ever be added.
- "**Confirmed 23.09.2026**" means a session read the live project, GitHub or
  Vercel that day through read-only tools. Everything else is what the code
  expects; check it on the screen named.
- Dashboard paths change. Where a menu has moved, the URL still works.

---

## 0 · How to read this, and the order to do things in

### 0.1 The one-screen checklist

| # | Do | Where | Time | Unblocks |
|---|---|---|---|---|
| 1 | **Start the Resend domain** (DNS has lead time) | §4.1 | 20 min work, up to 48 h wait | every email |
| 2 | Supabase Auth: OTP expiry 86400, leaked-password protection, URL config, email templates | §1.1–1.3 | 15 min | activation links, password reset |
| 3 | GitHub: confirm the `main` ruleset and the three deploy secrets | §2 | 10 min | safe merges, database deploys |
| 4 | Vercel: the env-var matrix (two variables to add, one to rename) | §3 | 20 min | reset links, push, `/apply` limit |
| 5 | VAPID pair → Supabase secrets → Vercel key → redeploy staff | §4.3–4.5 | 20 min | push |
| 6 | Deploy **all six** job functions from the repo root | §4.6 | 15 min | the whole §7 jobs layer |
| 7 | SQL: `edge_base_url`, Vault secret, `install_job_schedules()` | §4.7 | 10 min | every schedule |
| 8 | Verify `job_runs`, then the smoke test | §4.8–4.9 | 20 min | — |
| 9 | Custom SMTP for Auth on Resend (after step 1 verifies) | §1.3 | 10 min | password reset for workers |
| 10 | Willo, once THC sends the keys | §5 | 45 min | interviews, E1 |
| 11 | Optional keys: Mapbox, Gemini, Firewall rule | §3.6, §6 | as needed | maps, document reading |
| 12 | Answer the `rls_auto_enable()` question | §1.4 | 20 min | peace of mind |

### 0.2 What unblocks what

- **Nothing sends until §4 is complete.** The drain (`notify-drain`, ADR-0020)
  holds every row as "not configured" without spending retries, so nothing is
  lost by doing §4 late — but E3 (the activation email) is the only way a new
  worker gets into the app, so it is the first thing that matters.
- **Resend needs THC's DNS**, and DNS propagation is the one wait you cannot
  shorten. Start §4.1 before anything else; the rest of §4 can happen while it
  propagates, except setting `RESEND_API_KEY` — set that only after the domain
  shows **Verified**, or the first sends fail and burn attempts (docs/12).
- **`install_job_schedules()` must come after the function deploys** (docs/13 P1).
  The other way round, pg_cron posts at a 404 every minute until you fix it.
- **The VAPID public key lives in two places** and they must match: a Supabase
  secret for signing, a Vercel variable for the browser to subscribe with.
- **Password reset and email change do not go through the drain.** They are
  Supabase Auth emails, and Supabase's built-in mailer only delivers to members
  of your Supabase organisation. §1.3 fixes that with Resend's SMTP, so it waits
  for §4.1 too.

### 0.3 State of play, confirmed 23.09.2026

- Supabase project `dgxtqvalfiisfpbwodew` (London, `eu-west-2`), API URL
  `https://dgxtqvalfiisfpbwodew.supabase.co`. All **81** migrations in the repo
  are applied; the newest is `20260925100100`.
- **No Edge Function is deployed** — the project's function list is empty. Not
  just `notify-drain` and `finance-reports`: none of the seven.
- `settings.edge_base_url` is **not set**, the Vault has **no** `service_role_key`,
  and `cron.job` is **empty**. `install_job_schedules()` has never run.
- `job_schedules` has **seven** rows enabled (`auto-staffing-cutoff`,
  `auto-staffing-escalation`, `auto-staffing-hourly`, `booking-tick`,
  `compliance-daily`, `finance-reports`, `notify-drain`) and one disabled
  (`willo-invite`). The moment you run `install_job_schedules()` all seven fire,
  which is why §4.6 deploys six functions and not two.
- `notification_outbox` has no unsent rows and `job_runs` has no `notify-drain`
  row — the queue is empty because nothing has happened on the live project yet.
- `settings.senders` is the seeded pair, `admin@` and `timesheets@`
  `thehospitalitycompany.co.uk`.
- GitHub: `main` is the default branch and now reads `"protected": true`
  (it read `false` on the morning of 23.09 per OWNER-TODO, so something was
  turned on since — §2.1 says what to check). The last `ci` run on `main`
  (#210) ran `deploy-database` to completion, so the three deploy secrets exist.
- Vercel: three projects `office-thc`, `thc-portal-staff`, `thc-portal-client`
  in team `saveezirfan0-3688s-projects`; the Staff App has only the domain
  `thc-portal-staff.vercel.app`. The variables each holds are in §3.1.
- The security advisor's findings are the ones docs/14 §4 lists, plus two
  `extension_in_public` warnings (`postgis`, `pg_net`) that `20260921123503`
  chose to leave, and `rls_auto_enable()` no longer appears in the
  anon-executable list (the revoke worked).

---

## 1 · Supabase Auth

Dashboard: https://supabase.com/dashboard/project/dgxtqvalfiisfpbwodew

### 1.1 Email OTP expiry → `86400`

**What it is.** The lifetime, in seconds, of every one-time token Supabase Auth
issues by email. Three flows in this product ride on it:

- **E3, the activation link** (§2.7, §2.8). Accept creates the login and mints a
  GoTrue `invite` (or `magiclink` for a returning applicant) token with
  `auth.admin.generateLink`; the Staff App spends it with
  `verifyOtp({ token_hash })` on submit (`packages/db/src/activation.ts`,
  `apps/staff/app/activate/actions.ts`). A candidate who opens the email the
  next morning must not find it dead.
- **Password reset** (§10.2 A3): `resetPasswordForEmail` in
  `apps/staff/app/forgot/actions.ts`.
- **Email change** (§10.1): the six-digit code in
  `apps/staff/app/profile/actions.ts`.

`supabase/config.toml` sets `otp_expiry = 86400` for local development and CI.
The hosted project does **not** read that file; the value lives in the dashboard.
86400 (24 h) is the maximum Supabase allows.

**Where.** https://supabase.com/dashboard/project/dgxtqvalfiisfpbwodew/auth/providers
→ **Email** → **Email OTP Expiration** → `86400` → Save.

**Verify.** Reload the page: the field reads 86400. The security advisor
(https://supabase.com/dashboard/project/dgxtqvalfiisfpbwodew/advisors/security)
will from now on show a warning that the OTP expiry exceeds one hour. That is
expected and deliberate; it is the trade §2.7 asks for, and docs/14 §4 should
list it as such. Optional check from a terminal:

```bash
curl -s "https://api.supabase.com/v1/projects/dgxtqvalfiisfpbwodew/config/auth" \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>" | grep -o '"mailer_otp_exp":[0-9]*'
```

### 1.2 Leaked-password protection

**What it is.** Supabase Auth checks a new password against HaveIBeenPwned and
refuses one that has appeared in a breach. It is the only security-advisor
finding on this project that is nobody's design decision (docs/14 §4).

**Where.** https://supabase.com/dashboard/project/dgxtqvalfiisfpbwodew/auth/providers
→ **Email** → **Prevent use of leaked passwords** → on → Save. (Older dashboards
put it under Authentication → Settings → Security at
https://supabase.com/dashboard/project/dgxtqvalfiisfpbwodew/settings/auth.)

**If the toggle is greyed out.** It is a **Pro plan and above** feature
(https://supabase.com/docs/guides/auth/password-security). The project is then on
the Free plan. Either upgrade the organisation
(https://supabase.com/dashboard/org/_/billing — Pro is also what unlocks 7-day
log retention, Storage image transforms and daily backups, all of which this
product benefits from), or leave it and ask a session to record it in docs/14 §4
as "plan-limited, not a lapse" so the next reader does not chase it.

**Verify.** Re-run the advisor; `auth_leaked_password_protection` is gone.

### 1.3 URL configuration, custom SMTP and two email templates

These are not in `OWNER-TODO.md` and they are needed for the two Auth emails
above to reach a worker.

**1.3a URL configuration.** The reset link that Auth emails must come back to
the Staff App, and Auth only redirects to an allow-listed origin.

- https://supabase.com/dashboard/project/dgxtqvalfiisfpbwodew/auth/url-configuration
- **Site URL:** `https://thc-portal-staff.vercel.app`
- **Redirect URLs:** add `https://thc-portal-staff.vercel.app/**` (the app's
  callback is `/auth/callback?next=/reset`; the glob covers the query string).
  Add the custom domain here too when §3.5 happens.

**1.3b Custom SMTP.** Supabase's built-in mailer "will refuse to deliver messages
to addresses that are not part of the project's team" and is rate-limited to a
handful per hour (https://supabase.com/docs/guides/auth/auth-smtp). Until this is
done, Forgot password works for you and nobody else. Do it once §4.1's domain is
Verified:

- https://supabase.com/dashboard/project/dgxtqvalfiisfpbwodew/auth/smtp →
  **Enable Custom SMTP**
- Sender email `admin@thehospitalitycompany.co.uk`, sender name
  `The Hospitality Company`
- Host `smtp.resend.com`, port `465`, username `resend`, password = a Resend API
  key (§4.2; a second key named `thc-auth-smtp` keeps the two uses separable)
- Then https://supabase.com/dashboard/project/dgxtqvalfiisfpbwodew/auth/rate-limits
  → raise **Emails sent per hour** from the 30 Supabase applies to a new SMTP
  setup, to what ~1,000 workers resetting passwords needs (60 is plenty).

**1.3c Templates.** https://supabase.com/dashboard/project/dgxtqvalfiisfpbwodew/auth/templates

- **Reset password** — keep `{{ .ConfirmationURL }}`; the default is fine.
- **Change email address** — the app asks the worker for a **six-digit code**
  (`verifyOtp({ type: 'email_change', token })`), so the template must contain
  `{{ .Token }}`. The stock template contains only a link; add a line
  `Your code: {{ .Token }}`.
- **Secure email change** (Email provider settings): the app's copy says the
  code goes to the new address and the old one stays until it is entered. If a
  test from `/profile/details` asks for confirmation on both addresses, this
  toggle is on and the flow needs a decision — turn it off, or ask a session to
  handle the double confirmation. Test it once SMTP is on.

**Verify.** Staff App → `/forgot` with your own worker address → the email arrives
from `admin@` and its link lands on `/reset`, not on a Vercel login wall.

### 1.4 What created `public.rls_auto_enable()`?

**What it is.** A `SECURITY DEFINER` function that exists on the live project and
in no migration in this repository. It manipulates row-level security and was
callable by anyone until `20260922183013` revoked EXECUTE from `public`, `anon`
and `authenticated`. Nobody has said where it came from.

**What a session found, confirmed 23.09.2026 (read-only):**

- Signature `public.rls_auto_enable()`, owner **`postgres`**, `plpgsql`,
  `SECURITY DEFINER`, `search_path = pg_catalog`. Its ACL is now
  `{postgres=X/postgres,service_role=X/postgres}` — the revoke held.
- It is the target of an **event trigger** named **`ensure_rls`** on
  `ddl_command_end` for `CREATE TABLE`, `CREATE TABLE AS` and `SELECT INTO`,
  also owned by `postgres`, and it is **enabled**.
- Its body is the widely circulated "turn RLS on for every new table in
  `public`" snippet: it loops over `pg_event_trigger_ddl_commands()`, runs
  `alter table … enable row level security` on each new table in `public`, and
  `RAISE LOG`s `rls_auto_enable: enabled RLS on …`. It reads nothing, sends
  nothing, and grants nothing.
- **No recorded migration created it.** Searching every statement in
  `supabase_migrations.schema_migrations` for the name finds only the two
  hardening migrations that mention it. So it did not arrive by `db push` or by
  a session's `apply_migration`; it arrived through a direct connection as
  `postgres` — the dashboard SQL editor, the dashboard Assistant, or an MCP
  `execute_sql` — which record nothing.

**Where to look for the origin.**

1. SQL editor saved snippets: https://supabase.com/dashboard/project/dgxtqvalfiisfpbwodew/sql
   — search Private, Shared and Favourites for `rls_auto_enable` or
   `ensure_rls`. A hit here is the answer.
2. The Assistant panel's history in the same project, for a prompt like "enable
   RLS on new tables automatically".
3. Postgres logs: https://supabase.com/dashboard/project/dgxtqvalfiisfpbwodew/logs/postgres-logs
   — search `rls_auto_enable`. The function logs every time it fires, so the
   earliest hit bounds when it was created. Retention is a day on Free and a
   week on Pro, so this only helps if a table was created recently.
4. The organisation audit log (Team/Enterprise plans only):
   https://supabase.com/dashboard/org/_/audit.

**Inspect it yourself** at https://supabase.com/dashboard/project/dgxtqvalfiisfpbwodew/sql/new:

```sql
-- the function: owner, definer flag, grants, body
select p.oid::regprocedure::text as signature,
       pg_get_userbyid(p.proowner)  as owner,
       p.prosecdef                  as security_definer,
       p.proacl::text               as grants,
       p.proconfig::text            as config,
       p.prosrc                     as body
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'rls_auto_enable';

-- the event trigger that calls it
select evtname, evtevent, evtowner::regrole::text as owner,
       evtfoid::regproc::text as function, evtenabled, evttags
  from pg_event_trigger
 where evtfoid::regproc::text like '%rls_auto_enable%';

-- did any recorded migration create it? (expect only the two that revoke it)
select version, name
  from supabase_migrations.schema_migrations
 where array_to_string(statements, ' ') ilike '%rls_auto_enable%'
 order by version;
```

**What to do with it.**

- **If you (or someone with dashboard access) ran that snippet**: the mystery
  is solved. It is harmless in effect — every table in this repository enables
  RLS itself and pgTAP `001_rls_guard` asserts it — but it must be *recorded*,
  because CI and local runs do not have it and a future difference would be
  invisible. Ask a session for a migration that either **adopts** it (creates
  the same function and trigger, with the revokes) or **removes** it:

  ```sql
  drop event trigger if exists ensure_rls;
  drop function if exists public.rls_auto_enable();
  ```

  Removing is the smaller surface and the recommendation. Do not drop it by
  hand in the SQL editor: that is exactly the unrecorded change this question
  is about.
- **If nobody recognises it**: treat it as an unattributed write to the
  production database by someone holding the `postgres` password or dashboard
  access. Reset the database password
  (https://supabase.com/dashboard/project/dgxtqvalfiisfpbwodew/settings/database
  → Database password; then update the `SUPABASE_DB_PASSWORD` GitHub secret,
  §2.2), review who is in the Supabase organisation
  (https://supabase.com/dashboard/org/_/team), and then remove it as above.

---

## 2 · GitHub

Repository: https://github.com/saveezirfan0-cloud/thc-portal

### 2.1 Branch ruleset on `main`

**Why.** Several sessions push to `main` on the same day, and nothing stops one
landing a red build (OWNER-TODO §2). A ruleset makes every change a pull
request that `build-test` has passed.

**Confirmed 23.09.2026:** the branches API now reports `main` as
`"protected": true`, whereas OWNER-TODO recorded `false` that morning. Something
has been enabled since; what it requires is not readable from a session. Open
https://github.com/saveezirfan0-cloud/thc-portal/settings/rules and check the
rule has all three parts below. If there is only a classic branch-protection
rule at https://github.com/saveezirfan0-cloud/thc-portal/settings/branches,
that is fine too as long as the same three parts are on.

**Where.** https://github.com/saveezirfan0-cloud/thc-portal/settings/rules/new?target=branch

1. **Ruleset name** `main`; **Enforcement status** Active.
2. **Target branches** → Add target → **Include default branch** (`main` has
   been the default since 22.09, docs/15-open-questions O13).
3. **Bypass list**: leave empty. Adding yourself defeats the point; if you
   ever need an emergency push, disable the rule for ten minutes and re-enable.
4. **Rules**, tick:
   - **Restrict deletions**
   - **Require a pull request before merging** — Required approvals **0**
     (you cannot approve your own pull request, so 1 would block every solo PR).
   - **Require status checks to pass** → Add checks → search **`build-test`**
     and add it. It is the **job** name, not the workflow (`ci`); a rule that
     names `ci` never turns green. Tick **Require branches to be up to date
     before merging** — with parallel sessions this is what catches the
     merge that is green on its own and red on top of the other.
   - **Block force pushes**
5. Create.

**Verify.** `git push origin main` from any clone is refused with
`GH013: Repository rule violations found`; a pull request's merge box lists
`build-test` as **Required**. Sessions must now open pull requests, which
`CLAUDE.md` and `docs/10-working-with-agents.md` already require.

### 2.2 The three `deploy-database` secrets

**What they do.** The `deploy-database` job in `.github/workflows/ci.yml` runs
`supabase db push` after `build-test` is green on a push to `main`, so a merge
that proves itself reaches the live database on its own (docs/12 Tier 2). The
job skips with a notice, rather than failing, when any secret is missing.

**Confirmed 23.09.2026:** all three are set — run #210's `deploy-database` job
executed "check the deploy secrets are present", "list the migrations still to
apply" and "apply them", all successful.

**Where they go.** https://github.com/saveezirfan0-cloud/thc-portal/settings/secrets/actions
→ New repository secret.

| Secret | Value | Where it comes from |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | a personal access token, `sbp_…` | https://supabase.com/dashboard/account/tokens → Generate new token, name it `github deploy-database`. Shown once. It acts as you; rotate it if it is ever pasted anywhere. |
| `SUPABASE_PROJECT_ID` | `dgxtqvalfiisfpbwodew` | The project reference — the subdomain of the API URL. |
| `SUPABASE_DB_PASSWORD` | the database password | Set when the project was created and not shown again. Reset it at https://supabase.com/dashboard/project/dgxtqvalfiisfpbwodew/settings/database → **Database password**; nothing else in this system uses the password (the apps use keys), so a reset breaks only this secret until it is updated. |

**Verify.** https://github.com/saveezirfan0-cloud/thc-portal/actions/workflows/ci.yml
→ the latest `main` run → `deploy-database` → "apply them" ends with
`Finished supabase db push.` A skipped job prints
`Database deploy skipped — missing secret(s): …` naming the one to add.

**Optional hardening** the workflow's own comment asks for: move the three to a
GitHub *environment* named `production` restricted to `main`
(https://github.com/saveezirfan0-cloud/thc-portal/settings/environments →
New environment → Deployment branches and tags → Selected branches → `main`),
then ask a session to add `environment: production` to the `deploy-database`
job, then delete the repository-level copies. Until then any workflow file on
any branch can read them.

### 2.3 The default branch, and two smaller settings

- **Keep `main` as the default branch.** It was an agent branch until 22.09
  (docs/15-open-questions O13), which silently disabled a `workflow_run`
  deploy for five merges. Rulesets targeting "default branch", the base a new
  pull request proposes, and any future `schedule`-triggered workflow all
  depend on it. Check: https://github.com/saveezirfan0-cloud/thc-portal/settings
  → Default branch.
- **Labels** for bot routing (docs/12 "What else"): `domain:onboarding`,
  `domain:scheduling`, `domain:compliance`, `domain:checkin`, `domain:reports`,
  `domain:client-portal`, `domain:staff-pwa`, `domain:platform`,
  `domain:design-system` at https://github.com/saveezirfan0-cloud/thc-portal/labels.
- **Claude GitHub App** installed on the repository so sessions can open pull
  requests: https://github.com/apps/claude/installations/select_target.

---

## 3 · Vercel

Team `saveezirfan0-3688's projects` (slug `saveezirfan0-3688s-projects`). Env
vars for a project:
`https://vercel.com/saveezirfan0-3688s-projects/<project>/settings/environment-variables`
with `<project>` one of `office-thc`, `thc-portal-staff`, `thc-portal-client`.

### 3.1 The env-var matrix

Status columns are what each project held on **23.09.2026** (names and scopes
only; values are never read). "P" = Production, "Pv" = Preview.

| Variable | office-thc | thc-portal-staff | thc-portal-client | Exposure | Why |
|---|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | set, P+Pv | set, P+Pv | set, **P only** | browser | Where the apps talk to. `packages/db/src/env.ts` throws without it; a build without it answers 503 on every route (docs/14 §7). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | set, P+Pv | set, P+Pv | set, **P only** | browser | The public key; RLS is what protects the data (§1.4). |
| `SUPABASE_SERVICE_ROLE_KEY` | set, P+Pv | set, P+Pv | set, P+Pv | **server only** | Server actions that must bypass RLS on purpose (Accept creates a login, Storage writes, admin-only tables). Never under a `NEXT_PUBLIC_` name. |
| `APP_TZ` | set, P+Pv | set, P+Pv | set, P+Pv | server | Always `Europe/London` (§1.8); `next.config.ts` defaults it, the variable pins it. |
| `NEXT_PUBLIC_STAFF_URL` | set, P+Pv | **add** | set, P+Pv | browser | Office: the origin E3's `/activate/:token` link is built on (`apps/office/app/onboarding/actions.ts` refuses Accept in production without it) and the `/privacy` link. Client: the `/privacy` link. **Staff: the origin password-reset links come back to** (`apps/staff/app/forgot/actions.ts`); without it the app falls back to `VERCEL_URL`, the deployment's unique per-build hostname. That used to mean a Vercel login wall; SSO protection was turned off on 25.09, so now it means something worse in one respect — the link resolves, but it points at one specific build, so it rots as soon as the next deploy lands. Set it. Value today: `https://thc-portal-staff.vercel.app`. |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | — | **add in §4.5** | — | browser | The key the browser subscribes with (`apps/staff/lib/push.ts`). Absent, the app reports "Notifications are not available yet" and never asks permission. Must equal the Supabase `VAPID_PUBLIC_KEY`. |
| `APPLY_CALLER_SALT` (or `APPLY_THROTTLE_SALT`) | — | **set** — present as `APPLY_THROTTLE_SALT`, P+Pv (23.09); either name is read | — | **server only** | HMAC salt for `/apply`'s per-caller limit (ADR-0024, §2.1, docs/14 §4 "unthrottled per caller"), read by `apps/staff/lib/callerKey.ts`. Only a hash of the caller's address is stored; rotating it resets the counters. See the note below. |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | optional | optional | — | browser | Raster tiles under the venue map (`apps/office/app/venues/VenueMap.tsx`) and the home-address pin (`apps/staff/app/onboarding/_components/PinMap.tsx`). Without it the maps draw their own surface with no tiles (ADR-0005). §6.2. |
| `MAPBOX_TOKEN` | optional | — | — | server only | Reverse geocoding for the venue pin (`apps/office/app/venues/actions.ts`); falls back to the public token. §6.2. |
| `RESEND_API_KEY` | do not set | do not set | do not set | — | `turbo.json` and docs/04 list it, but no app reads it. It is a **Supabase** secret (§4.4). |

**The salt already exists under its earlier name.** The variable on
`thc-portal-staff` was created on 23.09 as **`APPLY_THROTTLE_SALT`**;
`apps/staff/lib/callerKey.ts` (ADR-0024) reads `APPLY_CALLER_SALT` first and
`APPLY_THROTTLE_SALT` second, so **no rename is needed**. Only if neither is set
does the app use its built-in fallback salt and log `APPLY_CALLER_SALT is not
set` once per cold start — the limit still works, but the fallback is in the
repository, so anyone reading the table and the code could reverse a hash. To
generate a value, should you ever rotate it:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

**The client project's two `P only` entries** were re-created on 22.09 as
Production-only. Previews are off (§3.4), so nothing is broken; if a preview is
ever deployed deliberately it will 503 until they are added for Preview too.

### 3.2 Where the Supabase values come from

https://supabase.com/dashboard/project/dgxtqvalfiisfpbwodew/settings/api
(the newer dashboard calls the tab **API Keys**):

- **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
- **anon / public** (or **publishable**) → `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Use
  the reveal/copy button — a masked paste stores bullet characters and breaks
  sign-in (the comment on the Vercel variable records this happening).
- **service_role** under **Legacy API keys** (the long `eyJ…` JWT) →
  `SUPABASE_SERVICE_ROLE_KEY`. This same value goes into the Vault in §4.7, and
  the Edge Functions compare it byte for byte, so it must be this key and not
  a newer `sb_secret_…` key.

### 3.3 Adding or changing a variable

Every variable, including server-only ones, is applied on the **next
deployment**. After adding or changing one: Deployments →
`https://vercel.com/saveezirfan0-3688s-projects/<project>/deployments` → the
latest Production deployment → ⋯ → **Redeploy**, and untick **Use existing
Build Cache** for any `NEXT_PUBLIC_` variable (those are inlined at build time).

### 3.4 Previews are disabled on purpose

Preview deployments are off on all three projects (docs/14 §6): 52 of 67
deployments in one day were previews nobody opened, against a 100/day
allowance. A push to any branch is what triggers a deployment, not a pull
request. Leave them off; to preview a branch, deploy it deliberately with
`vercel deploy` from that branch, or turn previews on for one project for an
afternoon and back off.

### 3.5 A custom domain for the Staff App

The Staff App is a PWA: install and Web Push need HTTPS on a real domain (§10.5,
ADR-0001). `thc-portal-staff.vercel.app` already satisfies that; a domain on
THC's name is a branding and trust step, not a technical one.

1. `https://vercel.com/saveezirfan0-3688s-projects/thc-portal-staff/settings/domains`
   → Add → e.g. `app.thehospitalitycompany.co.uk`.
2. At THC's DNS host, add the record Vercel shows: a `CNAME` for `app` to
   `cname.vercel-dns.com` (an apex domain needs an `A` record to Vercel's IP
   instead — Vercel prints it). Wait for **Valid Configuration** and the
   certificate.
3. Then update, in this order, and redeploy each project (§3.3):
   - `NEXT_PUBLIC_STAFF_URL` on **office-thc**, **thc-portal-client** and
     **thc-portal-staff** → `https://app.thehospitalitycompany.co.uk`
   - Supabase secret `STAFF_APP_URL` (§5.1) → the same value
   - Supabase Auth Site URL and Redirect URLs (§1.3a) → add the new origin
   - Willo's webhook URL is unaffected (it points at Supabase, not the app).
4. **Keep `thc-portal-staff.vercel.app` serving** (Vercel keeps it as a second
   domain). Push subscriptions and installed apps are per origin: workers who
   installed from the old domain keep receiving pushes only while the old
   origin still serves the service worker. New installs go on the new domain;
   old ones can reinstall at their own pace.

The suggested names in docs/12 are `office.`, `app.` and `clients.` on THC's
domain; the same steps apply to the other two projects, and only the Staff App's
origin is referenced by other systems.

### 3.6 Optional: a Firewall rate-limit on `/apply`

`/apply` is the one public write endpoint (§2.1). The database limits it per
email and per mobile (`20260922183012`) and the app now hashes the caller
(ADR-0024); a Vercel Firewall rule is a third layer in front of the app.

`https://vercel.com/saveezirfan0-3688s-projects/thc-portal-staff/firewall` →
Configure → **+ New Rule**: name `apply throttle`; conditions **Request Path**
equals `/apply` **and** **Method** equals `POST` (Next.js server actions POST to
the page's own path); action **Rate Limit**, e.g. 10 requests per 60 seconds
keyed by IP, fixed window, then **Deny**; **Publish**. The rate-limit action
needs the **Pro or Enterprise** plan
(https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting); on Hobby
the option is not offered, and the two application-level limits stand alone.

---

## 4 · Turn sending on

Every push and every email leaves through one Edge Function, `notify-drain`,
which pg_cron calls every minute (ADR-0020, docs/12 "The notification senders").
It serves the whole §8 register in `packages/notifications`: N1–N15, E1–E9,
the E2b extension (ADR-0017), CL1–CL6 (completion letter), and the document
emails D1/D2/BG08 with their PDF or CSV attached. Until this section is done
every row waits as "not configured" with its attempts intact.

### 4.1 Resend: the domain and its DNS

**Why.** Resend refuses to send from `admin@` or `timesheets@` until the domain
shows **Verified**; until then the drain gets a 4xx and either retries on its
backoff or fails the row (docs/12). Both mailboxes must be real and monitored:
§9.12 rules out no-reply, and every email sets `Reply-To` to its sender.

1. Create the account: https://resend.com/signup (THC's, ideally, since the
   hosting transfers at hand-over — docs/12 "Decide where production lives").
2. https://resend.com/domains → **Add Domain** → `thehospitalitycompany.co.uk`
   → region **EU (Ireland)** (UK data; the region only sets where the sending
   infrastructure lives).
3. Resend shows the records to publish at THC's DNS host (`dig NS
   thehospitalitycompany.co.uk` tells you who that is). Copy each exactly as
   shown; the placeholders below are the shapes, not the values:

   | Purpose | Type | Name (host) | Value |
   |---|---|---|---|
   | DKIM | `TXT` | `resend._domainkey` | `p=<long key Resend shows>` |
   | SPF (bounce subdomain) | `MX` | `send` | `feedback-smtp.eu-west-1.amazonses.com`, priority `10` |
   | SPF (bounce subdomain) | `TXT` | `send` | `v=spf1 include:amazonses.com ~all` |
   | DMARC | `TXT` | `_dmarc` | `v=DMARC1; p=none;` |

   Resend puts SPF on the `send.` subdomain, so an existing SPF record on the
   root (Microsoft 365, Google Workspace) is untouched; the DKIM selector
   `resend` collides with nothing. Start DMARC at `p=none` — it only reports —
   and tighten to `quarantine` after a month of clean reports.
4. Back in Resend, **Verify**. Propagation is minutes to 48 hours. Do not set
   `RESEND_API_KEY` in §4.4 before the status reads **Verified**.

**Verify.** https://resend.com/domains shows the domain **Verified** with every
record green.

### 4.2 Resend: the API key

https://resend.com/api-keys → **Create API Key** → name `thc-notify-drain`,
permission **Sending access**, **domain restricted** to
`thehospitalitycompany.co.uk` → copy it once (`re_…`). It goes into Supabase
in §4.4 and nowhere else. Make a second one named `thc-auth-smtp` for §1.3b so
either can be rotated alone.

### 4.3 The VAPID key pair

**What it is.** Web Push (§10.5) signs every push with a private key and the
browser subscribes with the matching public key; the push service rejects a
message signed by a different pair. `packages/notifications/src/webpush.ts`
expects the public key as a 65-byte uncompressed P-256 point in base64url
(87 characters, starting with `B`) and the private key as 32 bytes (43
characters).

```bash
npx web-push generate-vapid-keys
```

Save both in a password manager. **Generate the pair once.** Rotating it
silently orphans every device already subscribed — they re-subscribe the next
time the app opens, and every push in between is lost (docs/12).

### 4.4 Supabase CLI: login, link, secrets

From a terminal in a clone of the repository (Node 22):

```bash
npm i -g supabase                       # or: brew install supabase/tap/supabase
supabase login                          # opens the browser; or --token <SUPABASE_ACCESS_TOKEN>
cd <repo root>
supabase link --project-ref dgxtqvalfiisfpbwodew   # asks for the database password
```

`link` writes to `supabase/.temp/`, which is git-ignored. Then the four secrets
the drain reads (`readDrainConfig` in `packages/notifications/src/drain.ts`):

```bash
supabase secrets set \
  RESEND_API_KEY=<re_…  only once the domain is Verified> \
  VAPID_PUBLIC_KEY=<B…  87 chars> \
  VAPID_PRIVATE_KEY=<43 chars> \
  VAPID_SUBJECT=mailto:admin@thehospitalitycompany.co.uk
```

The dashboard does the same at
https://supabase.com/dashboard/project/dgxtqvalfiisfpbwodew/settings/functions
(**Edge Function Secrets**). `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are
injected by Supabase itself; do not set them. A deployed function picks up
changed secrets on its next invocation, no redeploy needed.

**Verify.** `supabase secrets list` prints the names with a digest of each value.

**If a channel's secrets are missing** (docs/12): every row on that channel is
held with `error` = "not configured …", no attempt is counted, and it is looked
at again every 5 minutes; the other channel still sends.

### 4.5 `NEXT_PUBLIC_VAPID_PUBLIC_KEY` on the staff project

`https://vercel.com/saveezirfan0-3688s-projects/thc-portal-staff/settings/environment-variables`
→ Add → key `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, value the **same public key** as
§4.4, Production and Preview → Save → **Redeploy without build cache** (§3.3).

**Verify.** Staff App → `/notifications` no longer shows the amber
"Notifications are not switched on for this version of the app" banner, and
**Turn on notifications** is enabled. (On iPhone the screen first asks for the
app to be added to the home screen — iOS 16.4+ delivers push only to an
installed PWA.)

### 4.6 Deploy the Edge Functions — all six job functions, not two

**Why six.** `install_job_schedules()` (§4.7) schedules every enabled row of
`job_schedules`, and seven rows are enabled (§0.3). OWNER-TODO names only
`notify-drain` and `finance-reports` because they were the two still to build;
the other four have never been deployed to this project either. Deploying two
and scheduling seven means `booking-tick`, `compliance-daily` and the three
`auto-staffing` entries post at a 404 every minute or five — and the 12:05
cutoff, the No-show timer and the compliance sweep silently do not happen.

**Run from the repository root** (ADR-0020: the functions import
`packages/notifications`, `packages/db` and `packages/pdf` by relative path,
`../../../packages/…`). Deploy by name — do not run a bare
`supabase functions deploy`, because `willo-webhook` needs a flag the others
must not have (§5.2):

```bash
cd <repo root>
supabase functions deploy auto-staffing
supabase functions deploy booking-tick
supabase functions deploy compliance-daily
supabase functions deploy finance-reports
supabase functions deploy gdpr-purge
supabase functions deploy notify-drain
```

The CLI bundles through Supabase's API by default; Docker is not needed.

**If the bundler refuses `../../../packages`** (ADR-0020 §1 says this is an
expectation, not yet an observation): try the other bundling mode
(`--use-docker`, or `--use-api` if Docker was the default in your CLI version).
If both refuse, stop and give a session the exact error: the fallback is
ADR-0006 option 4 (publish the package to a registry Deno can reach and import
it with an `npm:` specifier), which is a code change, not a console setting.
`finance-reports`, `auto-staffing` and `notify-drain` all depend on the same
thing, so the first deploy of any of them settles it for all.

**A gap to hand to a session:** `gdpr-purge` drains `storage_deletions` (the
Storage half of a §1.7 removal, `20260922081512`) but **no `job_schedules` row
exists for it**, so nothing will call it. Deploy it anyway; ask a session for a
migration adding the row (and to pgTAP `190`'s enabled list), then re-run
`install_job_schedules()`.

**Verify.**

```bash
supabase functions list
```

lists the six as `ACTIVE`; https://supabase.com/dashboard/project/dgxtqvalfiisfpbwodew/functions
shows them. Call one directly — the gateway checks the JWT and `_shared/job.ts`
checks the bearer against its own service key:

```bash
curl -s -X POST "https://dgxtqvalfiisfpbwodew.supabase.co/functions/v1/notify-drain" \
  -H "Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"job":"notify-drain"}'
```

Expected: `{"job":"notify-drain","ok":true,"counts":{"claimed":0}}` and a new
row in `job_runs`. With the anon key instead you get
`{"error":"service role required"}` (401); with no header, the gateway's 401.

### 4.7 SQL: `edge_base_url`, the Vault secret, `install_job_schedules()`

**Why.** `install_job_schedules()` (`20260921130927`) builds each cron command
as `net.http_post(url := settings.edge_base_url || '/<edge_path>', headers :=
'Bearer ' || vault secret service_role_key, …)`. Both are read when the command
*runs*, not when it is installed, so neither is baked into a stored string. The
same two values let the `willo_invite_nudge` trigger (`20260924110000`) call the
Willo sweep the moment a candidate is due. Without `edge_base_url` the function
raises `settings.edge_base_url is not set; nothing can be scheduled`; without
the Vault secret every posted request is rejected 401.

Open https://supabase.com/dashboard/project/dgxtqvalfiisfpbwodew/sql/new. The
editor runs as `postgres`, which owns `settings` and may write the Vault.

**Step 1 — the base URL.** `settings.value` is `jsonb`; the function reads it
with `value #>> '{}'`, so store a JSON **string**, with no trailing slash (the
function prepends `/` to each `edge_path`):

```sql
insert into public.settings (key, value)
values ('edge_base_url',
        to_jsonb('https://dgxtqvalfiisfpbwodew.supabase.co/functions/v1'::text))
on conflict (key) do update
  set value = excluded.value, updated_at = now();

-- check: exactly this, no quotes, no trailing slash
select value #>> '{}' as edge_base_url from public.settings where key = 'edge_base_url';
```

**Step 2 — the Vault secret.** The value is the **legacy `service_role` JWT**
from §3.2 — the same string the Vercel projects hold as
`SUPABASE_SERVICE_ROLE_KEY` — because `supabase/functions/_shared/job.ts`
compares the bearer token character for character with the
`SUPABASE_SERVICE_ROLE_KEY` Supabase injects into every function. A different
key form is a permanent 401. The name must be exactly `service_role_key`.

```sql
select vault.create_secret(
  '<SUPABASE_SERVICE_ROLE_KEY>',
  'service_role_key',
  'Bearer pg_cron and willo_invite_nudge send to the Edge Functions (install_job_schedules)'
);

-- check without printing the value
select name, created_at from vault.secrets where name = 'service_role_key';
select name, length(decrypted_secret) as chars, left(decrypted_secret, 3) as starts_with
  from vault.decrypted_secrets where name = 'service_role_key';   -- starts_with = eyJ
```

Clear the editor afterwards; the dashboard keeps SQL history. The Vault UI at
https://supabase.com/dashboard/project/dgxtqvalfiisfpbwodew/integrations/vault/secrets
does the same job if you prefer a form. **If the service role key is ever
rotated again** (it was on 22.09), update this too:

```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'service_role_key'),
  '<NEW_SUPABASE_SERVICE_ROLE_KEY>'
);
```

together with the three Vercel projects; the functions receive the new one
automatically.

**Step 3 — install the schedules.** Only after §4.6:

```sql
select public.install_job_schedules();   -- returns 7 today; 8 once willo-invite is enabled
```

It is idempotent: it unschedules every registered job and re-schedules the
enabled ones. Re-run it after any migration that changes `job_schedules`.

```sql
select jobname, schedule, active from cron.job order by jobname;
```

### 4.8 Verify the jobs are running

Wait a minute or two, then in the SQL editor:

```sql
-- every job writes one row per run (§7)
select job, started_at, finished_at, ok, counts, error
  from public.job_runs
 order by started_at desc
 limit 20;

-- the drain specifically (docs/12): counts has sent/retried/failed/unconfigured,
-- and notConfigured lists any missing secrets
select job, started_at, ok, counts, error
  from public.job_runs
 where job = 'notify-drain'
 order by started_at desc
 limit 5;

-- pg_cron's own log: did the post go out, and what did pg_net say?
select j.jobname, d.status, d.return_message, d.start_time
  from cron.job_run_details d
  join cron.job j on j.jobid = d.jobid
 order by d.start_time desc
 limit 20;

-- the HTTP answers, when a job never reaches job_runs (a 404 = function not deployed,
-- a 401 = wrong Vault secret)
select id, status_code, error_msg, left(content::text, 160) as body, created
  from net._http_response
 order by created desc
 limit 20;
```

Healthy: a `notify-drain` row every minute with `ok = true`; `booking-tick` every
minute; the `*/5` jobs every five minutes with `ok = true` and small counts;
`status_code` 200 throughout. Edge Function logs:
https://supabase.com/dashboard/project/dgxtqvalfiisfpbwodew/logs/edge-functions.

### 4.9 The smoke test

**Push.** On a phone, open `https://thc-portal-staff.vercel.app` as a worker
(iPhone: add to the home screen first and open it from there) → `/notifications`
→ **Turn on notifications** → allow. Then from the Back Office, invite that
worker to a shift on an event page (N5, the first push in the register). Within
a minute the notification arrives, and:

```sql
select key, channel, template, attempts, sent_at, failed_at, error
  from public.notification_outbox
 where template = 'N5'
 order by id desc limit 5;
```

shows `sent_at` set. A row that says `no device` means the subscription was not
saved — check `push_subscriptions` for the worker.

**Email.** On an event page, **Send** the allocation sheet or the sign-out
timesheet (D1/D2, ADR-0015) to a client whose contact email is yours (create a
test client for this; the seeded ones use `example.com`). The email arrives from
`The Hospitality Company <timesheets@thehospitalitycompany.co.uk>` with the PDF
attached; the outbox row shows `sent_at`; https://resend.com/emails lists it as
delivered.

### 4.10 The senders row on `/settings`

The From addresses are not secrets and not env vars: they are the `senders` row
in `settings`, edited on the Back Office `/settings` page under **Sender
addresses** (§9.12) and read by the drain on every run, so a change applies from
the next minute. Both must be on the Resend-verified domain; a missing,
malformed or no-reply address makes the drain fall back to the seeded
`admin@`/`timesheets@` and log why (`packages/notifications/src/senders.ts`).

The same page holds the other four things §6, §2.4, §3.4, §9.11 and the
completion-letter requirement say THC changes "without a release": the
auto-assign **scoring weights** (must sum to 1.00), the **auto-assign limits**
(the 2-hour different-venue gap, the escalation radius), the **rota guard** (what
happens when a booking would take a worker over 48 hours without a signed
opt-out: block, the default, or allow and warn — Student-visa limits and
right-to-work expiry are never configurable), the **Willo stage map** (§5.5) and
the **standard geofence radii by venue type**. Nothing on that page needs a
deploy.

---

## 5 · Willo, once THC sends the keys

ADR-0021 built the receiver and the create-candidate sweep on an **assumed**
signing scheme and API shape, every part of which is configuration. Nothing
below is a claim about Willo's real API.

### 5.1 The secrets

```bash
supabase secrets set \
  WILLO_WEBHOOK_SECRET=<the signing secret from Willo's webhook settings> \
  WILLO_API_KEY=<THC's Willo API key> \
  WILLO_INTERVIEW_KEY=<the key of the interview candidates are invited to> \
  STAFF_APP_URL=https://thc-portal-staff.vercel.app
```

| Secret | Read by | If missing |
|---|---|---|
| `WILLO_WEBHOOK_SECRET` | `willo-webhook` (inbound) | **every** delivery is refused with 503; unsigned deliveries are never accepted |
| `WILLO_API_KEY`, `WILLO_INTERVIEW_KEY` | `willo-webhook/invite` (the sweep) | logs `no candidate created in Willo, no E1 sent`, leases nothing; every waiting candidate is picked up on the first run with keys |
| `STAFF_APP_URL` | `willo-webhook` (an Accept) | 500, so Willo retries and the delivery lands once it is set. Must match §3.5 if the domain changes. |

Optional overrides, only if Willo's documentation differs from the defaults in
`packages/db/src/willo.ts`:

| Override | Default |
|---|---|
| `WILLO_SIGNATURE_HEADER` | `x-willo-signature` (HMAC-SHA256 of the raw body; hex or base64; optional `sha256=`/`v1=` label; several comma-separated digests allowed) |
| `WILLO_TIMESTAMP_HEADER` | unset — set it only if Willo sends one; the signed message then becomes `{timestamp}.{raw body}` |
| `WILLO_TIMESTAMP_TOLERANCE_SECONDS` | `300` |
| `WILLO_API_BASE` | `https://api.willotalent.com/api/integrations/v2` |
| `WILLO_INVITE_PATH` | `/interviews/{interviewKey}/candidates/` |
| `WILLO_API_AUTH_HEADER` | `Authorization` |
| `WILLO_API_AUTH_PREFIX` | `Bearer ` (set it to an empty string for a bare key) |

### 5.2 Deploy with `--no-verify-jwt`

```bash
cd <repo root>
supabase functions deploy willo-webhook --no-verify-jwt
```

Willo signs its own deliveries and sends no Supabase JWT; the function verifies
the signature itself, and the `/invite` route checks the service key
(ADR-0021). **Every redeploy of this one function needs the flag**; a deploy
without it turns JWT verification back on and Willo gets 401s. To make that
impossible to forget, ask a session to add
`[functions.willo-webhook]` / `verify_jwt = false` to `supabase/config.toml`.
The dashboard shows the setting per function under
https://supabase.com/dashboard/project/dgxtqvalfiisfpbwodew/functions →
willo-webhook → Details.

### 5.3 Point Willo's webhook

In THC's Willo account, set the webhook URL to:

```
https://dgxtqvalfiisfpbwodew.supabase.co/functions/v1/willo-webhook
```

and subscribe it to the candidate events (new response, accepted, rejected).

### 5.4 Check ADR-0021's assumptions against the first sandbox delivery

Send one sandbox delivery of each kind and check, in order:

1. **Signature.** Function log at
   https://supabase.com/dashboard/project/dgxtqvalfiisfpbwodew/logs/edge-functions
   (filter `willo-webhook`): `signature refused` means the header name, digest
   encoding or signed input differs → set `WILLO_SIGNATURE_HEADER` /
   `WILLO_TIMESTAMP_HEADER`, or give a session the scheme so
   `verifyWilloSignature` can change.
2. **Payload.** `unreadable delivery` means `parseWilloEvent` did not find the
   event type, candidate key or stage in the usual places → a session adds the
   path.
3. **Stage names.** A stage change becomes the stage's name (`Accepted` →
   `accepted`) and is mapped by `settings.willo_stage_map` (§5.5).
4. **Create candidate.** Trigger the sweep once by hand and read the answer:

   ```bash
   curl -s -X POST "https://dgxtqvalfiisfpbwodew.supabase.co/functions/v1/willo-webhook/invite" \
     -H "Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>" \
     -H "Content-Type: application/json" -d '{"job":"willo-invite"}'
   ```

   `{"due":n,"created":n,"failed":0}` is right. A `create failed` log line names
   the status and body Willo returned → adjust `WILLO_API_BASE`,
   `WILLO_INVITE_PATH`, the auth header, or hand the body shape to a session.
5. **De-duplication.** ADR-0021's known edge: if Willo creates a candidate and
   the local link then fails, the next sweep creates them again. Ask Willo
   whether they de-duplicate by email.

Refusals no retry can change are answered 200 and recorded:

```sql
select created_at, action, details
  from public.audit_log
 where action like 'willo%'
 order by created_at desc
 limit 20;
```

### 5.5 The stage map and the review URL

- **Stage map:** Back Office `/settings` → **Willo stage map**. Set Willo's
  actual stage names for "new response", "accepted" and "rejected" (§2.4;
  "rejected" must stay on Rejected).
- **Review URL** (the link on a candidate's card to their interview in Willo):
  not on the settings page; set it once in SQL with `{id}` where the Willo
  candidate key goes:

  ```sql
  insert into public.settings (key, value)
  values ('willo_review_url_template', to_jsonb('https://app.willotalent.com/<path Willo uses>/{id}'::text))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  ```

### 5.6 Enable the `willo-invite` schedule

The schedule is registered **disabled** and pgTAP `190` lists the enabled ones,
so enabling it is a migration plus a test change, not a dashboard toggle. Ask a
session: "enable the `willo-invite` schedule (migration) and add it to `190`'s
list in the same commit." Once that deploys:

```sql
select public.install_job_schedules();   -- now 8
select jobname, schedule from cron.job where jobname = 'willo-invite';
```

**Verify.** `select job, ok, counts, error from public.job_runs where job =
'willo-invite' order by started_at desc limit 5;` shows runs every minute; a
new `/apply` submission shows up in Willo within a minute and the applicant gets
E1 from Willo.

---

## 6 · Other keys

### 6.1 `GEMINI_API_KEY` — document reading (§2.6)

**Where it is read: nowhere yet.** `apps/staff/app/onboarding/extractor.ts` is
the one provider seam and is **stubbed**: `documentExtractor()` returns `null`
in every environment (ADR-0014). When the Gemini provider is written it is
selected by `DOCUMENT_EXTRACTOR=gemini` with `GEMINI_API_KEY` set — as a
**server-only** variable on `thc-portal-staff` if the call stays in the wizard's
server action, or a Supabase secret if it moves to an Edge Function. Do not set
it anywhere until that code exists; it would do nothing.

**Without it:** every upload arrives flagged "needs manual review" and a manager
reads the dates off the document, which is the §2.6 behaviour when the AI is
unsure. Nothing is blocked.

**Where it comes from:** https://aistudio.google.com/apikey. Building the
provider needs THC's sample term-dates and completion letters (OWNER-TODO §5)
for the prompt.

### 6.2 Mapbox

**Where it is read.**

| Variable | File | What it does |
|---|---|---|
| `NEXT_PUBLIC_MAPBOX_TOKEN` | `apps/office/app/venues/VenueMap.tsx` | raster tiles under the venue map and the pin modal (§9.11) |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | `apps/staff/app/onboarding/_components/PinMap.tsx` | tiles under the home-address pin (§10.3, step 2 of 11) |
| `MAPBOX_TOKEN` (server), falling back to the public one | `apps/office/app/venues/actions.ts` | reverse geocoding: the address is looked up from the pin, never typed |

**Without them:** both maps draw their own Web Mercator surface with no tiles
(ADR-0005) — the pin, the circle and the slider all work — and "Look up address"
answers "Address lookup is not configured in this environment (MAPBOX_TOKEN)".

**Where they come from:** https://account.mapbox.com/access-tokens/.

- A **public** token (`pk.`) for `NEXT_PUBLIC_MAPBOX_TOKEN` on `office-thc` and
  `thc-portal-staff`. It is interpolated into tile URLs in the browser, so
  **restrict it by URL** in the Mapbox account to the three Vercel origins
  (ADR-0005: "or it is a bill anyone can run up").
- A **secret** token (`sk.`) with only the geocoding scope for `MAPBOX_TOKEN` on
  `office-thc`. Server-only.

Redeploy after adding (§3.3). Mapbox's free tier covers this product's volume.

### 6.3 Everything an Edge Function reads

Every `Deno.env.get` across `supabase/functions/`, confirmed by grep. All are
Supabase secrets (`supabase secrets set`), never Vercel.

| Name | Function(s) | Purpose | Set by |
|---|---|---|---|
| `SUPABASE_URL` | all, via `_shared/job.ts` | the project API URL | Supabase, automatically |
| `SUPABASE_SERVICE_ROLE_KEY` | all, via `_shared/job.ts` | the service client, and the bearer every job checks its caller against | Supabase, automatically |
| `RESEND_API_KEY` | `notify-drain` | email | §4.4 |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | `notify-drain` | Web Push signing | §4.4 |
| `WILLO_WEBHOOK_SECRET` | `willo-webhook` | verifies Willo's signature | §5.1 |
| `WILLO_API_KEY`, `WILLO_INTERVIEW_KEY` | `willo-webhook/invite` | create candidates in Willo | §5.1 |
| `STAFF_APP_URL` | `willo-webhook` | the origin of E3's `/activate/{token}` link on a Willo Accept | §5.1 |
| `WILLO_SIGNATURE_HEADER`, `WILLO_TIMESTAMP_HEADER`, `WILLO_TIMESTAMP_TOLERANCE_SECONDS`, `WILLO_API_BASE`, `WILLO_INVITE_PATH`, `WILLO_API_AUTH_HEADER`, `WILLO_API_AUTH_PREFIX` | `willo-webhook` | optional overrides | §5.1 |

`auto-staffing`, `booking-tick`, `compliance-daily`, `finance-reports` and
`gdpr-purge` read nothing beyond the first two. `finance-reports` reads the
payroll recipients from `settings.payroll_recipients`, not from the environment.

### 6.4 Everything the apps read

| Name | Read in | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | `packages/db/src/env.ts`, and directly in several actions as a "configured?" check | required, all three apps |
| `APP_TZ` | `next.config.ts` of each app | defaults to `Europe/London` |
| `NEXT_PUBLIC_STAFF_URL` | `apps/office/app/onboarding/actions.ts`, `apps/office/app/login/page.tsx`, `apps/office/app/onboarding/page.tsx`, `apps/client/app/login/page.tsx`, `apps/staff/app/forgot/actions.ts` | §3.1 |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | `apps/staff/lib/push.ts` | §4.5 |
| `APPLY_CALLER_SALT` | `apps/staff/lib/callerKey.ts` (ADR-0024) | §3.1; falls back to a built-in salt with a logged warning |
| *(no variable)* | `apps/staff/lib/postcodes.ts` (ADR-0025) | the home-address postcode is looked up at `api.postcodes.io` — open data, no key; unreachable means the address saves without a location |
| `NEXT_PUBLIC_MAPBOX_TOKEN`, `MAPBOX_TOKEN` | §6.2 | optional |
| `VERCEL_URL` | `apps/staff/app/forgot/actions.ts` | Vercel's own; only a fallback |

---

## 7 · Deploying code

### 7.1 What deploys itself

- **The three apps**: Vercel's Git integration builds each project on every
  push to `main` (root directories `apps/office`, `apps/staff`, `apps/client`;
  "skip unaffected projects" may skip an app whose dependencies did not change).
  Previews are off (§3.4). Progress and logs:
  `https://vercel.com/saveezirfan0-3688s-projects/<project>/deployments`.
- **The database**: the `deploy-database` job runs `supabase db push` on a push
  to `main` after `build-test` passes on that same commit (§2.2). It runs one at
  a time; a third merge while one runs and one waits cancels the waiting one,
  which shows as a red `ci` run whose tests all passed — read which job went red
  before treating it as a failure (the comment in `ci.yml`). No migration is
  lost: the newest run applies whatever is pending.

### 7.2 What never deploys itself

| Thing | How | When |
|---|---|---|
| Edge Functions | `supabase functions deploy <name>` from the repo root (§4.6, §5.2) | after any change under `supabase/functions/`, `packages/notifications/`, `packages/db/src/{willo,provision,activation}.ts` or `packages/pdf/src/csv.ts` — anything a function imports. A pull request that touches these should say "redeploy X"; hold the session to that. |
| Schedules | `select public.install_job_schedules();` (§4.7) | after any migration that inserts into or updates `job_schedules` |
| Supabase secrets | `supabase secrets set` | when a key changes |
| Auth settings, SMTP, templates, URL configuration | dashboard (§1) | manual, once |
| Generated types | `pnpm --filter @thc/db gen:types` against the linked project, then a pull request | docs/14 §4 says the placeholder is still in place; a session's job after the first deploy |
| Vercel env vars | dashboard, then redeploy (§3.3) | when a value changes |

### 7.3 If the migration history drifts

`deploy-database` refuses a migration whose version sorts below the newest one
already applied remotely, and applies nothing (docs/14 §3c: this stalled the
live database at #43 for two merges). It prints exactly that in "list the
migrations still to apply". The repair (docs/12):

```bash
cd <repo root>
supabase link --project-ref dgxtqvalfiisfpbwodew
supabase migration list                       # local vs remote, side by side
supabase db push --dry-run                    # what a push would do
# a file applied by hand that the history does not know about:
supabase migration repair --status applied <version>
# a version the history records that was never really applied:
supabase migration repair --status reverted <version>
```

`<version>` is the digits before the first underscore in the filename. Never
add `--include-all` to the workflow blind (the job's comment): read what it
would apply first.

---

## 8 · After go-live checks

### 8.1 The security advisor

https://supabase.com/dashboard/project/dgxtqvalfiisfpbwodew/advisors/security →
**Rerun linter**. Read it against docs/14 §4: 8 `SECURITY DEFINER` views
(ADR-0004, deliberate), `spatial_ref_sys` without RLS (ADR-0010), 6 definer
functions callable by `anon` (all deliberate, listed there), ~86 callable by
`authenticated` (the RPC surface; the number to watch, not a defect), two
extensions in `public` (`postgis`, `pg_net`; `20260921123503` leaves them),
and after §1.1 the OTP-expiry warning (deliberate). Anything **new** in the
`anon` list, or `rls_auto_enable` reappearing there, is worth a session.

### 8.2 Job health

```sql
-- the last run of every job, and whether it was ok
select distinct on (job) job, started_at, ok, counts, error
  from public.job_runs
 order by job, started_at desc;

-- failures in the last 24 hours
select job, started_at, error
  from public.job_runs
 where ok = false and started_at > now() - interval '24 hours'
 order by started_at desc;

-- a run that never finished (the function died mid-way)
select job, started_at
  from public.job_runs
 where finished_at is null and started_at < now() - interval '10 minutes';

-- is every enabled schedule actually installed?
select s.job, s.enabled, (c.jobid is not null) as installed
  from public.job_schedules s
  left join cron.job c on c.jobname = s.job
 order by s.job;
```

### 8.3 The outbox

```sql
-- waiting, held, retrying, failed
select
  count(*) filter (where sent_at is null and failed_at is null and error is null)                   as waiting,
  count(*) filter (where sent_at is null and failed_at is null and error like 'not configured%')     as held_no_keys,
  count(*) filter (where sent_at is null and failed_at is null and attempts > 0 and error not like 'not configured%') as retrying,
  count(*) filter (where failed_at is not null)                                                      as failed,
  count(*) filter (where sent_at > now() - interval '24 hours')                                      as sent_24h
  from public.notification_outbox;

-- the failed ones, with why
select id, key, channel, template, attempts, error, failed_at
  from public.notification_outbox
 where failed_at is not null
 order by failed_at desc
 limit 20;
```

### 8.4 When a notification did not arrive

1. **Is there a row?** `select * from public.notification_outbox where key like
   'N5:%' order by id desc limit 5;` (keys are `<code>:<subject>:<id>`). No row
   means the state change that should have queued it did not happen; look at
   the booking or document, not at the drain.
2. **`sent_at` empty, `error` "not configured …"** → the channel's secrets are
   missing (§4.4). No attempt has been spent.
3. **`failed_at` set** → read `error`. Resend 401/403 after six attempts means
   the key is wrong or the domain is not Verified; 400/422 means the message
   itself was refused (a bad recipient address on the client or worker
   record); "no device" on a push means the worker never turned notifications
   on (`select count(*) from public.push_subscriptions where staff_id = '<id>';`).
4. **`sent_at` set, nothing arrived.** Push: the device's subscription was
   pruned after a 404/410 from the push service (the worker uninstalled or
   revoked) — the next time they open the app it re-subscribes. Email:
   https://resend.com/emails shows delivered/bounced/complained; a bounce is
   the recipient's address, a spam placement is DMARC/DKIM (§4.1).
5. **No `notify-drain` row in `job_runs` for the last few minutes** → the
   schedule is not installed (§8.2's last query), the function is not deployed
   (`net._http_response` shows 404), or the Vault key is wrong (401). §4.8's
   queries name which.
6. Function logs for the run:
   https://supabase.com/dashboard/project/dgxtqvalfiisfpbwodew/logs/edge-functions
   — the drain logs one line per retry or failure with the outbox key.

---

## 9 · Closing table

One row per `OWNER-TODO.md` item, in its order, with where this guide covers it
and what a session could confirm on 23.09.2026. Tick the last column in
`OWNER-TODO.md` itself; this table is the map.

| OWNER-TODO | Item | Guide | Confirmed 23.09.2026 | Done |
|---|---|---|---|---|
| §1 | Auth → Email OTP Expiration → 86400 | §1.1 | not readable from a session | [ ] |
| §1 | Auth → leaked-password protection on | §1.2 | advisor still reports it **off** | [ ] |
| §1 | What created `public.rls_auto_enable()`? | §1.4 | function + `ensure_rls` event trigger, owner `postgres`, in no recorded migration; EXECUTE revoked | [ ] |
| — | Auth URL configuration, custom SMTP, two templates (not in OWNER-TODO) | §1.3 | not readable from a session | [ ] |
| §2 | Branch protection on `main` (PR + `build-test` + no force-push) | §2.1 | API reads `protected: true`; contents unverified | [ ] |
| §2 | The three `deploy-database` secrets | §2.2 | **set** — run #210 deployed | [x] |
| §3 | Resend domain verified (DKIM/SPF/DMARC) | §4.1 | — | [ ] |
| §3 | VAPID pair generated once | §4.3 | — | [ ] |
| §3 | `supabase secrets set RESEND_API_KEY VAPID_*` | §4.4 | — | [ ] |
| §3 | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` on thc-portal-staff | §4.5 | **absent** | [ ] |
| §3 | Deploy `notify-drain` and `finance-reports` (**and the other four**) | §4.6 | **no function deployed** | [ ] |
| §3 | `settings.edge_base_url`, Vault `service_role_key`, `install_job_schedules()` | §4.7 | **all three absent**; `cron.job` empty | [ ] |
| §3 | Smoke test: one push, one email | §4.9 | — | [ ] |
| §4 | Willo secrets | §5.1 | — | [ ] |
| §4 | `willo-webhook --no-verify-jwt` | §5.2 | not deployed | [ ] |
| §4 | Webhook URL in Willo | §5.3 | — | [ ] |
| §4 | ADR-0021 assumptions vs first sandbox delivery | §5.4 | — | [ ] |
| §4 | Enable `willo-invite` (session), re-run `install_job_schedules()` | §5.6 | schedule row present, disabled | [ ] |
| §5 | Content from THC: quiz, induction, contract, E2b/CL wording, privacy text, sample letters, retention decision, old-system export | not a setting; see OWNER-TODO §5 and docs/14 §5 | — | [ ] |
| §6 | If the Staff App gets its own domain: `NEXT_PUBLIC_STAFF_URL` on office + client, `STAFF_APP_URL` secret | §3.5 | only `thc-portal-staff.vercel.app` today | [ ] |
| Done | Service role key rotated (22.09) | §3.2, §4.7 note | — | [x] |
| Done | `ANTHROPIC_API_KEY` removed from the client project | — | not present on 23.09 | [x] |
| Done | `SUPABASE_SERVICE_ROLE_KEY` on Office and Staff | §3.1 | present on all three | [x] |
| Done | `NEXT_PUBLIC_STAFF_URL` on Office and Client | §3.1 | present; **add to Staff too** | [x] |
| Done | Live database caught up | §7.1 | 81 applied, newest `20260925100100` | [x] |
| — | `/apply` salt on thc-portal-staff (ADR-0024) | §3.1 | Vercel holds `APPLY_THROTTLE_SALT`, and the code reads that name too — nothing to do | [x] |
| — | `gdpr-purge` has no schedule row (found while writing this page) | §4.6 | a migration for a session | [ ] |
| — | Optional: Mapbox tokens, Gemini key, Firewall rule | §6.2, §6.1, §3.6 | none set | [ ] |
