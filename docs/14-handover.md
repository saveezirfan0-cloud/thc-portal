# 14 · Where the build actually is, and what to do next

Rewritten 22.09.2026 (evening) against `main`. This is the honest state, not the
plan — every line was checked against the repository rather than taken from a
checklist. Where something looks finished but is not, it says so.

`docs/13-remaining-work.md` holds a ready-to-paste prompt for every item named
below. This page is the map: what exists, what is missing, and the order.

> **Read `git log --oneline -40` before you take anything off this list.** On
> 22.09 alone three sessions each rebuilt something another session had already
> merged, because each trusted a page like this one instead of the repository.
> This page goes stale within the day.

---

## 1 · What is genuinely built

**Foundations — done.** Three Next.js apps on one Supabase database, **46
migrations**, **35 pgTAP files (1291 assertions)**, the design system in
`packages/ui`, the pure
rule layer in `packages/domain` (`cap` `pay` `scoring` `autoAssign` `buffer`
`time` `state` `overlap` `shift` `board` `events`), and the §8 notification
register in `packages/notifications`. The rule layer's own suite is **293 tests
across 14 files**, green. Four Edge Functions exist
(`auto-staffing`, `booking-tick`, `compliance-daily`, `gdpr-purge`). CI runs
lint, typecheck, Vitest, `supabase test db` and Playwright on every push, and
its `deploy-database` job pushes migrations to the live project on merge to
`main`. There is no `deploy.yml` — it existed briefly, fired from `workflow_run`,
and was folded into `ci.yml` because GitHub registers that trigger only from the
default branch. Before the job existed the live database sat 17 migrations behind
the repo for a fortnight.

**Screens that exist today:**

| App | Routes |
|---|---|
| Back Office | `/` (a landing page standing in for the Dashboard) · `/events` · `/events/:id` · `/events/new` · `/events/:id/edit` · `/checkin` · `/clients` · `/clients/:id` · `/staff` · `/staff/:id` · `/roles` · `/venues` · `/settings` · `/login` · `/design-system` |
| Staff App | `/` · `/apply` · `/apply/submitted` · `/shifts` · `/shifts/:id` · `/invites` · `/invites/:id` · `/radar` · `/radar/:id` · `/profile` · `/profile/details` · `/profile/security` · `/profile/payments` · `/login` |
| Client Portal | `/` · `/client` · `/client/events/:id` · `/login` — **§11 is feature-complete bar the two PDFs** |

Everything else in `docs/08-screen-inventory.md` is not started. The Back Office
sidebar shows `/onboarding`, `/compliance`, `/reports` and `/feedback` greyed
with a "soon" tag rather than linking to a 404; the Staff App does the same for
`/documents`. Drop the `pending` flag in `apps/office/app/_components/OfficeShell.tsx`
or `apps/staff/app/_components/StaffShell.tsx` when one lands.

`/settings` (§6, the Django-Admin replacement) **now exists** — scoring weights,
auto-assign limits, the Willo stage map, senders and the standard venue radii,
each block saved on its own. It is **not in the sidebar yet**: add it to `NAV` in
`apps/office/app/_components/OfficeShell.tsx`. Nothing reads the `senders` rows it
writes, either — `packages/notifications/src/templates.ts` still hard-codes the
two addresses, so §9.12's "changed without a release" is only half true until
whoever owns §8 makes the outbox drain read the setting.

The Staff App profile routes are `/profile/details`, `/profile/security` and
`/profile/payments`, where `docs/08-screen-inventory.md` says `/security` and
`/payments`. Nesting them is the better shape; **the inventory is what should
move**, and until it does the two pages disagree.

---

## 2 · Order to build in

Each item has a full prompt in `docs/13-remaining-work.md`. One session per item,
one branch per session, and read `docs/10-working-with-agents.md` before running
two at once — it names the three files every session reaches for.

1. **B1 · Dashboard (§9.1).** The route every admin lands on after sign-in, and
   the last Back Office screen still standing in for itself.
2. **B6b · completion letter and the 48-hour opt-out.** The rule is finished on
   both sides and reads off real columns (§3 below). What is left is everything
   around it: the upload, the review queue, the audit trail, retention, the rota
   guard, the notifications and the reporting. Legal exposure — civil penalties
   for illegal working — so this outranks its position in the numbering.
