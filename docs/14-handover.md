# 14 · Where the build actually is, and what to do next

Rewritten 23.09.2026 against branch `claude/fervent-cerf-tlxnm1` as it merges to
`main`. This is the honest state, not the plan — every line was checked against
the repository. Where something looks finished but is not, it says so.

`docs/13-remaining-work.md` still holds the original prompt for every item. Every
screen it names is now built; what is left is listed in §2 and §4 below.

> **Read `git log --oneline -40` before you take anything off this list.** This
> page goes stale within the day.

---

## 1 · What is genuinely built

**Every screen in the product now exists.** Three Next.js apps on one Supabase
database, **70 migrations**, **58 pgTAP files (2,226 assertions)**, **1,358 Vitest
tests** across eight packages, six Edge Functions (`auto-staffing`,
`booking-tick`, `compliance-daily`, `finance-reports`, `gdpr-purge`, plus
`_shared`), and ADRs up to `0018`. CI runs lint, typecheck, Vitest,
`supabase test db` and Playwright on every push, and `deploy-database` pushes
migrations to the live project on merge to `main`.

**Screens:**

| App | Routes |
|---|---|
| Back Office | `/dashboard` (`/` redirects) · `/onboarding` · `/onboarding/:id` · `/events` · `/events/:id` · `/events/new` · `/events/:id/edit` · `/compliance` · `/compliance/export` · `/checkin` · `/staff` (`?view=student`) · `/staff/:id` · `/clients` · `/clients/:id` · `/roles` · `/reports` · `/reports/export` · `/feedback` · `/venues` · `/settings` · `/api/documents/:eventId` · `/login` · `/design-system` |
| Staff App | `/` · `/apply` · `/apply/submitted` · `/activate/:token` · `/activate/done` · `/onboarding` (11 steps) · `/shifts` · `/shifts/:id` · `/invites` · `/invites/:id` · `/radar` · `/radar/:id` · `/documents` · `/documents/upload/:docType` · `/documents/completion-letter` · `/documents/opt-out` · `/documents/declare` · `/notifications` · `/install` · `/offline` · `/profile` · `/profile/details` · `/profile/security` · `/profile/payments` · `/login` · `/forgot` · `/reset` |
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

1. **P2 · the outbox drain and the push/email senders.** The single biggest gap.
   Every notification in the product — E2/E2b/E3 to candidates, N8, CL1–CL6, the
   Monday finance email (BG08), the timesheet sends (D1/D2) — stops at a
   `notification_outbox` row. Nothing is actually sent until the drain exists and
   `RESEND_API_KEY`, the VAPID keys and the two verified senders are set. The
   drain must send `BG08`/`D1`/`D2` rows through `documentMessageFor()` (they are
   deliberately outside the §8 register). It should also read the `senders`
   setting `/settings` writes; `templates.ts` still hard-codes the two addresses.
   **The `finance-reports` schedule is disabled until then** (20260923193100);
   re-enable it in the same commit as the drain, and update `190`'s list.
2. **Willo.** No webhook receiver and no "create candidate" call — both need
   THC's keys. `willo_link_candidate` / `willo_record_event` are built and tested;
   the receiver must also provision the login exactly as the office Accept does
   (`link_staff_account` as the service role) and pass the personal link.
3. **THC content, all flagged as placeholders in the code:** the 10 quiz
   questions, the induction slides, the contract text (`contract_versions`), the
   CL1–CL6 wording, and sample completion letters for the Gemini extractor (the
   `DocumentExtractor` seam returns nothing until then, so every upload goes to
   manual review).
4. **Resend activation link.** An expired E3 link means the candidate writes to
   admin@; nothing in the office can issue a new one. Needs an office action and a
   DB function with a new E3 outbox key.
5. **B2 / B3** from §4 — the booking state machine and `cancel_cause`.
6. **Browser passes.** No new screen has been clicked through against a live
   Supabase project; coverage is render tests, view-model tests and pgTAP. A
   `qa-reviewer` pass against each wireframe, and Playwright journeys for the
   wizard and activation, are the next safety net.

---

## 3 · Closed in this build (23.09)

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
- `supabase/config.toml` `otp_expiry` is 86400 (activation links last a day).
- `scripts/pgtest-local.sh` — the Docker-free pgTAP harness §7 describes, as a
  script.

---

## 4 · Known defects and gaps, unassigned

New from this build:

- **Workers verified on a share code before 23.09 with no date still have
  none** — nothing to backfill from. Re-verify them; the query that finds them
  is in the header of `20260923200000`.
- **A verified settled-status share code shows "—"** on the candidate profile:
  `staff_documents_v` does not carry the new `rtw_no_time_limit` flag.
