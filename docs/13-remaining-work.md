# 13 · Remaining work, with a prompt for each

Every screen and system still to build, one prompt per session. `docs/11-session-prompts.md`
covers the foundation sessions; this file covers everything after them.

**Read before handing these out:**

- One domain per branch. Two bots on one branch collide. See `docs/10-working-with-agents.md`.
- Migrations are named by timestamp now, `YYYYMMDDHHMMSS_name.sql`, never by the next
  number in the folder. Sequential numbering collapsed under parallel sessions.
- Before starting, `git fetch origin && git branch -r` and check what other branches
  touch. Two sessions writing the same migration is the costliest collision here.
- The design boards in `design-handoff/` supersede `wireframes/` for the eleven screens
  they cover. Run `pnpm design` to view them. For everything else, `wireframes/` is still
  the reference.
- Ask `qa-reviewer` before opening the pull request.

## State of play

Built: the monorepo, the design system, sign-in for all three apps, the venues directory,
the domain rules (state machines, times, buffer, cap, scoring, pay), the §8 notification
register, the full row-level-security suite, and the live database with seed data.

Also built, server side only, with no screen in front of any of it:

- the whole day of the shift (§5.1–5.2b, §9.5) — check-in, check-out, breaks and Resolve,
  with the pay window behind them (screens B7, S5 are not built)
- the auto-assign engine (§3.4–3.6, §6) and the three rounds that run it (screen B3)
- the jobs layer (§7): `job_runs`, the outbox claim/complete pair, the UK wall-clock gate,
  and four of the ten background rules — `booking-tick` (BG-01/02/02b/03/09/10),
  `auto-staffing` (the hourly, 12:05 cutoff and escalation rounds) and `compliance-daily`
  (BG-04/05, plus the §4.3 block cascade and the §4.4 cap-band change)
- leaving (§10.6, `request_p45`) and the in-employment conviction declaration (§10.7,
  `declare_conviction`), both of which reuse the §4.3 cascade, plus the §2.12 staff state
  machine in SQL — which nothing had, though CLAUDE.md asks for every state change to be
  rejected in the database too. A Vitest holds it to `STAFF_TRANSITIONS` edge for edge.
- the manager's three profile buttons (§9.6): `block_worker_manually` with its mandatory
  reason, `unblock_worker` which runs the §4.3 full check first and reports what is still
  outstanding when it refuses, and `reset_to_candidate` — the Employee ID and all history
  retained, every piece of compliance evidence superseded but kept read-only
- GDPR removal (§1.7, `remove_worker`): anonymised to "Deleted account #id", documents and
  contacts deleted, the Storage objects queued for the `gdpr-purge` job, the public form's
  own submissions anonymised, login unlinked, future bookings released — and the Employee
  ID, bookings, violations and verbatim feedback all retained for reporting

Not built: every screen bar sign-in, the venues directory and the roles directory. Of the
background rules, BG-06/07 (geofence) wait on the geolocation shell and BG-08 on the
reports layer. Nothing writes `location_pings`, so the off-site check-out path always
takes its RULE-02 fallback until that shell lands.

**Nothing is sent.** N1–N15 and E1–E9 reach `notification_outbox` and stop: the drain is
registered but disabled, because Web Push needs VAPID keys and email needs Resend, and
both are in `docs/14` O3. The §4.3 cascade likewise has no manual entry point until §9.6
is built — see `docs/14` O10.

---

# Back Office

## B1 · Dashboard (§9.1)

> Use the `reports` agent. Branch `feat/reports-dashboard`.
>
> Build `/dashboard` per §9.1, matching the `BO1 Dashboard` frame in the design boards.
>
> The counters and the money row come from the database, not from placeholder numbers.
> Every scheduled time follows §1.8. The client never appears here, so margin is fine to
> show.
>
> Seed data already gives you 6 events, 33 bookings and 40 workers to render against.
>
> Done when: it matches the board, the numbers are derived by query, and a Playwright
> test asserts at least one counter against known seed values.

## B2 · Events list and calendar (§3.1)

