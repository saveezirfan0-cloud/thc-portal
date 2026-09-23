# 12 · Keys, connections and brand assets

Everything you need to obtain, where to get it, and where it goes. Ordered by when you
actually need it, so you are not chasing keys for features that do not exist yet.

`docs/04-setup-github-vercel-supabase.md` lists the full end-state. This page is the
practical order of work.

---

## Tier 1 · Needed now, to run against a real database

Only **four** values are read by the code today. Everything else below is for later.

| Value | Where to get it | Where it goes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard → your project → Settings → API → Project URL | `.env.local` in each app, and each Vercel project |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same page. Labelled **anon / public**, or **publishable** in the newer dashboard | Same |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page. Labelled **service_role**, or **secret** | Same, but **server-side only**. Never in a `NEXT_PUBLIC_` name |
| `APP_TZ` | Not obtained. It is always `Europe/London` | Same |

Links:

- Create the project: https://supabase.com/dashboard/new
- API keys once it exists: https://supabase.com/dashboard/project/_/settings/api

**Region must be London (`eu-west-2`).** This is UK payroll and right-to-work data.

**The service role key bypasses every security policy.** It belongs in a server
environment variable and nowhere else. If it ever appears in a browser bundle, rotate it
on that same API page.

### Where `.env.local` goes

One per app, next to the existing `.env.example`:

```
apps/office/.env.local
apps/staff/.env.local
apps/client/.env.local
```

They are git-ignored. Copy `.env.example` and fill in the four values above.

---

## Tier 2 · Needed to deploy and to run the robots

### GitHub repository secrets

Settings → Secrets and variables → Actions → New repository secret:
https://github.com/saveezirfan0-cloud/thc-portal/settings/secrets/actions

| Secret | Where to get it | Needed for |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | https://supabase.com/dashboard/account/tokens | **The database deploy — set this and `main` deploys itself** |
| `SUPABASE_PROJECT_ID` | The project reference in your Supabase URL — today `dgxtqvalfiisfpbwodew` | **The database deploy** |
| `SUPABASE_DB_PASSWORD` | Set when you create the project. Save it then; it is not shown again. Resettable under Settings → Database → Database password | **The database deploy** |
| `VERCEL_TOKEN` | https://vercel.com/account/tokens | Later, only if you deploy from CI rather than the Git integration |
| `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID_*` | Vercel project → Settings → General | Later |

Also install the Claude GitHub App on the repository, or `@claude` will not respond:
https://github.com/apps/claude/installations/select_target

### Deploying the database

The `deploy-database` job in `.github/workflows/ci.yml` runs `supabase db push`
after the tests pass on `main`, so a merge that proves itself reaches the live
database on its own. It skips with a notice, rather than failing, while the
three secrets above are unset.

It is a job inside `ci` rather than a workflow of its own, and that is not a
tidiness choice — it is the fix for the second half of this story. Read on.

This did not exist until 22.09.2026, and the gap it left is worth knowing
about: `ci.yml` only ever ran `supabase start`, a throwaway local stack, so the
live project was pushed by hand once and then sat **seventeen migrations behind
`main`** — the jobs layer, the Client Portal, `/apply`, compliance, leaving and
GDPR removal were all merged, all tested, and none of them were on the database
anyone was actually looking at. Every suite was green the whole time.

The first attempt at a fix did not work either, for a reason nothing warns you
about. It was a separate `deploy.yml`, triggered by `workflow_run` on `ci`
finishing. GitHub only registers `workflow_run`, `schedule` and
`workflow_dispatch` triggers from the copy of the file on the repository's
**default branch**, and this repository's default branch is not `main` (docs/14
O13). So the file sat on `main` looking exactly like a working deploy, was never
registered as a workflow at all, and `ci` went green on `main` five times while
the gap grew from seventeen migrations to twenty-six. `push` carries no such
rule — it runs the file from the commit that was pushed — which is why the
deploy now lives beside the tests that gate it.

**It deploys migrations, and nothing else.** Two deploy steps stay manual, and in this
order — `supabase functions deploy`, then `select install_job_schedules()`. docs/13 P1 is
explicit about why the order matters: the other way round, pg_cron spends the gap posting
at a 404. No migration calls `install_job_schedules()` itself, so there is no automatic
hazard here; the risk is only that this page leaves you believing a green `ci` means the
whole system is deployed. It means the schema is.

**If the deploy fails,** re-run the `deploy-database` job from its run page in Actions —
the tests do not need repeating. There is no `workflow_dispatch` button for it, and adding
one would not help until the default branch is fixed (docs/14 O13), which is a second
reason that setting matters.

