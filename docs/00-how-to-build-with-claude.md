# 00 · How to build this with Claude Code

The operating manual. Read this first, then `docs/11-session-prompts.md` for the prompt
to paste into your next session.

## Where the project is

Phase 0 of `docs/02-build-plan.md` is complete and on `main`. The repo builds, boots and
is covered by tests.

| Suite | Count | Command |
|---|---|---|
| Unit | 611 | `pnpm test` |
| Browser smoke | 57 | `pnpm turbo e2e:smoke` |
| Database, row-level security and rules | 945 over 27 files | `supabase test db` |

The database figure is the sum of the declared plans across `supabase/tests/`, read off
this tree — 860 stated as literals plus `070_check_in_out.sql`, whose plan is computed
from `pay.vectors.json` (50 vectors + 35 fixed = 85). It is not a measured run. pgTAP
fails a file whose plan does not match the assertions it actually runs, so a green
`supabase test db` turns the sum into an exact count; a red one means the sum was the
wrong number to quote. `supabase start` needs Docker, which some sandboxes block, and
when it is unavailable the CI run is the number to take rather than a local guess.

The browser figure is 57 — nine spec files over three Playwright projects, so the suites
that run per app are counted once per app. On a checkout with no `.env.local`, 44 run and
13 skip: `gate.smoke`'s two role-routing assertions need a configured project to have a
gate to assert and run in all three projects (six), the Event Board suite needs a seeded
event (six), and `/apply`'s end-to-end submission needs somewhere for the application to
land (one). CI has both a project and a seeded database, so all thirteen run there and
the Client Portal suite skips instead — it asserts an ungated shell, and every route in
CI redirects to `/login`.

Each of those skips is conditioned on something the environment says about itself, never
on `process.env.CI`, so a suite that stops working still fails rather than quietly
skipping. The `/apply` one keys off the exact sentence the server action renders when no
project is configured, which with a project wired up can never appear.

What exists, at platform level:

- **Three apps** on Next.js. Office on port 3000, staff on 3001, client on 3002.
  `pnpm i && pnpm dev` works on a fresh clone with no environment file.
- **Five shared packages.** `ui` is the design system as plain CSS plus React
  components. `domain` holds the pure rules and their vectors. `db` holds the Supabase
  clients and roles. `notifications` holds the §8 register. `pdf` holds the §11.3 paging.
- **Sign-in** in all three apps, with role-routing middleware as the first gate in front
  of row-level security.
- **A live design system** at `/design-system` in the Back Office, showing every
  component against both token axes.
- **Seed data**: 5 clients, 8 venues, 6 roles, 40 workers, mirroring
  `wireframes/CONVENTIONS.md`.
- **32 migrations and 27 pgTAP files.** Every table carries row-level security and a
  test per role.

**The screen-by-screen, system-by-system map lives in `docs/14-handover.md`, and that is
the only copy.** §1 is what exists, §3 is the order to build in. This file kept a second
one and `docs/13` a third; all three drifted apart inside a day, and by the time
`docs/14` was written two of them were listing screens as unbuilt that had already
merged. Do not reintroduce one here — when copies disagree, nobody can tell which is
stale, and the cost lands on whoever picks the next session.

Two systemic gaps shape what is worth planning next:

- **Nothing is sent.** N1–N15 and E1–E9 reach `notification_outbox` and stop. The drain is
  registered but disabled, because Web Push needs VAPID keys and email needs Resend
  (`docs/14` O3). Every feature that "notifies" someone is therefore only half-observable.
- **Auto-assign does not fire on a schedule.** The engine, the additive rounds, the 12:05
  cutoff and the escalation handover are built and tested in SQL. The Edge Function that
  ranks between two RPCs is not, and waits on ADR-0006, so a saved event still fills
  nobody unless somebody calls the RPCs by hand.

Steps 2 and 3 of `docs/04` are still to do and need THC's accounts.

## Security: five closed, one open

1. **Closed.** A client could read both the charge rate and the pay rate straight from
   the role-sections table, which §11.1 forbids absolutely. Migration `0002` drops that
   policy. The lesson generalises: a view cannot take away a privilege the base table
   grants, so "hidden behind a view" is never an access control.
2. **Closed.** Eleven tables had no row-level security at all, so any signed-in user
   could read and write them through the API, bank details and tax checklists included.
   Migration `0004` policed all eleven. The guard test now asserts that no table in
   `public` is unpoliced, so the next one to arrive without it fails the build.
