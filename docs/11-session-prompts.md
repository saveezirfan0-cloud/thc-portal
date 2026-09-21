# 11 · Session prompts

Copy-paste prompts, one per Claude Code session. Each is self-contained: a fresh
session gets the goal, the scope sections, the wireframe, what already exists, what it
must not touch, and how it will be judged.

**Before you paste any of these**, read the two rules that keep parallel sessions apart:
one domain per branch (`docs/10-working-with-agents.md`), and shared-package changes go
first in their own pull request.

**If the design has changed**, run S0 before anything that draws a screen. S2 is
design-independent and can run regardless.

---

## S0 · Design refresh (run first if the wireframes changed)

> Use the `design-system` agent. Branch `feat/design-system-refresh`.
>
> The wireframes have been updated. Re-derive `packages/ui` from them.
>
> `packages/ui/src/styles/{tokens,base,components,warm}.css` are generated copies of
> sections of `wireframes/assets/thc.css`, split on comment boundaries. Regenerate them
> from the new file, keeping the split and the header comments. `auth.css` and
> `fixes.css` are hand-written and layered last: re-check whether each fix in
> `fixes.css` is still needed against the new CSS, and delete any that the wireframes
> now handle themselves.
>
> Then reconcile the React components in `packages/ui/src/components` against the new
> class contract. A component that emits a class the CSS no longer defines is a bug, and
> so is a CSS class with no component.
>
> Constraints: `packages/ui` only. Do not touch `apps/`, `packages/domain`, or
> `supabase/`. Components read tokens only, never a hard-coded colour or radius.
> Keep both token axes (`data-style` warm/scope, `data-theme` light/dark) working
> independently, per ADR-0003.
>
> Done when: `/design-system` in the Back Office renders every component correctly in
> both modes, `pnpm lint typecheck test build` is clean, and the Playwright smoke suite
> still passes. Screenshot both modes and say what changed.

---

## S1 · Close the row-level-security gaps — DONE

Migration `0004_rls_gaps.sql` policed all eleven tables. The guard test now asserts that
no table in `public` is unpoliced, so this cannot silently regress.

Three calls in that migration were judgement rather than scope, and are cheap to reverse
if you disagree. Workers get nothing from `client_qualifications`, because exposing it
would pull the client directory into the staff app. `venue_types` is readable by any
signed-in role as harmless reference data. Bank details and references took real write
policies rather than RPCs, which leaves the E5 notification on a bank change unwired;
picking that up belongs with S2.

## S2 · Notification register (§8)

> Use the `notifications` agent. Branch `feat/notifications-register`.
>
> `packages/notifications` currently holds two seed templates and the outbox key helper.
> Fill in the full §8 register: every push N1–N15 and every email E1–E9, copy taken
> verbatim from the scope, with the trigger and timing recorded next to each entry.
>
> Copy is data, not code. Keep the existing shape: one entry per code, `channel`,
> `title`, `body`, `sender` for emails (§9.12), `deepLink` for pushes. Add a test that
> every code in §8 has an entry and no entry invents a code the scope does not name.
>
> Constraints: `packages/notifications` only. Do not wire any sender yet, and do not
> touch `supabase/` or the apps. This is a shared package, so it ships as its own pull
> request before any phase that sends anything.
>
> Done when: the register is complete against §8, `pnpm --filter @thc/notifications test`
> passes, and you list any §8 copy that is ambiguous or missing.

---

## S3 · Phase 1 · Onboarding and applicant tracking

> Use the `onboarding` agent. Branch `feat/onboarding-apply`.
>
> Build Phase 1 from `docs/02-build-plan.md`. Start with the public application form
> only; the wizard and the kanban follow in later sessions on their own branches.
>
> This session: `/apply` and `/apply/submitted` in `apps/staff` per §2.1 and §2.12,
> matching `wireframes/public/apply.html`. Duplicate check leading to the returning
> applicant entry. Age 18 or over enforced on the form and again on the server.
>
> What already exists: the monorepo, `packages/ui` components, role-routing middleware
> with `/apply` already public, sign-in, seed data with 40 workers, and the RLS suite.
>
> Constraints: `apps/staff/app/apply/**` and a new migration if you need a table.
> Do not touch `packages/ui`; if a component is missing, say so and stop rather than
> adding it here. Do not touch other apps.
>
> Done when: the form matches the wireframe, both age checks are tested, the duplicate
> path works, `pnpm lint typecheck test build` is clean, and a Playwright test covers a
> successful submission and a rejected under-18. Then run `qa-reviewer` on the diff
> against §2.1.

---

## S4 · Phase 2 · Directory data