> Use the `scheduling` agent. Branch `feat/scheduling-events-list`.
>
> Build `/events` per §3.1: the list, and the month, week and day calendars, with fill
> chips and the daily counters.
>
> Fill counts CONFIRMED bookings only, never invited. The chip shows confirmed against
> headcount, not against headcount plus buffer. Use `formatFill` and `isFilled` from
> `@thc/domain` rather than re-deriving them.
>
> Done when: all three calendar modes render from seed data and the fill rules have tests.

## B3 · Event board (§3.3–3.5)

> Use the `scheduling` agent. Branch `feat/scheduling-event-board`.
>
> Build `/events/[id]` per §3.3–3.5, matching the `BO2 Event board` frame.
>
> Four groups: Confirmed, Invited, the Potential pool, and Unavailable. The pool is ranked
> by `rankPool` from `@thc/domain`, which already implements §6 scoring and the wave
> ordering. Show the per-factor breakdown on hover, which is why `score` returns the parts.
>
> The rule most likely to be got wrong: a worker gated by `wrong_role` produces NO row at
> all, not even under Unavailable. The other four gates do appear there with their reason.
> `showsUnderUnavailable` encodes that.
>
> Also: Withdraw, No-show and Get back with the payroll-export warning, and Cancel event.
>
> Done when: it matches the board, ranking is provably the domain function's output, and
> the wrong-role case has a test.

## B4 · Auto-assign engine (§3.4–3.6, §6, §7)

> Use the `scheduling` agent. Branch `feat/scheduling-auto-assign`.
>
> Build the `auto-staffing` Edge Function. This is the heart of the product and the first
> Edge Function in the repo, so establish the pattern carefully.
>
> `packages/domain/scoring.ts` already holds the five factors, the weights, the hard gates
> and the wave ordering, with tests. Import it; do not reimplement.
>
> Three modes on one function: hourly additive rounds, the 12:05 cutoff that drops
> confirmed workers without "I'm ready" and fires N6b, and the 10-minute escalation that
> widens to 3 miles for events under way. Invitations are never withdrawn by auto-assign.
>
> Every run must be idempotent: outbox keys, `for update skip locked`, and a `job_runs`
> row per run, so a retry never double-invites.
>
> Done when: a 15-event day fills from seed data and the scoring order is provable from
> `job_runs`.
>
> **Half done, 21.09.2026.** The engine is built and tested in SQL — migration
> `20260921141500_auto_assign.sql`, 57 assertions in `supabase/tests/130_auto_assign.sql`.
> `auto_assign_candidates` gives the pool with its gate and the five §6 factor inputs,
> `invite_worker` adds additively, `accept_invite` is first-to-confirm with the automatic
> withdrawal of overlapping invitations, `release_unready_bookings` is the 12:00 cutoff
> with N6b, `self_cancel_booking` is RULE-04, and `auto_assign_due_shifts` splits hourly
> from escalation exclusively at the shift's start.
>
> What is left is only the Deno process that calls them, and it is blocked on ADR-0006
> exactly as `notify-drain` is: the function must import `packages/domain/scoring.ts`,
> because the scoring stays in TypeScript so it has one implementation. The ADR's
> option 3 has now been shown to build (see its 21.09.2026 update); take that first and
> both Edge Functions unblock together. The Edge Function is then thin: for each due
> section, read the candidates, `rankPool()` them, and call `invite_worker` for the top
> `allocation` — plus a distance filter of 3 miles and `p_ignore_target` in escalation
> mode.

## B5 · Onboarding kanban and candidate profile (§2.2–2.3)

> Use the `onboarding` agent. Branch `feat/onboarding-kanban`.
>
> Build `/onboarding` and `/onboarding/[id]` per §2.2–2.3, matching the `BO3 Onboarding
> kanban` and `BO4 Candidate profile` frames.
>
> Six columns plus the Active and Rejected split. The candidate profile changes by phase.
> Verify and Reject with a reason, which fires N8.
>
> Status transitions go through `canTransitionStaff` in `@thc/domain`, which encodes
> §2.12. A candidate can never skip the quiz or the contract, and the database rejects
> illegal transitions too.
>
> Done when: the kanban matches the board and every transition it offers is legal per the
> state machine.

## B6 · Compliance queue and expiry radar (§4.1–4.3)

