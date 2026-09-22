# 14 · Where the build actually is, and what to do next

Written 22.09.2026 against `main`. This is the honest state, not the plan — every
line below was checked against the repository rather than taken from a checklist.
Where something looks finished but is not, it says so.

`docs/13-remaining-work.md` holds the per-screen prompts. This page is the map:
what exists, what is missing, and the order to do it in.

---

## 1 · What is genuinely built

**Foundations — done.** Three Next.js apps on one Supabase database, 32 migrations,
27 pgTAP files, the design system in `packages/ui`, and the pure rule layer in
`packages/domain` (`cap` `pay` `scoring` `autoAssign` `buffer` `time` `state`
`overlap` `shift` `events`). CI runs lint, typecheck, unit, `supabase test db` and
the Playwright suite on every push, and is green.

**Screens that exist today:**

| App | Routes |
|---|---|
| Back Office | `/` (stands in for the Dashboard) · `/events` · `/events/:id` (the board) · `/events/new` · `/events/:id/edit` · `/checkin` · `/roles` · `/venues` · `/login` · `/design-system` |
| Staff App | `/` · `/apply` · `/apply/submitted` · `/shifts/:id` · `/login` |
| Client Portal | `/` · `/client` · `/client/events/:id` · `/login` |

**Everything else in `docs/08-screen-inventory.md` is not started.** The Back Office
sidebar shows those routes greyed with a "soon" tag rather than linking to a 404.
Drop the `pending` flag in `apps/office/app/_components/OfficeShell.tsx` when one
lands.

---

## 2 · The place the code disagreed with itself — closed

**RULE-20 was implemented twice and the two did not match.**

`packages/domain/src/cap.ts` implemented the University Completion Letter
requirement in full. The SQL `weekly_cap()` did not — it still ran the older
four-input rule, and auto-assign filters on the SQL side inside a query, so a
student-visa worker could be offered a shift the TypeScript rule would refuse. The
worst case was not the student: an **under-18 with a recorded opt-out tick came back
uncapped**, no weekly ceiling at all, where the rule says a minor cannot sign one.

Migrations `20260922093000` and `20260922093100` close it. `weekly_cap()` now takes
all ten inputs and agrees with `cap.ts` across every one of the 27 shared vectors;
the four-argument signature survives as an overload that delegates, so existing
callers keep working and `090_weekly_cap.sql` asserts both. `can_roster()` covers what
the weekly cap structurally cannot — the week that straddles a right-to-work expiry
has workable days before it and none after, so that question is per shift, not per
week. `weekly_cap_for()` sources all ten facts from real columns:
`below_degree_level`, `course_completion_date` and `wtr_optout_cancelled_from` were
added to `staff` in the same migration.

**Worth knowing, because it nearly cost a regression.** Two sessions fixed this
independently and the second one's migrations were timestamped later, so they would
have applied last and `drop function ... weekly_cap(boolean, text, boolean, boolean)`
would have removed the overload the first one's tests rely on. They were dropped on
the branch rather than merged. `docs/13`'s header already says to run `git fetch
origin && git branch -r` before starting; this is what it is for, and a migration is
the most expensive place to learn it.

---

## 3 · Order to build in

Each of these has a full prompt in `docs/13-remaining-work.md`. Run one session per
item, on its own branch, and read `docs/10-working-with-agents.md` before running two
at once — it lists the three files that every session wants to touch.

1. **B6b · completion letter + opt-out.** The rule half is finished on both sides now
   and reads off real columns (§2 above). What is left is the screens and the plumbing
   around it: the upload, the review queue, the audit trail, retention, the rota guard,
   notifications and reporting. Legal exposure: civil penalties for illegal working.
2. **B1 · Dashboard (§9.1).** The one route every admin lands on after sign-in, and
   still the only screen in the Back Office standing in for itself.
3. **B5 · Onboarding kanban and candidate profile (§2.2–2.3).** `/apply` collects
   applications that nothing yet reviews.
4. **B6 · Compliance queue and radar (§4.1–4.3).**
5. **S1 · the PWA shell, auth and install (§10.1–10.2, §10.5).** The Staff App has two
   screens and no shell. It also gates the push keys in §4: installability is what makes
   Web Push possible on iOS at all, so "nothing is sent" cannot be fixed without it.
6. **B8 · Staff directory and profile.**
7. **B11/B12 · Reports, CSV, the Monday send, and the two PDFs.**
8. **S2 · the 11-step onboarding wizard**, then the rest of the Staff App.

**Done since this page was written:** B3 the Event board, B7 the Check-in monitor and
S5 the on-shift screen have all merged, and §1's route table is updated for them.

---

## 4 · What is yours, not a session's

- **Rotate the Supabase service role key.** It was pasted into a chat transcript and
  bypasses every security policy in the database.
- **Delete `ANTHROPIC_API_KEY` from the Vercel client project.** It belongs only in
  GitHub Actions secrets. Rotate it after.
- **Enable branch protection on `main`** — require a pull request and a green `ci`:
  https://github.com/saveezirfan0-cloud/thc-portal/settings/rules/new?target=branch
- **Turn on leaked-password protection** in Supabase Auth.
- **Chase THC for the Appendix B inputs**: contract text, sample completion letters,
  Willo keys, DNS for the two senders, and the export from the old system. Several
  phases stop dead without them.

---

## 5 · Deployments, and how not to run out

Preview deployments are **disabled** on all three Vercel projects as of 22.09.2026.

The reason, measured: of 67 deployments in one day, **52 were previews** from ten
feature branches — 78% of a 100/day free-tier allowance spent on builds nobody
opened. Pull requests are not what triggers a deployment; **a push to any branch is**,
once per project. Ten agents pushing to ten branches is thirty deployments before
anyone reviews a line.

With previews off, only `main` deploys: three per merge, and fewer when Vercel's
"skip unaffected projects" decides an app's dependencies did not change.

If you want a branch previewed, deploy it deliberately rather than turning previews
back on for everything.

---

## 6 · Things to know before you trust a local test run

- `supabase start` needs Docker, which some sandboxes block. When it is unavailable
  take database numbers from the CI run, not a local count.
- The browser suite signs in, so it needs to reach Supabase. Where egress is blocked
  every signed-in test fails with a `waitForURL` timeout. That is the environment,
  not the code — CI runs a local Supabase and passes.
- `pnpm format` once rewrote the checked-in `design-handoff/` vendor bundles. That
  folder is in `.prettierignore` now; do not take it out.

---

## 7 · Conventions that have already been broken once

Each of these cost a merge conflict or a red build today:

- **Migrations are timestamped**, `YYYYMMDDHHMMSS_`. Sequential numbering collapsed
  when four sessions all reached for `0006`. Two sessions still managed to pick the
  same second; CI now has a uniqueness guard.
- **ADRs collide too.** Four sessions reached for `0008`. Check `docs/adr/` for the
  highest number immediately before you write one.
- **pgTAP files collide as well** — three landed on `130`.
- **One feature, one session.** Two sessions built `/apply` independently and one
  implementation was thrown away. `docs/10-working-with-agents.md` has the ownership
  map; read it before starting.