3. **Closed, by decision rather than by patch.** The Client Portal line-up returned
   nothing for a client: the view was `security_invoker` over four tables the client role
   cannot read, and after item 1 it never could. ADR-0004 chose owner-rights views that
   carry the tenancy rule themselves over client policies on money-bearing tables, and
   migration `0005` implements it. The lesson from item 1 still stands — the base tables
   did not move — but the shorthand "client access goes only through `security_invoker`
   views" was wrong and is corrected everywhere it appeared.
4. **Closed.** `event_windows` had run with owner rights since `0001` and still carried
   Supabase's default world grants, so `GET /rest/v1/event_windows` returned every
   event's timings to any caller, signed in or not. No rate ever left through it, but
   `0005` cites it as the precedent for owner-rights views and `0003` is reserved for
   `payable_shifts_v`, which is pay by definition. Migration `0009` takes the grants
   back and moves its one caller, `client_events_v`, onto the ADR-0004 shape. The guard
   test now also covers materialised views and foreign tables, which cannot carry RLS
   at all and were the cheapest way past it.
5. **Closed.** `location_pings` carried `admin_all ... for all` under a comment
   promising the rows were append-only. `inside_geofence` is the last on-site fix behind
   RULE-01 pay, so an admin could move a worker's money with no record. `0009` makes it
   `admin_read`, alongside `audit_log` and `report_sends`.
6. **Open, and an ADR rather than a patch.** No table sets `FORCE ROW LEVEL SECURITY`,
   so any connection as the table owner reads `bank_details` and `hmrc_checklists` in
   full. That bypass is currently load-bearing: the pgTAP fixtures depend on it, and so
   would the definer RPCs `0004` still owes. Forcing it means giving those routines an
   owner of their own. Assertion 7 in `001_rls_guard.sql` records the gap.

## How to run a session

```
Use the <bot> agent. Branch feat/<domain>-<thing>.
Goal: <feature> (§x.y). Read the section and the wireframe first.
Constraints: one domain; no shared-package changes without a separate PR first.
Done when: <acceptance from the build plan>. Then run qa-reviewer on the diff.
```

`docs/14-open-questions.md` carries the questions THC still has to answer — each one
already implemented one way, with what changes if they pick the other — and the short
list of things that need the repository owner rather than a bot.

`docs/11-session-prompts.md` has this filled in for each of the next sessions.
`docs/10-working-with-agents.md` explains how to run several at once without collisions:
the ownership map, the three shared hot spots, and which phases genuinely overlap.

Where to work:

- **Claude Code on the web.** One session per domain, each on its own branch. Once the
  Vercel and Supabase connectors are attached, a session can deploy a preview, run a
  migration against a branch database and read build logs.
- **CLI or IDE.** Same repo, same agents, with `supabase start` for a local database.
- **GitHub.** `@claude` on an issue with a `domain:*` label routes to that bot, and every
  pull request gets a `qa-reviewer` pass.

## When the design changes

The generated stylesheets in `packages/ui/src/styles` are split out of
`wireframes/assets/thc.css` on comment boundaries, so a design change is re-derived
rather than hand-patched. `auth.css` and `fixes.css` are hand-written and layer last;
re-check each fix against the new CSS and delete the ones the wireframes now handle.
Run S0 in the prompts doc, and use `/design-system` as the check: if a component looks
wrong there, it is wrong everywhere.

## Verifying your own work

Run what CI runs, in this order, before opening a pull request:

```
pnpm turbo lint typecheck test
supabase start && supabase test db
pnpm turbo e2e:smoke
```

One validated push beats three speculative ones. If you cannot run the database locally,
say so rather than reporting the suite as passing.

## Guard-rails

- The scope wins over any suggestion, including Claude's. Departures are ADRs in
  `docs/adr/`, not comments.
- Never let a session simplify a rule the scope states precisely. The recurring ones are
  storing the weekly cap instead of calculating it, blending holiday pay instead of
  breaking out the 12.07%, showing the event window where a role-section window belongs,
  and letting any money reach the client.
- Never edit an applied migration. Add the next numbered one. `0001`, `0002`, `0004`,
  `0005`, `0006`, `0007`, `0008`, `0009` and `0010` exist, and `0003` is reserved for the cron schedules
  in `docs/01` §4. Check `supabase/migrations/` before you pick a number, and check it
  again after merging `main`: git does not conflict on two files with different names,
  so two branches both reaching for `0006` merged quietly and turned `main` red at
  `d89e8ba` — Supabase keys `schema_migrations` on the digits before the first
  underscore, so the second file to apply is rejected and every step after it is skipped.
- Seed data mirrors `wireframes/CONVENTIONS.md`, so a screenshot and a test read the same.
- Keep THC's Appendix B inputs in an issue with due dates. Several phases block on them:
  Willo keys, contract text, sample letters, the logo, and DNS.