3. **B5 · Onboarding kanban and candidate profile (§2.2–2.3).** `/apply` has
   been collecting applications since it shipped and nothing reviews them.
4. **B6 · Compliance queue and expiry radar (§4.1–4.3).**
5. **S1 · PWA shell, auth and install (§10.1–10.2, §10.5).** The Staff App has
   its working screens but no shell: no service worker, no install flow, no push
   subscription. It gates **P2** — installability is what makes Web Push possible
   on iOS at all, so "no notification is ever sent" cannot be fixed without it.
6. **B11 / B12 · Reports, CSV, the Monday 09:00 send, and the two PDFs.**
7. **S2** (the 11-step wizard), then **S4** and **B13**. B14 is done.

---

## 3 · Closed since the last revision

- **RULE-20 was implemented twice and the two did not agree.** `cap.ts` had the
  completion-letter rule in full; the SQL `weekly_cap()` still ran the older
  four-input version, and auto-assign filters on the SQL side inside a query. The
  worst case was not the student: an **under-18 with a recorded opt-out tick came
  back uncapped**. Migrations `20260922093000`/`093100` close it — ten inputs,
  agreeing with `cap.ts` across all 27 shared vectors, with the four-argument
  signature kept as a delegating overload so existing callers still work.
  `can_roster()` covers what a weekly cap structurally cannot: a week straddling
  a right-to-work expiry has workable days before it and none after, so that
  question is per shift.
- **The live database was 17 migrations behind** and nothing would ever have
  pushed them. `ci.yml`'s `deploy-database` job now does, on merge.
- **The Client Portal was ungated** — `/client` served without a session. The
  cause was empty Supabase values on that one Vercel project, not anything in the
  code. All three middlewares now fail closed with a 503 when they are
  unconfigured, read the role from `app_metadata` only (never `user_metadata`,
  which the user can write), and answer a wrong-app role with a terminal 403 page
  instead of a redirect that could loop.

---

## 4 · Known defects, unassigned

These are real and nobody is on them. The first two came out of the `qa-reviewer`
sweep; the rest were found by running things rather than reading them.

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
- **`apps/staff/app/shifts/[id]/data.ts` takes `(row.logs ?? [])[0]`.**
  `check_logs` holds one row per button press, not one per booking, so a worker
  who was turned away and then checked in can render the wrong log. The SQL
  elsewhere uses `left join lateral … where check_in_at is not null … limit 1`
  for exactly this; that screen does not.
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
- ~~**Delete `ANTHROPIC_API_KEY` from the Vercel client project.**~~ **Done 22.09.**
  It belongs only in GitHub Actions secrets. Note that the `claude` check stays
  red until that secret is set on the repository: it fails environment validation
  before it reads a diff, so a red `claude` is not a review finding. `build-test`
  is the check that gates a merge.
- **Enable branch protection on `main`** — require a pull request and a green
  `ci`: https://github.com/saveezirfan0-cloud/thc-portal/settings/rules/new?target=branch
- **Turn on leaked-password protection** in Supabase Auth. The advisor still
  reports it off.
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
  unavailable, **build a throwaway cluster rather than shipping unrun SQL**: a
  plain PostgreSQL 16 `initdb`, the Supabase-shaped roles and schemas, then every
  migration in order against an empty database and `pg_prove` over
  `supabase/tests`. It takes a few minutes and it is how the three defects in the
  staff self-service migration were found — including one that raised at run time
  and not at create time, so it would have deployed green and broken every
  contact save.
- **`002` assertion 6 fails in any local harness and that is expected.** It
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
  the highest number immediately before you write one. It is at `0011`.
- **pgTAP files collide as well**; three landed on `130`. Number from the highest
  file in `supabase/tests/`, not from the highest you remember.
- **Doc numbers collide.** There are two `14-`s right now: this page and
  `14-open-questions.md`. Renumber one when neither is being edited.
- **One feature, one session.** Two sessions built `/apply` independently and one
  implementation was thrown away. `docs/10-working-with-agents.md` has the
  ownership map; read it before you start.