> Use the `compliance` agent. Branch `feat/compliance-queue`.
>
> Build `/compliance` per §4.1: the Needs review queue and the Radar tab with counters.
>
> The queue holds every profile with a document under review, candidates and current
> workers alike, excluding Rejected and GDPR-removed. A criminal declaration answered No
> is auto-verified and never appears. Verifying one document does not unblock a worker by
> itself; the full compliance re-check does.
>
> Blocking is automatic. There is no manual "send reminder" button.
>
> Done when: it matches the wireframe, and the re-check rule has a test proving one
> verification does not unblock while something else is outstanding.

## B6b · University completion letter and the 48-hour opt-out (new requirement)

> Use the `compliance` agent for the review side and `staff-pwa` for the upload side.
> Branch `feat/compliance-completion-letter`.
>
> **Two SQL callers already read the old shape, and the TypeScript and SQL caps have
> diverged until this lands.** `packages/domain/src/cap.ts` now models the completion
> DATE, the 10-hour sub-degree band and visa expiry; `weekly_cap()` and `weekly_cap_for()`
> in `0008_weekly_cap.sql` still model only `graduated_at <= date`. Whoever builds the SQL
> half must also update:
>
> - `term_letter_applies()` (`20260921180312`), which stops the §4.2 expiry ladder for a
>   graduate. It keys on `staff.graduated_at`, so under the new rule it should key on the
>   course completion date — otherwise a letter issued before the final exam stops the
>   ladder early, which is the exact failure the new contract calls out.
> - `reset_to_candidate()` (`20260921183945`), which clears `graduated_at` with the rest of
>   the superseded evidence. Whatever column replaces or joins it needs clearing too, or a
>   returning candidate keeps a cap off evidence that has been superseded.
>
> Both are one line each; they are named here because neither is in this file's own domain
> and a grep for `graduated_at` is the only thing that finds them.
>
> ### `main` is red on this, and exactly why
>
> `090_weekly_cap.sql` fails two assertions on `main` (runs 107 and 110; last green was
> `ce593bd`, before `640272b`). They are different problems and only one is "the SQL half
> is missing":
>
> - **Assertion 2**, the `results_eq` at `090:34`, runs all 27 vectors through the SQL
>   `weekly_cap(visa_limited, term_state, completion_letter_verified, optout_48h)`. That
>   signature has four inputs and the new rule needs nine, so the vectors carrying a
>   completion date, a sub-degree course or a visa expiry cannot come out right. This one
>   is the deferred SQL half.
> - **Assertion 7**, the `is_empty` at `090:63`, asserts *"no ceiling is null, never 0 — a
>   0 would read as 'no hours left' to every caller"*. The new rule **deliberately makes 0
>   meaningful**: `weeklyCap()` returns 0 for a week wholly past right-to-work expiry, and
>   the generated vectors now contain exactly one such case (`visa_expired_0`,
>   `cap_vectors.psql:55`). So this assertion no longer states the rule — it contradicts
>   it, and it is stale rather than unimplemented.
>
> Assertion 7 is a one-line change and does not wait on the rest of B6b: the invariant
> needs re-wording to "no ceiling is null; 0 means no workable day in the week, which only
> a lapsed right to work produces". Worth doing first, because it gets `main` from two
> failures to one and makes the remaining one honestly say "the SQL half is not built yet".
>
> Contract: `docs/scope/university-completion-letter-requirement.pdf`. This is a NEW
> document from THC, not part of scope v1.6, and it refines RULE-20. Read it whole —
> the exposure is civil penalties for illegal working, so the cautious reading wins
> every time.
>
> **The rule half is already done.** `packages/domain/src/cap.ts` implements all of it:
> the 10-hour below-degree-level band, the release running from the course completion
> date rather than the verification date, the visa-expiry hard stop, opt-out
> cancellation after a notice period, and under-18s being unable to opt out. 27 shared
> vectors in `cap.vectors.json` hold the TypeScript and the SQL to the same cases. Do
> not re-derive any of that — read it and build against it.
>
> What is left is everything around the rule:
>
> - **Upload** (§2.1). Student/Tier 4 workers get a completion-letter slot in the Staff
>   App documents hub. Accept PDF, JPG, PNG, 10 MB. Also accept a completers transcript
>   or an official university email — one document type, three acceptable forms. The
>   worker enters the course completion date printed on it. The upload lands in
>   `pending` and changes NO cap by itself; that is acceptance criterion 2.
> - **Review** (§2.2). Approve or reject in the Needs review queue. A rejection needs a
>   reason and notifies the worker, who can re-upload. On approval the reviewer confirms
>   the completion date and the visa expiry.
> - **Audit and retention** (§4). Document, upload timestamp, reviewer identity, approval
>   timestamp, completion date, rejection reasons — all of it, exportable. Retention is
>   employment plus two years, which is longer than anything else in the schema, so it
>   needs its own rule rather than riding on the general one.
> - **Rota guard** (§4). Warn or block when an assignment would breach the current cap —
>   configurable, so it belongs in `settings`. The expiry hard stop is NOT configurable:
>   `canRoster()` is a hard no.
> - **Reporting** (§4). Every student-visa worker, their current cap, evidence status and
>   visa expiry, in one view.
> - **Notifications** (§5). Worker: upload received, approved with the new cap and its
>   effective date, rejected with the reason. Admin: awaiting review, visa expiry at
>   60/30/14 days, opt-out signed or cancelled. These are new entries in the §8 register
>   in `packages/notifications`, each with its own outbox key.
>
> Watch the edge cases in §7, which is where this gets subtle: a completion date in the
> future, a visa expiring around completion, and a worker switching to a Graduate or
> Skilled Worker visa mid-employment — a new right-to-work check that ends the student
> logic but leaves the 48-hour Working Time rules in force.
>
> Done when: the seven acceptance criteria in §6 each have a test naming them, and a
> Student-visa worker with no approved letter cannot be rostered past 20 hours in any
> week through the UI, not merely in the rule.

