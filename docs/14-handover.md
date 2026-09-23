# 14 · Where the build actually is, and what to do next

Figures re-verified on the 26.09 round (the branch that follows `dbd0227`). This is the honest state, not
the plan — every number below was produced by running something, not by counting
what a previous revision claimed. Where something looks finished but is not, it
says so.

`docs/13-remaining-work.md` still holds the original prompt for every item. Every
screen it names is now built; what is left is listed in §2 and §4 below.

> **Read `git log --oneline -40` before you take anything off this list.** This
> page goes stale within the day.

---

## 1 · What is genuinely built

**Every screen in the product now exists.** Three Next.js apps on one Supabase
database, **86 migrations**, **75 pgTAP files (2,590 assertions)**, **1,643 Vitest
tests across 98 files** in eight packages, seven Edge Functions (`auto-staffing`,
`booking-tick`, `compliance-daily`, `finance-reports`, `gdpr-purge`,
`notify-drain`, `willo-webhook`, plus `_shared`), and ADRs up to `0024`. CI runs
lint, typecheck, Vitest, `supabase test db` and Playwright on every push, and
`deploy-database` pushes migrations to the live project on merge to `main`.

**Verified on this revision, not inherited from the last one:**

| Check | Result |
|---|---|
| All 86 migrations applied in order to an **empty** database | clean |
| `scripts/pgtest-local.sh` — all 75 pgTAP files | 2,590 assertions, **2 failures**, both expected (below) |
| `turbo lint typecheck test` | 29/29 tasks |
| Live Supabase project vs the repo | all 81 applied at `dbd0227`; the 26.09 round's 5 deploy on merge |

`002` assertions **6 and 7** fail in every local harness and **that pair is the
clean baseline**: they record that on Supabase `anon` *can* write
`spatial_ref_sys`, which is false locally because `postgres` owns PostGIS there.
Two failures are expected; three is a regression.

Use `scripts/pgtest-local.sh` and not a hand-rolled cluster. A stub `auth.users`
missing `encrypted_password` stops the suite at migration 73, and a `002` that
aborts mid-file reports 2,472 assertions and one failure — a plausible-looking
number that is simply wrong. The script gets both right.

**Screens:**

| App | Routes |
|---|---|
| Back Office | `/dashboard` (`/` redirects) · `/onboarding` · `/onboarding/:id` · `/events` · `/events/:id` · `/events/new` · `/events/:id/edit` · `/compliance` · `/compliance/export` · `/checkin` · `/staff` (`?view=student`) · `/staff/:id` · `/clients` · `/clients/:id` · `/roles` · `/reports` · `/reports/export` · `/feedback` · `/venues` · `/settings` · `/api/documents/:eventId` · `/login` · `/design-system` |
| Staff App | `/` · `/apply` · `/apply/submitted` · `/activate/:token` · `/activate/done` · `/onboarding` (11 steps) · `/shifts` · `/shifts/:id` · `/invites` · `/invites/:id` · `/radar` · `/radar/:id` · `/documents` · `/documents/upload/:docType` · `/documents/completion-letter` · `/documents/opt-out` · `/documents/declare` · `/notifications` · `/install` · `/offline` · `/privacy` · `/profile` · `/profile/details` · `/profile/security` · `/profile/payments` · `/login` · `/forgot` · `/forgot/sent` · `/reset` |
| Client Portal | `/` · `/client` · `/client/events/:id` (+ the latest allocation sheet / timesheet PDF) · `/login` |

The Back Office sidebar has no `pending` items left, and `/settings` is linked
last, below a divider. The Staff App's Documents tab is live.

**What landed in the 23.09 build** (one branch, merged as one PR):

