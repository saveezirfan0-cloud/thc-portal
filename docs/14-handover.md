# 14 · Where the build actually is, and what to do next

Written 22.09.2026 against `main`. This is the honest state, not the plan — every
line below was checked against the repository rather than taken from a checklist.
Where something looks finished but is not, it says so.

`docs/13-remaining-work.md` holds the per-screen prompts. This page is the map:
what exists, what is missing, and the order to do it in.

---

## 1 · What is genuinely built

**Foundations — done.** Three Next.js apps on one Supabase database, 29 migrations,
25 pgTAP files, the design system in `packages/ui`, and the pure rule layer in
`packages/domain` (`cap` `pay` `scoring` `autoAssign` `buffer` `time` `state`
`overlap` `shift` `events`). CI runs lint, typecheck, unit, `supabase test db` and
the Playwright suite on every push, and is green.

**Screens that exist today:**

| App | Routes |
|---|---|
| Back Office | `/` (stands in for the Dashboard) · `/events` · `/events/new` · `/events/:id/edit` · `/roles` · `/venues` · `/login` · `/design-system` |
| Staff App | `/` · `/apply` · `/apply/submitted` · `/login` |
| Client Portal | `/` · `/client` · `/client/events/:id` · `/login` |

**Everything else in `docs/08-screen-inventory.md` is not started.** The Back Office
sidebar shows those routes greyed with a "soon" tag rather than linking to a 404.
Drop the `pending` flag in `apps/office/app/_components/OfficeShell.tsx` when one
lands.

---

## 2 · The one place the code currently disagrees with itself

**RULE-20 is implemented twice and the two do not match.**

`docs/scope/university-completion-letter-requirement.pdf` is a new contract document
from THC. `packages/domain/src/cap.ts` implements it in full. The SQL
`weekly_cap()` does **not** yet — it still runs the older four-input rule.

That matters because auto-assign filters on the SQL side inside a query. Until the
migration lands, a student-visa worker could be offered a shift the TypeScript rule
would refuse. The 27 shared vectors in `cap.vectors.json` hold both implementations,
so the pgTAP suite will fail loudly rather than silently — but fix it first.

This is the top of the queue.

---

## 3 · Order to build in

Each of these has a full prompt in `docs/13-remaining-work.md`. Run one session per
item, on its own branch, and read `docs/10-working-with-agents.md` before running two
at once — it lists the three files that every session wants to touch.

1. **B6b · completion letter + opt-out.** Finish the SQL half first (above), then the
   upload, review, audit trail, retention, rota guard, notifications and reporting.
   Legal exposure: civil penalties for illegal working.
2. **B1 · Dashboard (§9.1).** The one route every admin lands on after sign-in.
3. **B3 · Event board (§3.3–3.5).** Scheduling is half-built: the Shift Builder
   exists, the board that fills it does not.
4. **B5 · Onboarding kanban and candidate profile (§2.2–2.3).** `/apply` collects
   applications that nothing yet reviews.
5. **B6 · Compliance queue and radar (§4.1–4.3).**
6. **B7 · Check-in monitor (§9.5)** and **S5 · the on-shift screen (§5.1–5.2b).**
   Build these as a pair — same rules, two ends.
7. **B8 · Staff directory and profile.**
8. **B11/B12 · Reports, CSV, the Monday send, and the two PDFs.**
9. **S2 · the 11-step onboarding wizard**, then the rest of the Staff App.

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