If the live project ever drifts from the migration history again, the repair is
`supabase migration repair --status applied <version>` rather than re-running the
file: the history is keyed on the digits before the first underscore in the
filename, and `db push` applies whatever is missing from it.

### Vercel

Create three projects from this one repository:
https://vercel.com/new

| Project | Root directory | Suggested domain |
|---|---|---|
| `thc-office` | `apps/office` | `office.` |
| `thc-staff` | `apps/staff` | `app.` |
| `thc-client` | `apps/client` | `clients.` |

For each project, set the four Tier 1 values under Settings → Environment Variables, for
both Production and Preview. Framework is Next.js. The build command can stay default;
Turborepo handles the shared packages.

The staff app **must** be served over HTTPS on a real domain, because a progressive web
app cannot be installed or receive push notifications otherwise. Vercel does this for you.

Connect the Supabase integration so preview deployments get their own branch database:
Vercel → Integrations → Supabase.

---

## Tier 3 · Needed per phase, not yet

Do not chase these now. Each is listed against the phase that first needs it.

| Key | Where | First needed |
|---|---|---|
| `WILLO_API_KEY`, `WILLO_INTERVIEW_KEY`, `WILLO_WEBHOOK_SECRET` | THC's Willo account (Appendix B, B1). Supabase secrets for the `willo-webhook` Edge Function, never Vercel. Without the first two no candidate is created in Willo (logged); without the secret every webhook is refused | Phase 1, interviews |
| `STAFF_APP_URL` | The Staff App's public origin, e.g. `https://app.thehospitalitycompany.co.uk`. Supabase secret: the Willo Accept builds E3's `/activate/{token}` link from it (the Back Office reads `NEXT_PUBLIC_STAFF_URL` for the same thing) | With the Willo keys |
| Optional Willo overrides: `WILLO_SIGNATURE_HEADER`, `WILLO_TIMESTAMP_HEADER`, `WILLO_TIMESTAMP_TOLERANCE_SECONDS`, `WILLO_API_BASE`, `WILLO_INVITE_PATH`, `WILLO_API_AUTH_HEADER`, `WILLO_API_AUTH_PREFIX` | Set only if Willo's docs differ from the defaults in ADR-0021 | With the Willo keys |
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey | Phase 1, reading dates off documents |
| `RESEND_API_KEY` | https://resend.com/api-keys — a **Sending access** key for the verified domain | P2, every email (`notify-drain`) — see below |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Generated, not obtained. Run `npx web-push generate-vapid-keys`; the subject is `mailto:admin@thehospitalitycompany.co.uk` | P2, every push (`notify-drain`) — see below |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | https://account.mapbox.com/access-tokens/ | Phase 2, the venues map |

Anything used by a background function goes in Supabase rather than Vercel:

```
supabase secrets set GEMINI_API_KEY=… WILLO_API_KEY=… RESEND_API_KEY=… VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=…
```

The Willo function is deployed without Supabase's JWT check, because Willo signs its own
deliveries (ADR-0021). Point Willo's webhook at `{SUPABASE_URL}/functions/v1/willo-webhook`:

```
supabase secrets set WILLO_API_KEY=… WILLO_INTERVIEW_KEY=… WILLO_WEBHOOK_SECRET=… STAFF_APP_URL=https://…
supabase functions deploy willo-webhook --no-verify-jwt
```

Email needs two verified senders on THC's domain, `admin@` and `timesheets@`, which means
adding DNS records. That is a dependency on THC and has lead time, so start it early even
though the code needs it later.

### The notification senders (P2, `notify-drain`)

Every push and every email leaves through one Edge Function, `notify-drain`, which pg_cron
calls every minute. It reads five secrets, all from **Supabase**, none from Vercel:

```
supabase secrets set \
  RESEND_API_KEY=re_… \
  VAPID_PUBLIC_KEY=B… \
  VAPID_PRIVATE_KEY=… \
  VAPID_SUBJECT=mailto:admin@thehospitalitycompany.co.uk
```