## B7 · Check-in monitor and violation log (§9.5)

> Use the `checkin` agent. Branch `feat/checkin-monitor`.
>
> Build `/checkin` per §9.5. This is the densest operational screen in the product.
>
> Live via Supabase Realtime on check_logs, bookings and violations. Every status pill,
> the dual-zone WINDOW column per §1.8, the Breaks column, and the violation log with
> detail and Resolve.
>
> The server side is already built: call `resolve_violation(id, note, actual_finish)`
> rather than writing to `violations` from the screen. It enforces the mandatory note,
> validates the finish time against the check-in and against now, reclassifies a No-show
> to Late exactly as "Get back" does, and returns `payrollExported` so you can show the
> "please notify Finance" warning on an already-exported shift. Until a No check-out is
> resolved the booking's payable time stays undetermined: `payableMinutes` in
> `@thc/domain` returns null rather than a number, deliberately.
>
> Done when: it matches the wireframe, updates live, and the undetermined case never
> renders a number.

## B8 · Staff directory and profile (§9.6, §4.5)

> Use the `directory` agent. Branch `feat/directory-staff`.
>
> Build `/staff` and `/staff/[id]` per §9.6, including the Inactive tab and the
> Student-visa view from §4.5.
>
> The profile has Overview, Documents, Client qualification, Shifts and Feedback. Manual
> Block and Unblock with a reason, and Reset to candidate, which supersedes evidence but
> keeps the Employee ID.
>
> The weekly cap shown here is calculated by `weeklyCap` from `@thc/domain`, never stored
> and never typed.
>
> Done when: it matches the wireframe and the cap string is derived, not persisted.

## B9 · Clients and rate cards (§9.7)

> Use the `directory` agent. Branch `feat/directory-clients`.
>
> Build `/clients` and `/clients/[id]` per §9.7, with the New and Edit modals, the rate
> card with per-client charge rates and the dress-code list, the qualified-staff block and
> the events block.
>
> Client qualification is granted manually here and automatically after a clean shift.
> Do-not-return lives here too.
>
> Done when: it matches the wireframe and the automatic grant has a test.

## B10 · Roles and rates (§9.8)

> Use the `directory` agent. Branch `feat/directory-roles`.
>
> Build `/roles` per §9.8. Small screen, one rule that matters: holiday pay is always
> shown broken out at 12.07%, never blended into the rate. `pay()` in `@thc/domain`
> returns base and holiday as separate fields for exactly this reason, so nothing can add
> them by accident.
>
> Done when: it matches the wireframe and no view anywhere shows a blended figure.

