# 00 · How to build this with Claude Code

The operating manual. Read this first, then `docs/11-session-prompts.md` for the prompt
to paste into your next session.

## Where the project is

Phase 0 of `docs/02-build-plan.md` is complete and on `main`. The repo builds, boots and
is covered by tests.

| Suite | Count | Command |
|---|---|---|
| Unit | 214 | `pnpm test` |
| Browser smoke | 24 | `pnpm turbo e2e:smoke` |
| Database, row-level security and rules | 289 | `supabase test db` |

What exists:

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
- **The Shift Builder** at `/events/new` and `/events/:id/edit` (§3.2), the first screen
  of Phase 3. Its rules live in `packages/domain/shift.ts` with `shift.vectors.json`:
  the four-hour minimum per role section, the derived event window (RULE-18), the
  allocation default of headcount + buffer, and the edit lock at the event's start.

What does not exist yet: every screen in Phases 1 to 7 apart from the Shift Builder, the
Supabase project, and the Vercel projects. Two pieces the Shift Builder leans on are also
outstanding and belong to later sessions:

- **Auto-assign itself** (§3.4). The switches and the per-role allocation are stored; no
  hourly round runs yet, so a saved event fills nobody.
- **The sender behind the outbox** (§8). Saving a time, dress-code or venue change sets
  `reconfirm_required` on that section's confirmed bookings and queues N11 in
  `notification_outbox` with its idempotency key — but no job drains the outbox to Web
  Push yet, so the row waits there.

Steps 2 and 3 of `docs/04` are still to do and need THC's accounts.

## Security: one item closed, one open

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

## How to run a session

```
Use the <bot> agent. Branch feat/<domain>-<thing>.
Goal: <feature> (§x.y). Read the section and the wireframe first.
Constraints: one domain; no shared-package changes without a separate PR first.
Done when: <acceptance from the build plan>. Then run qa-reviewer on the diff.
```

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
- Never edit an applied migration. Add the next numbered one. `0001`, `0002` and
  `0004` exist, and `0003` is reserved for the cron schedules in `docs/01` §4.
- Seed data mirrors `wireframes/CONVENTIONS.md`, so a screenshot and a test read the same.
- Keep THC's Appendix B inputs in an issue with due dates. Several phases block on them:
  Willo keys, contract text, sample letters, the logo, and DNS.