(`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase itself.)

| Secret | What it is | If it is missing |
|---|---|---|
| `RESEND_API_KEY` | Resend API key with sending access to THC's domain | Every email row is **held**: the row's `error` says "not configured", no attempt is spent, and it is looked at again every 5 minutes. Push still sends. |
| `VAPID_PUBLIC_KEY` | base64url, 65 bytes, from `npx web-push generate-vapid-keys` | Every push row is held the same way. Email still sends. |
| `VAPID_PRIVATE_KEY` | base64url, 32 bytes, same command. **Secret.** | Same |
| `VAPID_SUBJECT` | `mailto:` or `https:` contact the push services can reach | Same |

The **same public key** must also be set on the staff app in Vercel as
`NEXT_PUBLIC_VAPID_PUBLIC_KEY` — the browser subscribes with it, and a push signed by a
different pair is refused by the push service. Generate the pair **once**: rotating it
silently orphans every device already subscribed (they re-subscribe the next time the app
opens).

**The sender addresses are not secrets and not env vars.** They are the `senders` row in
`settings`, edited on the Back Office `/settings` page, and read by the drain on every
run. If that row is missing, malformed or a no-reply address, the drain falls back to
`admin@thehospitalitycompany.co.uk` / `timesheets@thehospitalitycompany.co.uk` and logs
why.

**DNS, before the first email.** In Resend → Domains, add `thehospitalitycompany.co.uk`
(or a sending subdomain) and publish the records it shows at THC's DNS host: the DKIM
`TXT` record(s), the SPF `TXT`/`MX` on the bounce subdomain, and a DMARC `TXT` at
`_dmarc` (start at `p=none`). Resend will not send from `admin@` or `timesheets@` until
the domain shows **Verified**; until then it refuses the send (a 4xx), and the drain
either retries on its backoff and fails the row after six attempts (401/403) or fails it
at once (400/422) — so verify the domain before setting the
key, not after. Both mailboxes must be real and monitored: §9.12 rules out no-reply, and
every email sets `Reply-To` to its sender.

**Deploy order** (as for every job):

```
supabase functions deploy notify-drain
supabase functions deploy finance-reports
psql … -c "select install_job_schedules();"
```

Functions first. `install_job_schedules()` reads `settings.edge_base_url` and the vault
secret `service_role_key`; it (re)schedules every enabled `job_schedules` row, which now
includes `notify-drain` (every minute) and `finance-reports` (re-enabled with the drain).
Run from the repository root, because the function imports `packages/notifications` by
relative path (ADR-0020).

**Checking it works:** `select job, ok, counts, error from job_runs where job =
'notify-drain' order by started_at desc limit 5;` — `counts` has `sent`, `retried`,
`failed`, `unconfigured` and, while keys are missing, `notConfigured`. A single row's
story is on `notification_outbox` (`attempts`, `error`, `sent_at`, `failed_at`).

---

## Brand assets

Put the source files in the `brand/` folder at the repository root and tell me. I will
generate every size and wire them in. Do not hand-place the icons: several have exact
names the code already expects.

**What to supply:**

- The logo as **SVG** if you have it. Vector scales to every size without going fuzzy.
- Failing that, a **PNG at 1024 by 1024** or larger, on a transparent background.
- A square version that reads well when small, if the main logo is wide. App icons are
  square and end up around 20 pixels in a browser tab.
- Any brand colour references you want honoured.

**Where they end up:**

| File | App | Why |
|---|---|---|
| `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | `apps/staff/public/` | **Done.** All three exist at the right sizes, are the real mark on cyan, and the manifest is valid — the staff app is installable. (This line used to say they were missing; they were not.) |
| `favicon.ico` and `apple-icon.png` | All three apps' `public/` | Browser tab and iOS home screen |
| Brand mark | `packages/ui` | **Done.** `packages/ui/src/components/Logo.tsx` inlines `brand/thc-mark.svg` and is wired into all three sign-in cards, the Back Office sidebar, the Client Portal top bar and `/apply/submitted`. A test asserts the inlined paths still equal the source file, so a new logo must be regenerated rather than hand-edited. |

The maskable icon needs roughly 20% clear padding around the mark, because Android crops
it to whatever shape the phone uses. I will handle that when generating.

---

## Design

Drop the updated wireframes in and say so. The stylesheets in `packages/ui` are derived
from `wireframes/assets/thc.css` on comment boundaries, so a design change is regenerated
rather than hand-patched. That is session S0 in `docs/11-session-prompts.md`.

---

## What else, beyond keys

- **Protect `main`.** Require a pull request and require the `ci` check to pass:
  https://github.com/saveezirfan0-cloud/thc-portal/settings/branches
- **Add the routing labels** so `@claude` knows which bot to use: `domain:onboarding`,
  `domain:scheduling`, `domain:compliance`, `domain:checkin`, `domain:reports`,
  `domain:client-portal`, `domain:staff-pwa`, `domain:platform`, `domain:design-system`.
- **Decide where production lives.** Your setup doc notes the hosting transfers to THC at
  hand-over, so production should sit in an organisation THC owns. Staging can stay in
  yours.
- **Chase THC for the Appendix B inputs.** The contract text, sample completion letters,
  the logo, the Willo keys, DNS, and the export from the old system. Several phases stop
  dead without them.
- **Two open product decisions** are recorded in `docs/11-session-prompts.md`: the Client
  Portal line-up, and the three judgement calls in the row-level-security migration.