## B11 · Reports, CSV and the Monday send (§9.9)

> Use the `reports` agent. Branch `feat/reports-exports`.
>
> Build `/reports` per §9.9: the Financial, Payroll and New Starter tabs, with CSV export
> at one row per shift and holiday broken out.
>
> Shifts with an unresolved No check-out are HELD, not exported with a guessed figure.
> Payroll exports are never corrected retroactively; show a warning instead.
>
> Then the BG-08 job: a Monday 09:00 email to finance with the payroll CSV always, and the
> New Starter CSV only if there is anything in it.
>
> Done when: the CSVs match the spec column for column and the held-row rule has a test.

## B12 · Documents: allocation sheet and timesheet (§11.3–11.4)

> Use the `reports` agent. Branch `feat/reports-documents`.
>
> Build the allocation sheet and sign-out timesheet PDFs in `packages/pdf`, rendered
> through a route handler in the office app and stored to the `timesheets` bucket.
>
> `paginate` and `ROWS_PER_PAGE` in `packages/pdf` already fix twelve rows per page, with
> no trailing empty page on an exact multiple. Use them.
>
> Include the PO number. Names of removed workers appear anonymised. Send and Download
> both work from the event page, sending from `timesheets@`.
>
> Done when: a 25-worker event paginates to three pages and the anonymisation has a test.

## B13 · Feedback (§9.10)

> Use the `client-portal` agent. Branch `feat/client-portal-feedback`.
>
> Build `/feedback` per §9.10, two tabs, where Mark as read affects the rating. Plus the
> feedback block on the staff profile.
>
> Done when: it matches the wireframe and the rating effect has a test.

## B14 · System settings (§6, §2.4, §9.11, §9.12)

> Use the `platform` agent. Branch `feat/platform-settings`.
>
> Build `/settings`, admin only. This replaces what the scope called Django Admin: the §6
> scoring weights, the Willo stage map, venue-type radii, and the notification sender
> addresses. They live in the `settings` table, which 0001 already created.
>
> The weights must be read from settings at run time, not imported as the constant.
> `score()` in `@thc/domain` takes them as a parameter for this reason.
>
> Done when: changing a weight changes auto-assign ranking without a deployment.

---

# Staff App (PWA)

## S1 · App shell, auth and install (§10.1–10.2, §10.5)

> Use the `staff-pwa` agent. Branch `feat/staff-pwa-shell`.
>
> Build the PWA shell: the Serwist service worker, offline handling, the install flow, the
> Web Push subscription, and the auth screens A0 to A3 per §10.2.
>
> The manifest already exists and names three icons that now exist. Installability is what
> gates push on iOS 16.4 and later, so test the real install, not just the manifest.
>
> Done when: the app installs to a home screen, survives offline, and a push subscription
> round-trips.

## S2 · Onboarding wizard, 11 steps (§10.3, §2.5–2.11)

> Use the `onboarding` agent. Branch `feat/onboarding-wizard`.
>
> Build the 11-step wizard per §10.3, matching the `M3 Onboarding wizard` frame. The
> largest single piece of work in the product.
>
> Right-to-work branch with five document sets, share-code validator, address pin, selfie,
> documents and the criminal declaration where No is auto-verified, the health-and-safety
> viewer, the quiz at 80% over three attempts with E4 and a terminal screen, the HMRC
> checklist with a derived A/B/C statement, two references, bank details, and the contract
> where the timestamp is the signature.
>
> Split it across several branches if it gets unwieldy, one coherent group of steps each.
>
> Done when: the Appendix A journey runs end to end on the live database.

## S3 · Invites, Shifts and Radar (§10.4)

> Use the `scheduling` agent. Branch `feat/scheduling-staff-screens`.
>
> Build the three worker-facing scheduling screens, matching `M1 Shifts` and `M2 Invites`.
>
> Three-stage confirmation: accept, then "I'm ready" by 12:00 the day before, then the
> on-the-day confirm which is a reminder only and never releases the shift. The 12:05
> cutoff is hard.
>
> Self-cancel is available only while more than 72 hours remain, and it permanently
> excludes that worker from that event. `excludesFromEvent` in `@thc/domain` encodes that
> only self-cancel does this.
>
> Radar shows qualified workers first. A stale invite disappears the moment its event ends.
>
> Done when: all three match their frames and the three-stage rules have tests.