- **B1 Dashboard** and **S1 PWA shell** (from #43, already on `main`).
- **B5 Onboarding kanban and candidate profile** — six columns plus Active /
  Rejected, the profile changes by phase, every transition is an edge of
  `staff_transitions` enforced by a row trigger (`staff_status_guard`), with
  evidence gates on documents→quiz, quiz→contract and contract→compliant.
  "Additional info" is a column, not a status (ADR-0013).
- **B6 Compliance queue and radar** and **B6b completion letter / 48-hour
  opt-out** — review queue, Radar with counters, the seven acceptance criteria of
  the completion-letter requirement each a named test (AC1–AC7), audit export,
  retention employment + 2 years (ADR-0019), the rota guard enforced in the
  database (student caps and right-to-work expiry always block; the Working Time
  48 blocks or warns per `/settings`), CL1–CL6 in the register, and the
  Student-visa view on `/staff?view=student`.
- **B11 / B12 Reports and documents** — Financial, Payroll and New Starter tabs,
  CSV one row per shift with holiday broken out, held No check-outs never
  exported, `payroll_export_lines` recording exactly what went, the BG-08 Monday
  09:00 job (`finance-reports`), and the allocation sheet / sign-out timesheet
  PDFs with Send and Download on the event page (ADR-0015).
- **B13 Feedback** — Client and Office tabs; the worker's rating is now derived
  from feedback (it was never computed before) and Mark as read moves it
  (ADR-0016).
- **S2 Onboarding wizard** — all eleven steps, the Appendix A journey walked end
  to end in pgTAP (`393`). Seams and deviations in ADR-0014.
- **S4 Documents hub** — every document state, re-upload, the completion-letter
  slot, opt-out sign/cancel, and the §10.7 conviction declaration
  (`declare_my_conviction()`, closing O10 point 5).
- **Candidate activation** — Accept creates the login and E3 carries a personal
  one-time `/activate/:token` link; the token is only spent on submit, never on
  page load (mail scanners prefetch links).

---

## 2 · What is left, in order

**Everything that can be built without THC or live credentials is built** (24.09
wave below). What is left needs an input only the owner or THC can supply, or a
real environment to prove it in.

1. **Turn sending on** — the drain is built (`notify-drain`, ADR-0020) but sends
   nothing until the owner steps in §5 are done: Resend key and verified domain,
   the VAPID pair, the Edge Function deploys, then `install_job_schedules()`.
   Until then every row waits as "not configured" without spending retries.
2. **Willo keys** — the receiver and the create-candidate sweep are built
   (ADR-0021) on an *assumed* signing scheme and API shape, all configurable.
   Check ADR-0021's list against Willo's first sandbox delivery, then enable the
   `willo-invite` schedule and add it to `190`'s list in the same commit.
3. **THC content, flagged as placeholders in the code:** the 10 quiz questions,
   the induction slides, the contract text (`contract_versions`), E2b and
   CL1–CL6 wording, the `/privacy` legal text, and sample completion letters for
   the Gemini extractor.
4. **Browser passes against the live project.** No new screen has been clicked
   through for real; coverage is render tests, view-model tests and pgTAP. A
   `qa-reviewer` pass per wireframe and Playwright journeys for the wizard,
   activation and the drain are the next safety net.
5. **Nothing else is open in code** beyond §4's notes. The 25.09 round closed
   the last three gaps (below).

---

## 3 · Closed on 26.09, the most recent round (the §4 clean-up)

- **Database types** are generated from the live project
  (`packages/db/src/types.generated.ts`); `gen:types` formats them.
- **A verified right-to-work date cannot be blanked** by any API role
  (`20260926120000`, pgTAP `540`); fixtures use an owner-only
  `thc.allow_rtw_date_clear` escape.
- **A worker's home location follows their address** (`20260926110000`,
  `530`): postcodes.io on edit, a `home_location_stale` flag the office sees
  when the lookup fails. No office pin editor — a flag clears on the next
  successful lookup.
- **Willo's create-candidate is idempotent** across a lost link, and asks Willo
  by `external_id` before creating again (`20260926100000`, `520`, ADR-0024).
  Residual: with the record lost AND no lookup endpoint, a duplicate is possible.
- **New Starter fields**: gender asked at wizard step 7 (§9.9 Tab 3, "M/F" — a
  wireframe deviation, ADR-0024); postcode and country derived from the address.
- **`/apply`**: the shared, keyboard-operable `Checkbox`; and a per-caller
  limit (hashed caller, 5/hour, 20/day, in `settings`). Residual: anon can
  still call `submit_application` directly through PostgREST, which bypasses
  the per-caller limit (not the per-email/mobile ones) — closing it means
  revoking anon and making the service key mandatory for `/apply`.
- **`rls_auto_enable()` is Supabase's own** "enable RLS automatically on new
  tables" option: the `ensure_rls` event trigger enables RLS on any new table in
  `public`. It only adds protection; left in place, not mirrored in a migration
  (locally every migration enables RLS itself, and 001 asserts it).