> Use the `directory` agent. Branch `feat/directory-venues`.
>
> Build the Venues screens per §9.11 and `wireframes/backoffice/venues.html`: list, map,
> and the create/edit modal, with venue-type defaults driving the radius, the radius
> slider, reverse geocoding on the pin, and soft delete.
>
> What already exists: `venue_types` and `venues` tables with 8 seeded venues whose
> coordinates, types and radii come from the wireframe. Note that `venue_types` currently
> has no RLS, which session S1 is fixing; do not duplicate that work.
>
> Constraints: `apps/office/app/venues/**` only, plus a migration if the schema is short
> of something. One domain per pull request, so leave Clients, Roles and Staff for their
> own sessions.
>
> Done when: the screens match the wireframe, the radius defaults come from the table
> and not from code, and `qa-reviewer` passes the diff against §9.11.

---

## S5 · Phase 3 · Scheduling and auto-assign

> Use the `scheduling` agent. Branch `feat/scheduling-shift-builder`.
>
> Build the Shift Builder per §3.2 and `wireframes/backoffice/shift-builder.html`.
>
> The rules this screen gets wrong most often, all already asserted in
> `packages/domain/buffer.ts` and its tests: the buffer is absolute and displays as
> `6 (+1)` and never `7`; allocation defaults to headcount plus buffer; every timing rule
> uses the role section's own window and never the event window (RULE-18); a section is
> at least four hours; the event is edit-locked once it starts.
>
> Use `formatAllocation`, `allocationTarget` and `seatsToOffer` from `@thc/domain`
> rather than re-deriving them. If you need a rule that is not there yet, add it to
> `packages/domain` in a separate pull request first, with vectors.
>
> Constraints: `apps/office/app/events/**`. The auto-assign engine is a later session.
>
> Done when: the builder matches the wireframe, the four rules above have tests, and
> `qa-reviewer` passes the diff against §3.2.

---

## S6 · Phase 4 · Compliance and the weekly cap

> Use the `compliance` agent. Branch `feat/compliance-cap`.
>
> Complete RULE-20 (§4.4–4.5). `packages/domain/cap.ts` already resolves the band and
> `packages/domain/src/cap.vectors.json` is the contract between the TypeScript and SQL
> implementations. `0001_init.sql` has a `weekly_cap_hours` function.
>
> This session: make the SQL function agree with the vectors case for case, add pgTAP
> covering every vector, and add the hours-summing side that the band resolver does not
> do. The cap is calculated and never stored or typed by a manager.
>
> Watch the case the scope is explicit about: a Monday-to-Sunday week straddling term and
> holiday takes the lower cap.
>
> Constraints: `packages/domain/cap.ts`, `supabase/`. If you change the vectors file,
> that is a shared-package change and goes in its own pull request first.
>
> Done when: the same vectors pass in both Vitest and pgTAP, and neither implementation
> has a case the other lacks.

---

## S7 · Phase 5 · Check-in, check-out and pay

> Use the `checkin` agent. Branch `feat/checkin-rpcs`.
>
> Build `attempt_check_in` and `check_out` as Postgres functions per §5.1–5.2b, plus
> `packages/domain/pay.ts` with the pay maths, sharing vectors the way `cap.ts` does.
>
> The rules to assert, not assume: 30 minutes of grace counts as Late; at start plus 30
> the booking becomes an automatic No-show and the button locks, except where the booking
> was confirmed after the shift had already started; the first `headcount` check-ins work
> and later ones are turned away, paid a fixed four hours if on time and nothing if late
> (RULE-15); check-out is open from the start until four hours after the end, from
> anywhere, using the last on-site fix when off-site; at end plus four hours it becomes a
> No check-out violation and never a silent default; payable time is the check-in to
> check-out window intersected with the scheduled window, with a 15-minute check-out
> grace, unpaid breaks deducted and a four-hour floor.
>
> Constraints: `supabase/` and `packages/domain/pay.ts`. The monitor screen is a separate
> session.
>
> Done when: every rule above has both a pgTAP case and a Vitest vector, and they agree.

---

## S8 · Phase 6 · Client Portal line-up (needs a decision first)

> Read this one before pasting. It carries an open design question.
>
> `client_lineup_v` returns nothing for a client today. It is a `security_invoker` view
> over `bookings`, `staff` and `roles`, and the client role holds no policy on any of
> them, so §11.2's confirmed line-up has no data path. The view body is sound; the
> problem is underneath it.
>
> The two honest fixes pull against each other. A `security definer` view or RPC
> contradicts the rule in `CLAUDE.md` that client access goes only through
> `security_invoker` views. Adding client policies to the underlying tables re-opens the
> money hole that `0002` just closed, because `roles` carries `pay_rate`.
>
> Decide which way to go, record it as an ADR, then build. Do not let a session pick
> silently.

---

## S9 · Review before every pull request

> Use the `qa-reviewer` agent. Read-only.
>
> Review the diff on this branch against §<section> and `wireframes/<file>`. Run
> `pnpm lint typecheck test build` and the pgTAP suite. Report drift as a checklist with
> section references. Flag anything that simplifies a rule the scope states precisely,
> in particular a stored weekly cap, blended holiday pay, an event window used where a
> role-section window belongs, or money reaching the client.