## S4 · Documents hub and conviction declaration (§10.4, §10.7)

> **The server side of §10.7 is built.** `declare_conviction()` adds the declaration to the
> history, suspends the worker exactly as an expired document does, and queues E9 without
> the declaration text. Verify and Reject on the row already do what §10.7 says. What is
> left here is the screen and the grant (docs/14 O10).

> Use the `compliance` agent. Branch `feat/compliance-staff-documents`.
>
> Build the worker's Documents tab with every state, re-upload after rejection, and the
> in-employment conviction declaration from §10.7.
>
> Declaring a conviction blocks the worker, releases their bookings and writes E9. It is
> released the same way as any other block: verification plus a full compliance re-check.
>
> Also the app-lock routing, cases 1 to 3 from §10.1.
>
> Done when: every document state renders and the conviction path has a test.

## S5 · On-shift screen (§10.4, §5.1–5.2b)

> Use the `checkin` agent. Branch `feat/checkin-staff-shift`.
>
> Build the shift detail and on-shift screens, matching the `M4 On shift` frame.
>
> Check-in, breaks, check-out with the earnings confirmation. The 30-minute grace means
> Late, not No-show. At start plus 30 the button locks, unless the booking was confirmed
> after the shift had already started.
>
> Every button has its RPC already: `attempt_check_in`, `start_break`, `finish_break`,
> `check_out`. Call them; do not write to `check_logs` or `breaks` from the app, because
> a worker holds no insert policy on either. `start_break` is disabled before check-in
> and absent entirely where the client pays for breaks (§3.2).
>
> Pay is computed by `payableMinutes` in `@thc/domain`. Note the asymmetry it encodes:
> checking in inside the grace pays from the SCHEDULED start, checking in past it pays
> from the ACTUAL time.
>
> Done when: it matches the frame and the earnings screen agrees with the domain function
> in every case.

## S6 · Profile, account and P45 (§10.1, §10.6)

> Use the `staff-pwa` agent. Branch `feat/staff-pwa-profile`.
>
> Build the profile sheet and its screens, matching `M5 Profile sheet`: profile details,
> security, payment information, and Request my P45.
>
> Requesting a P45 makes the worker inactive with a leaving date and fires E8 immediately
> rather than in a batch. Inactive is the leaver state: entered only this way, and left
> only by a manager pressing Reset to candidate. There is no reactivate.
>
> **The server side of this is built.** `request_p45()` does the whole §10.6 cascade and
> queues E8 with the released-shift list; it refuses while the worker is checked in, so
> the greyed-out button has a rule behind it. What is left here is the screen, and the
> grant: the function is service-role only until there is a caller (docs/14 O10).
>
> Profile edits fire E5, E6 and E7. An email change needs verification.
>
> Done when: it matches the frame and the leaver transitions match the state machine.

---

# Client Portal

## C1 · Events and the event page (§11.1–11.2, §11.5)

> Use the `client-portal` agent. Branch `feat/client-portal-events`.
>
> Build the events list and event page, matching the `CP1 Client Portal event` frame, plus
> the feedback popup that appears after an event starts.
>
> The line-up shows CONFIRMED workers only, with photo, name and role. It reads through
> `client_lineup_v`, which ADR-0004 gave a data path; do not query the base tables, which
> are deliberately closed to a client.
>
> No money appears anywhere on this portal. Not a rate, not a charge, not a total. The
> database enforces it and so should the code.
>
> Done when: it matches the frame, and a test proves no money field reaches the client.

---

# Platform and background

## P1 · Cron and the jobs layer (§7)

> Use the `platform` agent. Branch `feat/platform-jobs`.
>
> Build the background-jobs plumbing: `pg_cron` entries calling `pg_net` against Edge
> Functions, with a `job_runs` table and the outbox drain.
>
> The schedules are in `docs/01-architecture.md` §4. Times there are Europe/London but
> pg_cron runs in UTC, so convert and note the daylight-saving consequence in the
> migration.
>
> Every job must be idempotent. `outboxKey` in `packages/notifications` gives the unique
> key that makes a re-run a no-op.
>
> Done when: each job runs, is idempotent under a forced double-run, and writes a
> `job_runs` row.