- `docs/08-screen-inventory.md` lists the routes that exist.
- Workers verified on a share code with no date: the live project has 5, all
  seed demo accounts (`@example.com`, EU settled). None real; recheck after any
  data import (query in `20260923200000`'s header).

## 3a · Closed on 25.09

- **The office can take a Radar application forward** (`accept_application`,
  ADR-0023): same gates as `accept_invite`, N10 to the worker, and the press that
  fills the role closes every other pending application with N10c. Applications
  now appear on the event board. The scope has no "Decline application", so
  none was built. `accept_invite` also closes the rest with N10c when it fills a
  role, because §8 has one trigger for both.
- **Cancel event is one transaction** (`cancel_event`): event, auto-assign,
  bookings and N12 all together, or none; the action surfaces the error.
- **`accept_invite` answers `rtw_expired`** for a lapsed right to work.
- **Push to a worker with no device fails at once** rather than after ~31
  minutes of retries; document emails sign with the `/settings` sender.
- `OWNER-TODO.md` is the owner's live checklist.

## 3b · Closed in the 24.09 wave

- **P2 · the outbox drain.** Web Push (VAPID, WebCrypto, byte-for-byte against
  RFC 8291) and email via Resend with the outbox key as the idempotency key;
  leased claims (`skip locked`), shared backoff, permanent failures failed at once,
  missing keys held without spending attempts; senders read from `/settings` at
  run time; `finance-reports` re-enabled. `deno check` and `deno bundle` pass
  locally — the Supabase deploy bundler resolving `../../../packages` is still
  unproven (ADR-0020's fallback is option 4).
- **Willo receiver and resend activation** (ADR-0021). Provisioning is one shared
  module (`packages/db/src/provision.ts`) for the office Accept and the webhook;
  retried deliveries mint no new token. `activated` now means "has a password",
  not "a login is linked" — every accepted candidate had read Activated.
- **B2 · the booking state machine** in the database: seven states, ten edges,
  `bookings_state_guard`, TS and SQL held to one vectors file (ADR-0022).
- **B3 · one `cancel_cause` vocabulary** with a check constraint. The office
  Withdraw had been writing a cause the Staff App never matched, so "You've been
  removed from this shift" never showed.
- **The shift screen showed the first button press, not the check-in** — also
  fixed by #48 in parallel (`acceptedLog()` in `packages/domain/pay.ts`, which
  also covers the office's violation window); #48's version stands.
- **Declining an invitation qualified the worker at that client** and counted as
  a shift worked; `closed` is no longer read as completed (`20260924150000`).
- **`rejection_reason` is internal** — done by #48 (`20260923220000`) in
  parallel; this wave's duplicate was dropped before merge.
- **Rota guard gaps closed**: re-timing a shift re-checks confirmed workers at
  commit; one statement confirming several bookings sees its own rows; declined
  invites no longer count toward the cap; an expired right to work is its own
  refusal (`rtw_expired`), with board and Radar copy.
- **N14 names the Sunday for the 10-hour band**; a settled share code reads
  "Settled — no time limit".
- **D3** `/privacy` exists, public, linked from `/apply` and both login footers.
  (**D1** was fixed by #48 in parallel, more widely; its version stands.)
- Three restatements of `onboarding_candidates_v` from different bases (#48,
  Willo) would have reverted each other's changes; `20260924160000` carries
  both (`504`).

## 3c · Closed in the 23.09 build

- **E2's interview wording went to every rejection.** Candidates rejected after
  the interview, and returning applicants, now get **E2b** — the same close
  without the interview (`20260923170000`). E2b is the register's first
  `EXTENSION_CODES` entry; `SCOPE_CODES` still equals §8 exactly.
- **A rejected "Yes" declaration unlocked the quiz** once the last document was
  verified (`20260923191000`, pgTAP `441`).
- **`resolve_violation()` warned "payment will not be added"** for a held No
  check-out that is in fact paid the next Monday; it now asks per booking
  (`20260923190000`).
- **A completion letter could be verified with no completion date**, releasing
  48 h at once. `completion_letter_approval_guard` refuses it; the candidate
  profile sends letters to the Compliance queue's approval form.
- **Two share-code rules** (the wizard's `^W…`, the hub's any-nine) are one
  (`20260923192000`). **Two `DocType`s** are one (`documents.ts`).
- **Opted-out workers read "cannot be booked"** on `/staff` — the directory
  expected a band the database never returns (`uncapped`).
- **Customers could fake a rating change** through the 0001 client insert
  policy on `feedback`; the policy now requires unread rows under the caller.
- **qa-reviewer's two blockers.** (1) A worker could delete their own verified
  right-to-work evidence from Storage by naming its path to a refusing upload
  action; every discard now asks `evidence_path_discardable()` (`20260923193000`,
  `442`). (2) Two verify paths disagreed and neither put a right-to-work date
  on a non-UK worker, so `can_roster_staff()` never stopped them. One verify
  body now serves both screens, the date is required per branch and the
  worker's `right_to_work_until` follows the earliest verified evidence
  (`20260923200000`, `460`, ADR-0018).
- **Also from that review:** the wizard's opt-out tick now signs/cancels with
  notice, audit and CL5/CL6 like the hub; only the worker (or the service role)
  may sign or cancel their own opt-out; the old five-argument
  `onboarding_accept` is revoked from `authenticated`; `size_bytes` is the one
  size column and the wizard reads it off the real Storage object; the Monday
  finance send is paused until P2; the client sees a sign-out timesheet only
  once it is final (`443`); E2b has ADR-0017.
- **Merged with #44's column grants.** #44 re-granted `staff` column by
  column; the twenty columns this build adds are granted by name in
  `20260923210000`, and the two build views that read `block_reason` directly
  (`compliance_review_queue_v`, `onboarding_returning_v`) now read it through
  `staff_block_reason_v`. `445` asserts both. A column added to `staff` from
  here on needs its own grant, as #44 intends.
- **The live database had stopped deploying at #43.** #43 merged
  `20260922181000` / `182000` after `20260922183015` was already live, so
  every `deploy-database` since refused them as "below the last remote
  migration" and applied nothing — #44 and #45 included. Both were
  self-contained (own grants, pinned search paths), were rehearsed locally in
  the live order, and were applied by hand on 23.09 and recorded in
  `supabase_migrations.schema_migrations`; the next push to `main` deploys the
  rest normally. The job does what its comment says: read the log, never add
  `--include-all` blind.
- `supabase/config.toml` `otp_expiry` is 86400 (activation links last a day).
- `scripts/pgtest-local.sh` — the Docker-free pgTAP harness §7 describes, as a
  script.

---

## 4 · Known defects and gaps, unassigned

### The security advisor, read against the live project on this revision

Run it yourself with the Supabase advisor rather than trusting this table; it is
here so a reader can tell a deliberate finding from a new one.

| Finding | Count | Verdict |
|---|---|---|
| Functions with a mutable `search_path` | **0** | closed 22.09 and held since, guarded by an invariant over `pg_proc` in `002` |
| `SECURITY DEFINER` callable by `anon` | **6** | all deliberate: 3 are PostGIS's own `st_estimatedextent` overloads, plus `current_app_role`, `current_client_id` and `submit_application` — reasons in the migration headers |
| `SECURITY DEFINER` callable by `authenticated` | **86** | the product's RPC surface; every one is guarded internally. It grew with the build and is not in itself a defect, but it is the number to watch |
| `SECURITY DEFINER` views | **8** | the ADR-0004 owner-rights pattern — it is the mechanism that keeps money and worker data away from the client role, not a lapse |
| `spatial_ref_sys` without RLS | 1 | ADR-0010, known gap, needs `supabase_admin` |
| **Leaked-password protection** | off | **still owed — see §5.** The only advisor finding that is nobody's design decision |

New from the 24.09 wave:

- Three hand-rolled copies of the tick-box control remain (the HMRC
  declaration, the contract signature, the office role picker); each is a
  place the next D1 can hide. `/apply` now uses the shared `Checkbox`, which
  draws the coral border and announces the error off `aria-invalid` (#54).

From the 23.09 build:

- **Workers verified on a share code before 23.09 with no date still have
  none** — nothing to backfill from. Re-verify them; the query that finds them
  is in the header of `20260923200000`.
- **The share-code date is confirmed by the office** until the extractor that
  reads the gov.uk report exists; §2.3 says nobody types it (ADR-0018).
- **Unverified on real infrastructure:** the `finance-reports` Edge Function has
  not been run under Deno (ADR-0006's `../../../packages` import question); Storage
  image transforms may be off (photos then fall back to the original); GoTrue's
  `email_exists` on an invite for a confirmed address and `hashed_token` equal to
  the stored token are assumed, not observed.
- ~~**A worker can read the office's reason for rejecting them**~~ **Closed
  23.09** by `20260923220000`, with #44's shape: the column is revoked from both
  PostgREST roles and the office reads it through the owner-rights
  `staff_rejection_reason_v`. `onboarding_candidates_v` keeps its
  `security_invoker` reloption and its column list, order and types — verified
  identical — so no office column list moved. `480_rejection_reason.sql` also
  pins the distinction that makes this easy to get wrong: **`compliance_docs`.`rejection_reason`
  has the opposite rule** and must stay readable, because §2.6 and N8 require a
  rejected DOCUMENT to tell the worker why so they can re-upload.

Carried over:



---

## 5 · What is yours, not a session's

**The live checklist is [`OWNER-TODO.md`](../OWNER-TODO.md)** at the repository
root. Tick it there. This section keeps the background for each item.

- ~~**Rotate the Supabase service role key.**~~ **Done 22.09.** It had been pasted
  into a chat transcript, and it bypasses every security policy in the database.
  Nothing in the repository ever held it — only `.env.example` files are tracked,
  `.gitignore` covers `.env` and `.env.*`, and no key-shaped string appears
  anywhere in the history — so the transcript was the whole of the exposure and
  rotating closes it.
- ~~**Delete `ANTHROPIC_API_KEY` from the Vercel client project.**~~ **Done 22.09**,
  and nothing wants that key now: the workflow that read it was deleted on 23.09
  (O8), so no repository secret is owed for it either. Rotate it anyway if it was
  ever in a transcript.
- **Enable branch protection on `main`** — require a pull request and a green
  `build-test` (the job name, not the workflow; `ci` is the workflow and a branch
  rule wants the job):
  https://github.com/saveezirfan0-cloud/thc-portal/settings/rules/new?target=branch
- **Turn on leaked-password protection** in Supabase Auth. The advisor still
  reports it off.
- ~~**Vercel env**~~ **Done 24.09:** `SUPABASE_SERVICE_ROLE_KEY` was already on
  Office and Staff; `NEXT_PUBLIC_STAFF_URL=https://thc-portal-staff.vercel.app`
  added to Office and Client. Change both if the Staff App gets a custom domain.
- **Supabase Auth → Email OTP Expiration → 86400.** Activation and reset links
  otherwise die after an hour. (Not reachable from a session's tools.)
- **Turn on sending** (ADR-0020, docs/12):
  1. Verify the sending domain in Resend (DKIM/SPF/DMARC at THC's DNS host).
  2. `npx web-push generate-vapid-keys`, then
     `supabase secrets set RESEND_API_KEY=… VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:admin@thehospitalitycompany.co.uk`,
     and `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (the same public key) on the Staff
     Vercel project.
  3. `supabase functions deploy notify-drain` and
     `supabase functions deploy finance-reports` from the repository root.
  4. Only then `select install_job_schedules();` (needs `settings.edge_base_url`
     and the vault secret `service_role_key`), and watch `job_runs`.
- **Willo, once THC's keys exist** (ADR-0021):
  `supabase secrets set WILLO_WEBHOOK_SECRET=… WILLO_API_KEY=… WILLO_INTERVIEW_KEY=… STAFF_APP_URL=https://thc-portal-staff.vercel.app`,
  `supabase functions deploy willo-webhook --no-verify-jwt`, point Willo's
  webhook at `{SUPABASE_URL}/functions/v1/willo-webhook`, then enable
  `willo-invite` (with `190`) and re-run `install_job_schedules()`.
- **Confirm with THC:** E2b's wording (ADR-0017); the CL1–CL6 wording and which
  are mandatory; whether ADR-0019's retention-over-removal extends to other
  right-to-work documents; the `/privacy` legal text.
- **Chase THC for the Appendix B inputs**: the contract text, sample completion
  letters, the Willo keys, DNS for the two senders, and the export from the old
  system. Several phases stop dead without them.

---

## 6 · Deployments, and how not to run out

Preview deployments are **disabled** on all three Vercel projects.

The reason, measured: of 67 deployments in one day, **52 were previews** from ten
feature branches — 78% of a 100/day free-tier allowance spent on builds nobody
opened. Pull requests are not what triggers a deployment; **a push to any branch
is**, once per project. Ten agents on ten branches is thirty deployments before
anyone reads a line of the diff.

With previews off, only `main` deploys: three per merge, fewer when Vercel's
"skip unaffected projects" decides an app's dependencies did not change. If you
want a branch previewed, deploy that branch deliberately rather than turning
previews back on for everything.

---

## 7 · Before you trust a local test run

- `supabase start` needs Docker, which some sandboxes block. Where it is
  unavailable, run **`scripts/pgtest-local.sh`** (its header lists the apt
  packages). It is the throwaway cluster described next, as a script, and runs
  the whole suite in under ten seconds. **Build a throwaway cluster rather than
  shipping unrun SQL**: a
  plain PostgreSQL 16 `initdb`, the Supabase-shaped roles and schemas, then every
  migration in order against an empty database and `pg_prove` over
  `supabase/tests`. It takes a few minutes and it is how the three defects in the
  staff self-service migration were found — including one that raised at run time
  and not at create time, so it would have deployed green and broken every
  contact save.
- **`002` assertions 6 and 7 fail in any local harness and that is expected.**
  They record the ADR-0010 known gap — on Supabase `anon` can write
  `spatial_ref_sys` — which is false locally because `postgres` owns PostGIS
  there. **Two** failures are the clean baseline; three is a regression.
- **`scripts/pgtest-local.sh` needs `postgresql-16-cron`**, which its header
  lists but a fresh sandbox does not have. Without it the cluster dies at
  startup with `could not access file "pg_cron"` and the script only reports
  `pg_ctl: could not start server`, which reads like a broken script rather
  than a missing package. `apt-get install -y postgresql-16-cron` fixes it.
- The browser suite needs a Supabase project to reach, and since the auth gate
  closed it needs one to *start*: an app built without `NEXT_PUBLIC_SUPABASE_URL`
  answers 503 on every route, so Playwright's `webServer` wait times out after
  120s and nothing runs at all. Point `.env.local` at a project, or run
  `supabase start` and export its URL and anon key the way `ci.yml` does. Where
  egress is blocked the signed-in specs fail with a `waitForURL` timeout instead.
  Both are the environment, not the code.
- **Six Client Portal browser tests are unreachable**, not merely skipped: they
  assert an ungated portal, which no longer exists in either environment.
  Reviving them needs a signed-in client fixture — that work belongs to **C1**.
- `pnpm format` once rewrote the checked-in `design-handoff/` vendor bundles
  (196k lines). That folder is in `.prettierignore` now; do not take it out.

---

## 8 · Conventions that have already been broken once

Each of these cost a merge conflict or a red build:

- **Migrations are timestamped**, `YYYYMMDDHHMMSS_`. Sequential numbering
  collapsed when four sessions all reached for `0006`. Two sessions still managed
  to pick the same second; CI has a uniqueness guard now.
- **ADRs collide too** — four sessions reached for `0008`. Check `docs/adr/` for
  the highest number immediately before you write one. It is at `0018`.
- **pgTAP files collide as well**; three landed on `130`. Number from the highest
  file in `supabase/tests/`, not from the highest you remember.
- **Doc numbers collide.** There are two `14-`s right now: this page and
  `14-open-questions.md`. Renumber one when neither is being edited.
- **A session merging to `main` late collides with sessions that merged
  early**, even on timestamps: #44 and this build both reached for
  `20260923090000` and both fixed `age_18`; pgTAP `360` and ADR `0012` were
  taken twice. Fetch `main` and run `node scripts/check-file-numbering.mjs`
  before opening the PR, not after.
- **Parallel builders duplicate helpers even when their files are disjoint.**
  On 23.09 six builders ran at once; merging found two `DocType`s, two share-code
  rules and two sets of verify functions. Before adding a type or a validator to
  `packages/domain`, grep for it.
- **One feature, one session.** Two sessions built `/apply` independently and one
  implementation was thrown away. `docs/10-working-with-agents.md` has the
  ownership map; read it before you start.