- **The share-code date is confirmed by the office** until the extractor that
  reads the gov.uk report exists; §2.3 says nobody types it (ADR-0018).
- **A later direct update that blanks a verified document's date is not
  refused** — only the moment of verifying is guarded, because the `200`/`220`/
  `250` fixtures blank dates that way. The worker's date still recomputes.
- **Rota guard gaps:** changing a shift's times does not re-check confirmed
  workers against the cap; one statement confirming several bookings for one
  worker can read a stale total; `weekly_booked_hours` counts `closed` bookings,
  which over-restricts; auto-assign labels an expired right to work as
  `hours_limit`.
- **N14 for a 10-hour-band student** lacks the "until [date]" clause (fixing it
  means restating `compliance_daily`).
- **New Starter report fields** (gender, postcode, country) are blank until
  collected; the wizard does not ask for gender yet.
- **Types not regenerated.** `packages/db` `types.generated.ts` is still the
  placeholder; the new RPCs are called through loose typed wrappers. Run
  `pnpm --filter @thc/db gen:types` against the live project after deploy.
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
- `docs/08-screen-inventory.md` does not yet list the `/documents` sub-routes,
  `/activate` or `/compliance/export`; `docs/14-open-questions.md` still lists
  O10 point 5 as open.

Carried over:

- **B2 · the booking state machine models four of the seven states the database
  can hold**, and there is no DB-side guard at all — `packages/domain/state.ts`
  rejects an illegal transition, a direct `update` does not. The convention in
  `CLAUDE.md` is one function in `state.ts` *and* a DB function; half of it is
  missing here.
- **B3 · `cancel_cause` has three disagreeing vocabularies** across the schema,
  the domain layer and the UI, and no check constraint anywhere. Pick one, write
  the constraint, migrate the rows.
- **D1 · the shared `Checkbox` and `Radio` cannot be operated by keyboard**
  (§1.2). Accessibility, and it affects every form already shipped.
- **D2 · `/apply` is a public write endpoint with no rate limit** (§2.1).
- **D3 · the GDPR consent on `/apply` links to a page that does not exist**
  (§1.7).
- ~~**`apps/staff/app/shifts/[id]/data.ts` takes `(row.logs ?? [])[0]`.**~~
  **Closed 23.09.** It was in `apps/office/app/checkin/data.ts` as well, on the
  §9.5 violation detail window — beside the "Actual finish (UK time)" field a
  manager types into to resolve one. Both now call `acceptedLog()` from
  `packages/domain/pay.ts`: `check_logs` holds one row per button press, a
  RULE-15 turn-away and an out-of-radius refusal are logged too, and only the
  accepted press carries `check_in_at`. The rule lives in `domain` rather than
  in either app precisely because both screens got it wrong the same way — one
  definition is what stops the third.
- **A worker's home address is not re-geocoded when they edit it.** There is no
  geocoder in the repo, so `home_location` — and therefore the §6 proximity score
  — goes stale on an address change. E7 tells the office and the screen says so,
  but it wants a decision rather than a note.
- **`/apply` is still unthrottled per caller.** The new limits are per email and
  per mobile; a distributed attacker with a fresh pair each time is bounded only
  at the edge. That belongs in front of PostgREST, so it is an `apps/` change.
- **`public.rls_auto_enable()` exists on the live project and in no migration.**
  A `SECURITY DEFINER` function that manipulates RLS, origin unknown, which was
  reachable unauthenticated. EXECUTE is now revoked from `public`, `anon` and
  `authenticated` by a `DO` block that no-ops where it is absent — but nobody has
  established what created it, and that is worth finding out.


---

## 5 · What is yours, not a session's

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
- **Set the secrets this build needs** (docs/12): `SUPABASE_SERVICE_ROLE_KEY`
  on the Office **and Staff** Vercel projects (uploads, activation, PDFs);
  `RESEND_API_KEY` and the VAPID pair for P2; `NEXT_PUBLIC_STAFF_URL` on the
  Office project — Accept refuses in production without it.
- **Supabase Auth → Email OTP Expiration → 86400.** Activation and reset links
  otherwise die after an hour.
- **Deploy the Edge Functions before `install_job_schedules()`**, and the
  migrations before `compliance-daily` (it now calls `rtw_daily`).
  `finance-reports` is deployed but its schedule stays disabled until P2.
- **Confirm with THC:** E2b's wording (ADR-0017); the CL1–CL6 wording and which are
  mandatory; whether ADR-0019's retention-over-removal extends to other
  right-to-work documents.
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
- **`002` assertions 6 and 7 fail in any local harness and that is expected.** It
  records the ADR-0010 known gap — on Supabase `anon` can write `spatial_ref_sys`
  — which is false locally because `postgres` owns PostGIS there. One failure is
  the clean baseline; two is a regression.
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