**Mostly done.** The plumbing, the UK gate and three of the five Edge Functions exist and
are covered by pgTAP (110, 170, 180, 190, 200). What is left under P1: `finance-reports`
(BG-08, which needs the reports layer — see B11) and `notify-drain` (P2, which needs the
keys). The registry row for the drain is deliberately `enabled = false` so
`install_job_schedules()` does not schedule a post at a function that is not deployed.

One deploy-order rule, stated in each migration and repeated here because it is easy to
get wrong: `supabase functions deploy` runs **before** `install_job_schedules()`. The
other way round, pg_cron spends the gap posting at a 404.

## P2 · Notification senders (§8, §10.5)

> Use the `notifications` agent. Branch `feat/notifications-senders`.
>
> The §8 register is already complete as data. Build the senders: Web Push over VAPID and
> email through Resend, drained from `notification_outbox` by an Edge Function, with
> retries and backoff.
>
> Two verified senders, `admin@` and `timesheets@`. Needs the VAPID pair and the Resend
> key; generate the VAPID pair with `npx web-push generate-vapid-keys`.
>
> Done when: a push reaches an installed PWA, an email sends, and a failed send retries
> rather than vanishing.

## P3 · Willo and document extraction (§2.4, §2.6)

> Use the `onboarding` agent. Branch `feat/onboarding-integrations`.
>
> Two Edge Functions. `willo-webhook` verifies the signature, maps the stage through
> `settings.willo_stage_map` and moves the card, firing E2 on reject and E3 on accept.
> `extract-document` reads dates off uploaded documents behind a `DocumentExtractor`
> interface, with Gemini as the provider.
>
> The extractor NEVER verifies. It writes what it found plus a confidence, and flags for
> manual review. A manager verifies.
>
> The gov.uk share-code check follows ADR-0002: validate the format, open the check with
> the code and date of birth pre-filled, and let the manager attach the result.
>
> Done when: a sandbox Willo interview moves a candidate, and extraction populates an
> expiry with a confidence without ever setting verified.

## P4 · Lifecycle, GDPR and migration (§1.7, §10.6, Appendix B)

> **The lifecycle half is built**, server side: `request_p45` (§10.6), `remove_worker`
> (§1.7), `reset_to_candidate` (§2.12/§9.6) and the staff state machine in SQL. What is
> left under P4 is the Appendix B migration and the screens that press these.
>
> Two things §1.7 deliberately leaves to a later pass, recorded so they are not read as
> gaps: deleting the GoTrue `auth.users` row needs the admin API, which SQL cannot reach,
> so removal unlinks `user_id` instead; and redacting a worker's name from free-text
> feedback needs an LLM step the scope rules out of v1 — feedback is retained verbatim and
> the office redacts by hand. The Storage half IS built (`gdpr-purge`), and the only
> genuine residue is deleting the interview video at Willo, which waits on P3's account —
> see `docs/14` O11.

> Use the `platform` agent. Branch `feat/platform-lifecycle`.
>
> GDPR removal anonymises to "Deleted account #id" while keeping history rows and any PDF
> already issued. It is irreversible, and the state machine treats `removed` as terminal.
>
> Then the import from the old system: workers arrive `compliant` or `blocked` according
> to their document dates, on a staging dry run before sign-off.
>
> Done when: an anonymised worker still appears correctly on historical timesheets, and
> the import produces the right status split on staging.

---

# Before go-live

## G1 · Load test and hardening

> Use the `platform` agent. Branch `feat/platform-load-test`.
>
> 1,000 workers, 15 events a day, hourly auto-assign rounds under 30 seconds, push
> fan-out, and the check-in monitor with 60 concurrent viewers.
>
> The indexes and policy rewrites from the hardening pass exist to make this survivable;
> confirm they do.

## G2 · Final review

> Use the `qa-reviewer` agent. Read-only.
>
> Walk `docs/08-screen-inventory.md` against the routes that exist and report every gap.
> Then walk the numbered rules and confirm each is implemented once, in the layer that
> must enforce it, and reused rather than duplicated.
