# 14 · Open questions, and what needs you

Two lists. The first is for THC: places where the Scope of Work does not decide
something the code has to decide anyway. Each one is **already implemented** — the
platform cannot wait on an answer — so every entry says what it does today, what the
alternative was, and what changes if THC picks the other one. None of them is a defect.

The second list is work that belongs to the repository owner rather than to a bot.

How to use the first list: take it to THC as written. The "Ask" line is the question in
their language; everything above it is why it is being asked.

---

# Questions for THC

## Q1 · A replacement who arrives late to a full shift is paid nothing

**Where:** §5.1 (the No-show lock) against RULE-15 (buffer turn-away pay).

Two rules that were written separately meet here. §5.1 says a booking confirmed *after*
the shift has already started — the replacement pulled in by the buffer-exhausted
escalation (§3.4) — is exempt from the 30-minute No-show lock, because a window measured
from a start they were not booked for is meaningless for them. RULE-15 says a worker
turned away because the headcount is full is paid a flat four hours **if their attempt is
inside that same 30-minute window**, and nothing if it is not.

So a replacement confirmed at 19:30 for a 18:00 shift, who crosses London and arrives at
20:15 to find the shift full, is "late" by RULE-15's clock and is paid nothing — even
though §5.1 has just said that clock does not apply to them.

**Today:** implemented exactly as the scope reads. RULE-15 measures from the scheduled
start for everyone, with no exemption.

**The alternative:** measure a post-start confirmation's promptness from the moment they
were confirmed, not from the scheduled start — so the replacement above would be "on
time" and paid the four hours.

**What changes if THC picks the alternative:** one branch in `check_in_decision`, its
vectors, and the pgTAP and Vitest cases that pin them. Small, and safer to change now
than after the first real turn-away.

> **Ask:** if we pull in a replacement after a shift has started and the shift is full by
> the time they arrive, should they be paid the four-hour turn-away — or nothing, because
> they arrived more than 30 minutes after the original start time?

## Q2 · A break the worker forgets to end

**Where:** §5.2b. The scope says several breaks per shift are allowed and the total is
deducted from the hours worked. It does not say what a break with no end is worth.

A worker presses **Start break** at 19:00, is called back to the floor, never presses
**Finish break**, and checks out at 23:30. The break row has no end.

**Today:** the break runs to the recorded finish, so 4½ hours are deducted. The four-hour
minimum (RULE-14) still protects the floor, and the monitor's Breaks column shows the
manager what happened. Check-out now closes the row, so it stops reading as "still on
break" after the shift has ended.

**The alternative:** ignore a break with no end, and pay the time.

Neither is obviously right. Deducting it charges a worker for a button they did not
press; ignoring it pays for a break they did take. The current choice is the one that
does not bill the client for time nobody worked.

> **Ask:** if a worker starts a break and never presses "Finish break", should we deduct
> the time up to their check-out, ignore it, or deduct a fixed amount — say the 20 minutes
> UK law requires on a shift over six hours?

## Q3 · "Get back" long after the shift has ended

**Where:** §3.3 and §9.5. Resolving a No-show "registers the worker as arrived and
reclassifies them to Late, with the minutes-late figure based on the moment the manager
pressed it." There is no bound on when that press can happen.

Pressed during the shift, this is exactly right. Pressed the next morning — tidying up
the violation log — it registers an arrival *after the shift ended*, and RULE-01 then
prices a window that has already closed.

**Today:** the press time is taken at face value, as written. In practice the four-hour
minimum means such a worker is paid four hours.

**The alternative:** refuse the reclassification once the section has ended and ask the
manager for the arrival time, the way "Actual finish (UK time)" is already asked for when
resolving a No check-out.

> **Ask:** when a manager clears a No-show after the shift has finished, should we ask
> them what time the worker actually turned up — or is it enough to record it as the
> moment they pressed the button?

## Q4 · What "Resolve" does to the show-rate

**Where:** §9.5: "Resolving removes or reduces the effect on the worker's show-rate."

Removes and reduces are different numbers, and the show-rate is 30% of the auto-assign
score (§6) — the heaviest single factor. A resolved No-show that still counts at half
weight ranks a worker differently from one that does not count at all.

**Today:** nothing depends on it yet. `staff.reliability` is materialised nightly and the
job that computes it has not been built, so this is a question to settle **before** that
job is written rather than after.

> **Ask:** once a manager resolves a violation with a note, should it stop counting
> against that worker's reliability score completely, or still count — and if so, by how
> much?

## Q5 · A term letter that arrives for next year, in December

§4.2 is explicit that the University Term Dates Letter expires on **31 December**,
whatever dates are printed inside it, and that the reminder ladder opens on 1 December.
That is a calendar year, which leaves one case the scope does not name: the student who
uploads next year's letter **in December**, before the current one has died.

Read literally, that letter expires on the 31 December of the year it was uploaded — so a
letter uploaded on 5 December, in answer to the reminder sent on the 1st, is dead on the
31st. On 1 January the student is auto-blocked under §4.3 and loses every future shift
they hold, for doing exactly what the reminder asked.

**What it does today** (ADR-0011): a letter uploaded in **November or December** runs to
the following 31 December. Every other letter expires on the 31 December of the year it
was uploaded. The letter's own printed dates are never read — not the graduation date, not
the vacation ranges — which is the part of §4.2 the scope argues hardest for.

**The alternative** is the literal reading, which blocks the early student. §4.2 does
accept blocking at the year boundary, but only for the student who is *late* ("e.g. it
arrives mid-January"), and the December uploader is the opposite of late.

> **Ask:** if a student uploads next year's term dates letter in December, in answer to
> the reminder you just sent them, should it cover the year ahead (what we do), or expire
> on the 31st a few weeks later?

---

## Q6 · N14 says "until [date]", and two of the five bands have no date

§4.4 gives N14's copy as: *"Your weekly limit is now [20 / 48] hours — [term time /
university holiday] until [date]."* For a student that reads perfectly — the date comes
off the verified term letter.

Two of RULE-20's five bands have no such date, and one has no number either:

- **`graduated_48`** — the completion letter is permanent and §4.5 says term dates no
  longer apply.
- **`uncapped`** — the worker signed the 48-hour opt-out. Nothing ends that until they
  revoke it, and "[20 / 48] hours" has no value to offer.

**What it does today.** The register holds N14 as three halves, the way it already holds
N9 as two:

| variant | copy |
| --- | --- |
| `dated` | Your weekly limit is now {limit} hours — {band} until {date}. |
| `open` | Your weekly limit is now {limit} hours — {band}. |
| `uncapped` | You no longer have a weekly hours limit — {band}. |

The third exists because the alternative sends *"Your weekly limit is now no hours"* to
somebody who just removed their ceiling — the opposite of what happened. The band reaches
the worker as words ("term time", "university holiday") rather than as the enum label.

> **Ask:** for a worker with no end date — graduated, or opted out — is dropping the
> "until …" clause right, or should it read something like "until further notice"? And is
> "You no longer have a weekly hours limit" the wording you want for the opt-out?

---

## Q7 · Which documents each right-to-work branch must actually have

§4.3's unblock rule is "every document … must be verified and not expired", and §4.4 says
a student whose term letter "has expired **or is missing**" is already blocked. Both
presuppose an expected set of documents per worker, which §2.5 lists in prose per branch.

**What it does today.** `compliance_blockers()` reports documents that are expired,
documents that are uploaded but unverified, and an unreviewed Yes on the conviction
declaration. It does **not** report a document that was never uploaded at all, because
nothing in the database says which documents a given branch owes. A worker with zero
document rows therefore reads as compliant.

This is not currently reachable — onboarding (§2) will not release anyone to `compliant`
without their documents — so it is a latent hole rather than a live one. Closing it means
turning §2.5's prose into a `required_docs(rtw_branch)` table, which is onboarding's
piece of work (B5/S2) rather than the compliance sweep's.

> **Ask:** nothing for THC here — this is a note for whoever builds §2.5's document sets,
> so that `compliance_blockers()` gains a `document_missing:` arm at the same time.

---

---

# For the owner

## O0 · The SQL and TypeScript weekly caps have diverged — see B6b

Recorded here because this file is where the open items live, but the detail belongs to
`docs/13` **B6b**, which covers it better than a duplicate would: which two SQL callers
read the old shape, why assertion 2 and assertion 7 are different problems, and why the
SQL half was deliberately deferred rather than rushed.

The one line worth repeating outside that session: it is live, and `auto_assign`'s hours
gate reads `weekly_cap()`. The vector that fails most visibly is the under-18 one — "An
under-18 cannot opt out, so a recorded tick does not lift the ceiling" — where the SQL
returns `uncapped`. Whoever picks up B6b should treat that case as the one with a
statutory floor under it rather than a contractual one.

I first wrote this up as an unnoticed defect found while merging. That was wrong, and the
correction is the useful part: the gap was a considered trade — `640272b` refined RULE-20
from a new THC contract and regenerated the shared vectors, leaving the nine-input SQL
rewrite to its own session rather than bundling it into a GDPR pull request. The failing
test is the deferral being honest about itself, which is what a vectors file is for.

What it does cost, and what O2 is really about: `supabase test db` fails, so **every run
skips `e2e:smoke` entirely**. Five pull requests have now merged through this red, each
correctly reasoning that the failure was not theirs. None of them had browser coverage
run against it either.

## O1 · Force row level security (carried, by your decision)

`docs/00` records it as the one open security item: no table sets `FORCE ROW LEVEL
SECURITY`, so any connection as the table owner reads `bank_details` and
`hmrc_checklists` in full. Assertion 7 in `001_rls_guard.sql` pins the gap so it cannot
be forgotten.

It is not a one-line change, which is why it is yours rather than a bot's: the pgTAP
fixtures depend on the owner bypass, and so do the `security definer` RPCs, which would
each need an owner role of their own. Worth noting that the check-in work has kept this
from growing — `resolve_violation` is deliberately `security invoker`, because admins
already hold the policies it needs.

## O2 · Parallel sessions keep colliding on file names

Three collisions so far, none of which git reports as a conflict, because the filenames
differ: two migrations numbered `0005`, four renumbered to `0006`, and two `/apply`
implementations built at once (resolved on `main` in bbfb885). Timestamps have not fixed
it either — this branch and the `/apply` branch both picked `20260921150000` to the
second, and Supabase keys `schema_migrations.version` on exactly that prefix, so the two
would have collided on a primary key rather than merely sorting oddly.

Two more since that was written, making five: a third `0006` migration (the weekly cap,
which kept `main` red after the first fix), and two ADRs numbered `0008`. The ADR one is
cheap — a rename — but it is the same failure, and it means the habit now costs something
in three directories rather than one.

**This is no longer only a process note.** `scripts/check-file-numbering.mjs` now runs as
the first step in CI, over `supabase/migrations`, `supabase/tests` and `docs/adr`. It
fails in milliseconds on the merge result, which is where the collision actually exists —
a PR's own branch always looks fine, which is exactly why five of these reached `main`.
Verified against all four real collisions plus the identical-timestamp case above.

It catches, it does not prevent. The habit at the top of `docs/13` still matters
(`git fetch origin && git branch -r` before naming a file, and a timestamp with real
minutes rather than a round number); the guard just means a miss costs a rename on a red
PR instead of an hour of red `main` for nine sessions.

## O3 · The accounts the build is waiting on

Steps 2 and 3 of `docs/04` still need THC's own accounts, and `docs/12` lists the keys.
Nothing in Phases 1–5 is blocked on them yet; Phase 6 onwards is.

### What is blocked, and on which key

Each line is a piece of work that is otherwise ready. Nothing here is a defect or a
design question — it is a credential a bot cannot obtain, so the work stops at the point
where it would need one. Ticked when the key exists and the work can resume.

- [ ] **VAPID key pair** (`npx web-push generate-vapid-keys`) and **Resend API key** —
      blocks P2, the `notify-drain` Edge Function. The §8 register and the outbox
      claim/retry are merged and tested; what cannot be done without these is proving a
      push reaches an installed PWA and an email actually sends. Two verified senders are
      also needed, `admin@` and `timesheets@`, with SPF/DKIM/DMARC — THC dependency B7.
- [ ] **`settings.edge_base_url` + a `service_role_key` vault secret on the live
      project** — blocks running `select install_job_schedules()`. Until then every §7
      cron entry is registered as data and none is scheduled. `install_job_schedules()`
      raises rather than scheduling a broken job if the URL is missing, deliberately.
      **Ordering:** `supabase functions deploy` first, `install_job_schedules()` second.
      Installing first schedules a per-minute call to a function that is not there yet.
      `booking-tick` is the first entry marked enabled, because its function now exists.
- [ ] **Gemini API key** — blocks P3, the `extract-document` Edge Function (§2.6).
- [ ] **Willo account + webhook signing secret** — blocks P3's `willo-webhook`, and with
      it E1/E2/E3 end to end (§2.4).
- [ ] **Mapbox token** — the Venues map draws its own tiles today (ADR-0005), so this is
      only needed for forward/reverse geocoding.
- [ ] **`supabase_admin`, or Supabase exposing it** — blocks closing the
      `spatial_ref_sys` write hole for real (ADR-0010). Recorded as a known gap in the
      pgTAP suite rather than hidden; see the ADR for why it is survivable today and the
      one change that would stop it being so.
- [ ] **Vercel plan** — the free tier's 100 deployments/day was exhausted on 21.09 by
      parallel sessions, so preview deployments failed for the rest of the day
      (`api-deployments-free-per-day`). Does not block CI or merging, only previews.

## O4 · How an Edge Function imports workspace code — RESOLVED, no action needed

The one decision blocking `notify-drain` that is not a credential. Deno needs `.ts`
extensions; every internal import in `packages/*` is extensionless, and `tsc` rejects
adding them without `allowImportingTsExtensions`, which is a change to the shared base
config and to how three Next apps resolve modules.

ADR-0006 sets out four options and recommends trying the flag as its own pull request,
because the cheap alternative — vendoring a Deno copy of the §8 send rules — puts a
second implementation in the tree with no Deno in CI to catch the drift, which is the
exact failure `pay.vectors.json` exists to prevent elsewhere in this repo.

**Resolved the same day.** The experiment was run rather than left for you: the flag is
set in `tsconfig.base.json`, and typecheck (12/12 workspaces), the build of all three Next
apps, the tests and lint all pass. One source tree now serves both runtimes and there is
no second copy of the §8 rules to drift. ADR-0006 is Accepted with the numbers.

Left here rather than deleted because one thing in it is still unproven and belongs on
your radar: whether Supabase's bundler follows a relative import reaching out of
`supabase/functions/` into `packages/`. That cannot be tested without a Supabase project,
so it will be answered the first time `supabase functions deploy` runs. If it says no, the
fallback is publishing the package for an `npm:` specifier, not vendoring a second copy —
and the flag that landed makes that cheap too.

## O5 · The Edge Functions are the one thing here no tool has checked

`supabase/functions/` now exists — `booking-tick` and the `_shared/job.ts` wrapper the
other §7 jobs will reuse. Their *rules* are in SQL and covered by pgTAP
(`170_booking_tick.sql`, 24 assertions), which is deliberate and is why the functions
themselves are thin.

But the TypeScript in them is checked by nothing in this repo. `eslint.config` ignores
`supabase/**`, there is no Deno in the build environment, and `tsc` only covers the pnpm
workspaces. So the SQL is proven and the twenty-odd lines of Deno around it are read but
not run.

Two things would close it, neither urgent and both cheap, listed so the gap is a decision
rather than an oversight:

1. `deno check supabase/functions/**/*.ts` as a CI step, which needs the Deno runtime in
   the workflow — a few lines of `denoland/setup-deno`.
2. `supabase functions serve` in CI against the local stack, which would also settle the
   open question in ADR-0006 about whether the bundler follows imports into `packages/`.

The first is worth doing the moment a second Edge Function lands. The second is worth
doing before anything depends on a job actually running.

## O6 · The jobs layer depends on a Supabase default it did not set

`20260921141500_auto_assign.sql` revokes `release_unready_bookings`,
`invite_worker` and others from `PUBLIC` and re-grants only to `authenticated`.
Nothing grants them to `service_role` — which is what every §7 job holds.

That almost certainly still works, because Supabase's bootstrap sets default
privileges granting EXECUTE on new functions in `public` to `service_role`. But
"almost certainly" is doing real work in that sentence, and if it is ever wrong the
symptom is every auto-staffing run 500ing once a minute in production, with nothing
in the repo to explain why.

So `20260921162107_enable_auto_staffing.sql` states the grants explicitly rather than
inheriting them, and `190_job_function_grants.sql` asserts in CI that the service role
can execute every function the jobs call — and that `anon` can execute none of them.
`invite_worker` alone can book a worker onto a shift, so an open one is not a bug in a
job; it is a way for anyone holding the anon key to staff an event.

Nothing to do here. Recorded because the next person to revoke something from `PUBLIC`
should know that test exists and why.

## O7 · Every function in `public` is anon-callable unless something revoked it from anon

Found by `190_job_function_grants.sql` on its first CI run, and fixed for the six it
covers — but the shape of it is repo-wide and worth a pass of its own.

Supabase's bootstrap sets default privileges granting EXECUTE on new functions in
`public` to `anon`, `authenticated` **and** `service_role`, individually. A
`revoke execute ... from public` therefore reads as a lockdown and changes nothing for
those three: `public` is the implicit grant, not the named ones.

`20260921141500` revoked six functions from `PUBLIC` and believed them closed. They were
not. `anon` could call `invite_worker` — and its own guard does not help, because that
guard exists to let the *service role* through by testing `auth.uid() is not null`, and
anon has no `auth.uid()` either. So anon passed it and could book a worker onto a shift.
`release_unready_bookings` was reachable the same way: a way to cancel every confirmed
booking for tomorrow and tell each worker they had been dropped.

`20260921162758_revoke_engine_from_anon.sql` closes those six and `190` now asserts it in
both directions, so this particular set cannot regress.

**What is not done:** the same audit for every other function in `public`. There are
around fifty, and each needs a decision rather than a sweep — `attempt_check_in`,
`start_break`, `submit_application` and the rest are *meant* to be reachable by a
signed-in worker or an anonymous applicant, so a blanket revoke would break the product.
The right shape is an allowlist assertion — "these are the functions anon may execute,
and this is why each one is on the list" — which is a security pass with an owner, not a
side-quest inside a jobs pull request.

Two things make it urgent enough to name: the rule is invisible (a revoke that looks
right does nothing), and it is easy to repeat (every new `security definer` function in
`public` starts life anon-callable).

**It has now repeated, which is the argument for the allowlist rather than against it.**
§10.4's nine Staff App RPCs (`20260922140000`) shipped with `revoke execute ... from
public` and nothing else, and CI found all nine open to `anon`:

```
# Failed test 46: "anon can execute none of the Staff App RPCs"
#     (radar_wave1_exhausted) (staff_caller) (staff_bookings) (staff_open_shifts)
#     (decline_invite) (apply_to_shift) (withdraw_application) (confirm_on_day)
#     (reconfirm_booking)
```

The session that wrote them had read `20260921162758`'s header, which explains this trap
in full, and wrote the bug anyway. That is what an invisible rule does. Worth noting how
close it came to shipping: `staff_caller` returns null without an `auth.uid()`, so seven
of the nine find nothing for an anonymous caller and would have looked fine in any manual
test — `radar_wave1_exhausted` was the one that actually leaked, and `apply_to_shift`
stopped at a not-null constraint rather than an authorisation check.

The assertion that caught it was written in the same change, which is the only reason it
did not merge. **Nothing catches this by default.** An allowlist assertion in
`001_rls_guard.sql` — every function in `public`, each either on the list with a reason
or closed to anon — would catch the next one without the author having to remember, and
that is the whole point.

One more thing for whoever takes it: a local Postgres does NOT reproduce this. Plain
Postgres has no such default privilege, so `revoke ... from public` really does close
everything and a local suite passes.

**What a faithful local harness needs**, learned by getting each one wrong in turn and
watching CI disagree. Without all four it is *more permissive or more secure than
production in ways that invert a diagnosis*:

```sql
-- 1. Functions: why `revoke ... from public` alone leaves anon holding EXECUTE.
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;
-- 2. Tables: why a write is stopped by RLS and NOT by a missing GRANT.
alter default privileges in schema public
  grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
-- 3. auth.uid() must guard the empty string BEFORE casting, as Supabase's does,
--    or an RLS refusal surfaces as 22P02 instead of 42501.
select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
-- 4. PostGIS in `public`, not `extensions` — 20260921123503 names
--    `public.spatial_ref_sys` directly.
```

With 1 and 3 missing the suite ran 837 assertions over 33 files and looked healthy; with
all four it runs **1203**, because the RLS suites (`010`–`040`) were silently doing
nothing. The only remaining failure is `002`'s KNOWN GAP assertion, which asserts the
`spatial_ref_sys` hole EXISTS and therefore inverts wherever the migration role owns
PostGIS (ADR-0010).

## O14 · Three office pushes were silently never sent — RESOLVED, and the shape is worth keeping

Found by auditing `main` after the §10.4 merge, not by anything failing. N10b (the office withdraws a
booking) and N12 (the office cancels an event) are **mandatory** in §8; N11 (the office
moves a shift's time) is required by §3.5 without being marked unmutable. All three were
queued by a server action doing

```ts
await supabase.from('notification_outbox').insert({ ... })
```

as the signed-in manager. That can never work. `notification_outbox` carries exactly one
policy — `admin_read`, SELECT only — so the insert finds no INSERT policy and RLS rejects
it. Reproduced as the real role:

```
BEFORE  insert into notification_outbox ...   ERROR: new row violates row-level
                                                     security policy
AFTER   select queue_office_notifications(...)  queued = 1
```

**A correction worth keeping, because it is the same lesson twice.** The first diagnosis
said `authenticated` held *no table privilege*, so the write was refused before RLS was
consulted. That was true of the local harness and false of Supabase, which grants the
Data API roles privileges on everything in `public` by default. CI caught it by failing
three `has_table_privilege` assertions that passed locally. The defect and the fix were
unchanged; the *mechanism* was wrong, and a wrong mechanism in a header is what the next
person reasons from. The assertions are now behavioural — they attempt the insert under
`role authenticated` and expect the RLS rejection — which is both correct and stronger.

Nothing caught it because nothing looked. The server action does not check the result of
the insert, so the manager sees "Event cancelled" and every worker on it is told nothing.
It is the worst kind of defect: the screen is honest about what it did and wrong about
what happened.

Fixed by `20260922170000_office_notification_queue.sql` —
`queue_office_notifications(jsonb)`, `security definer`, admin-checked, taking rows that
are already rendered so §8's copy stays in `packages/notifications` where CLAUDE.md
requires it. `001_rls_guard` assertion 8 is untouched and `310` re-asserts it: the fix is
a door, not a hole in the wall.

**Three things worth carrying forward.**

1. **A test that runs as the owner proves nothing about grants.** The first version of
   `310` set the JWT but not the role, so it exercised the admin check and would have
   passed with the grant missing entirely. pgTAP runs as the table owner, which bypasses
   RLS and holds every privilege. Any assertion about what a *caller* can reach needs
   `set local role authenticated`. This is the same lesson as O7's, in a second costume.
2. **The guard is a grep, and it is in the suite.**
   `packages/notifications/src/__tests__/write-path.test.ts` fails if any file under
   `apps/*/app/**` chains an insert, update, upsert or delete onto
   `from('notification_outbox')` — or `audit_log` or `report_sends`, which are owned by
   definer RPCs for the same reason. It was verified by reintroducing the bug and
   watching it fail. A runtime failure this invisible needs a compile-time-ish guard.
3. **The payload contract is the opposite of what it looks like.** The drain renders §8's
   copy itself — `render(entry.title, values)` in `outbox.ts` — so `payload` is the
   VALUES map and any `title` or `body` a row carries is ignored. The first fix restored
   the three sends and made them gibberish: `messageFor()` over the exact rows returned
   `"Shift time changed — now {window}"` with the url `/shifts/{bookingId}`. Caught in
   review, before merge, and now pinned by vectors in
   `packages/notifications/src/__tests__/outbox.test.ts` that assert no brace survives.
   `queue_booking_push` had this right from the start; the office simply did not follow it.

4. **Look for the same shape elsewhere.** The question "does this server action write a
   table the caller's role cannot write?" has not been asked of every screen. The three
   tables above are covered by `scripts/check-write-paths.mjs`; the audit that would cover
   the rest is the same one O7 asks for, from the other direction.

5. **The concrete next target for lesson 1** is `supabase/tests/300_staff_app_screens.sql`.
   It sets `request.jwt.claims` in five places and never `set local role`, so §10.4's
   assertions run as the table owner. Its grant assertions are catalog queries
   (`has_function_privilege`), which are role-independent and therefore still sound — but
   the behavioural ones prove logic, not reachability. Worth a pass.

6. **`updateEvent` redirects**, so an N11 queue failure has no result to ride back on and
   the manager cannot be told inline; it is logged with `console.error` instead. Giving
   that path a way to surface a warning is UI work nobody has done.

## O12 · CI resolves `supabase/setup-cli` as `latest`, and it is neither reproducible nor reliable

Both uses of it in `.github/workflows/ci.yml` — the `build-test` job's and the
`deploy-database` job's — pin the action and not the tool:

```yaml
- uses: supabase/setup-cli@v1
  with: { version: latest }
```

Two problems, one of which has already cost a build.

**It is rate-limited.** `latest` makes the action resolve the newest release through an
unauthenticated GitHub API call, limited per runner IP and shared by everything running
at once. On #35 it failed with `Failed to resolve latest Supabase CLI release: rate limit
exceeded` — after all 29 turbo tasks had passed, and before `supabase start`, so the
whole database and browser half of the suite simply did not run. It reads as a red PR
and is a download that did not happen.

**It is not reproducible.** The CLI that builds the test database can change under every
branch the moment Supabase ships a release, with no commit anywhere to explain it. A
green suite yesterday and a red one today with an identical tree is a day nobody gets
back.

Not fixed in #35 deliberately: the fix is to pin a version, and that session could not
reach `supabase/cli` from its environment to read a real tag. Pinning to a guessed one
breaks every branch rather than fixing one. Whoever takes it should choose the version
deliberately, change both uses together, and note it here.

**Raised in priority since that was written.** There is now one workflow rather than two,
but the second use is the `deploy-database` job, so `latest` no longer only decides how a
branch is tested — it decides which build of the CLI writes to the live database, and it
can change between two merges with no commit to explain it. The rate-limit flake that took
down a build is now a flake on the production deploy path.

**Third occurrence, #39 at 15:53 on 22.09**, and the pattern is now clear enough to state:
it is not rare. Same signature, same place — all 29 turbo tasks green, then

```
##[error]Failed to resolve latest Supabase CLI release: rate limit exceeded
```

before `supabase start`, so the database and browser halves of the suite did not run and
the pull request read red for a reason that had nothing to do with its diff. That is three
builds lost to it in one day (#32, #35, #39), which is the argument for pinning rather than
for retrying.

Worth knowing for whoever picks it up: `rerun-failed-jobs` returns **403 Resource not
accessible by integration** for an agent session, so the usual answer to a flake is not
available here. The only way past it from a session is another commit, which means the
cost of the flake is a full CI cycle every time.

Still not fixed here, for the reason the paragraph above gives: choosing the tag needs
`supabase/cli`, which is outside this session's repository scope, and this is the version
of the CLI that writes to the live database. Guessing it is worse than leaving it. It
wants a session that can read a real tag, changes both uses together, and records the
choice here.

## O8 · ~~The PR review bot~~ — CLOSED: the workflow is deleted

**Closed 23.09.2026 by the owner's decision: the `claude` GitHub Action will not be used.**
`.github/workflows/claude.yml` is deleted rather than left red, so neither fault below can
recur and no repository secret is owed for it.

For the record, since both were real and both cost money:

1. **No API key.** From roughly 17:09 on 21.09 the check failed after twelve seconds, in
   environment validation, before reading a line of any diff — the step's own environment
   dump showed `ANTHROPIC_API_KEY:` with nothing after it. It had worked earlier the same
   day (a run at 16:29 took 9m 40s and billed $3.44), and whether the secret was removed
   or the account behind it ran out was never visible from the log. It failed identically
   on every PR from then until deletion.
2. **The review was thrown away after it succeeded.** Before the key went, the check was
   failing on `--max-turns 60` with `"subtype": "success", "is_error": false,
   "num_turns": 61` — the reviewer finished, the action discarded the result and failed the
   check, and nothing was posted. That run also logged `permission_denials_count: 17`:
   seventeen refused tool calls, each costing a turn that did no work.

Neither needs deciding now. If the action is ever reinstated, both are waiting for it, and
pre-approving the read-only tools a reviewer needs (`Read`, `Grep`, `Glob`, `git diff`,
`git log`) is the cheaper of the two fixes to try first.

**Review has not gone anywhere.** CLAUDE.md asks for `qa-reviewer` before opening a PR and
that is where it runs — in-session, against the working tree. On PR #24 that found four
blockers the CI bot never got to; on PR #41 it found two, one of which (the Back Office
having no sign-out at all below 760px) would have shipped. `build-test` remains the check
that gates a merge, and is unaffected.

## O9 · Prettier is run by hand, so `main` carries unformatted files

`pnpm format` on a clean checkout of `main` today rewrites four files nobody touched in
this branch:

```
apps/client/app/client/EventsScreen.tsx
apps/client/app/client/__tests__/rules.test.ts
apps/client/app/client/events/[id]/EventScreen.tsx
e2e/tests/client.portal.spec.ts
```

They are not broken — prettier is a formatter, not a linter — but `.github/workflows/ci.yml`
runs `lint`, `typecheck`, `test`, pgTAP and Playwright, and **nothing runs
`prettier --check`**. So formatting drifts silently, and the next person who runs
`pnpm format` before committing sweeps up four files from someone else's pull request
along with their own. I reverted them here rather than widen this branch past its domain.

The fix is one line in `ci.yml` and a `format:check` script, and it wants doing in a pass
of its own: the first run will fail until the existing drift is committed, which is a
diff touching other people's files and should be its own pull request with nothing else
in it.

Not done here, because a formatting sweep across the repository collides with every
branch currently open (see O2).

---

## O10 · Nobody can be manually blocked yet, and nothing sends a push

Two things this branch built stop one step short of being usable, both waiting on work
that is not mine to do here:

1. **`block_worker()` is service-role only.** §9.6's manual block is a button on the
   staff profile, and the function that button needs now exists with the whole §4.3
   cascade in it. It is not granted to `authenticated`, because the screen does not exist
   and a grant with no caller is an open door. Whoever builds §9.6 grants it and adds the
   admin check inside, the way `invite_worker` does.
2. **N1–N4 and N14 reach `notification_outbox` and stop there.** The drain
   (`notify-drain`) is still disabled and has no Edge Function, because Web Push needs
   VAPID keys and email needs Resend — both are in O3, both are yours. Until then the
   expiry ladder is a table of rows nobody receives, and a worker blocked on the expiry
   day finds out by opening the app.

3. **Nothing sets `staff.graduated_at`, so §4.5 cannot happen yet.** The compliance sweep
   reads it — a graduate is excluded from the term-letter ladder, and `weekly_cap_for()`
   puts them on the permanent 48 h band — but no code anywhere writes it, and nothing
   copies a verified letter's `term_dates` onto the worker either. Both are the *verify*
   action in Compliance → Needs review (§4.1) and on the profile (§9.6), neither of which
   is built. Until one of them writes those two columns, §4.5's graduation band change
   cannot occur and the N14 it promises cannot fire. The rules are in place and will act
   the morning after that write lands.

4. **`block_worker()` now HAS its manual caller** — `block_worker_manually()` (§9.6),
   along with `unblock_worker()` and `reset_to_candidate()`. All three are service-role
   only, which is right for Back Office actions reached through a server action, so this
   half of O10 is closed. What is still missing is the screen (B8).

5. ~~**`request_p45()` and `declare_conviction()` are service-role only too, and for a
   sharper reason.**~~ **Closed.** Both take a staff id and neither checks that it is the
   *caller's*, so granting either to `authenticated` as they stood would have let any
   signed-in worker retire a colleague or suspend them on a fabricated declaration. This
   entry said whoever built S4 and S6 must either keep the server-action shape or add the
   self-check and the grant in the same commit — **never the grant alone**.

   They took the third option, which is better than either: a **self-scoped wrapper that
   takes no staff id at all**, so there is no argument to point at somebody else.
   `request_my_p45(text)` (`20260922180000`) and `declare_my_conviction(text, date)`
   (`20260923150000`) are what `authenticated` holds. The two-argument originals are
   **still granted to `service_role` only**, and `190_job_function_grants.sql` names both
   in the list it asserts stays out of the PostgREST roles — so the grant this entry
   warned about cannot be added later by accident without turning a test red.

   Verified 23.09 by reading the grants in the migrations and the assertion in `190`,
   not by taking the handover's word for it.

Points 4 and 5 are now closed; 1, 2 and 3 were superseded by later waves — the §9.6
screen, the drain and the verify action all exist, so what remains of this entry is the
record of why the grants were withheld, which is still the reason not to widen them.

None of these blocks the other work. They are recorded so that "compliance is built" is
not read as "workers are being told", and so that the missing grants read as deliberate
rather than forgotten.

---

## O11 · GDPR removal now reaches everything but the Willo video — RESOLVED

`remove_worker()` (§1.7) anonymises the profile, deletes the documents, bank details,
referees, HMRC checklist and push subscriptions, and releases future bookings. Three
places held personal data it did not reach. All three are closed
(`20260922081512_gdpr_removal_reaches_the_rest.sql`), with one residue that genuinely
waits on a key.

**1. The files themselves — closed.** Deleting a `compliance_docs` row never touched the
object it pointed at, so the passport scan in `documents` and the selfie in `photos`
outlived the erasure. SQL cannot call the Storage API, so removal now **queues** every
path into `storage_deletions` — read before the rows that name them are deleted, because a
path nothing captures is a file nothing can ever find again — and a new `gdpr-purge` Edge
Function drains the queue.

A queue rather than an inline call on purpose: §1.7 is an obligation, not a best effort. A
row stays until the object is actually gone, so an erasure survives Storage being briefly
unreachable instead of being silently dropped. **No new key** — the service role key every
§7 job already carries is what the Storage API wants.

**2. `applications` — closed, and the question I asked was the wrong one.** I recorded this
as needing your decision because anonymising the rows might break the §2.12 duplicate
check. It does not: that check reads `staff`, not `applications`, and already excludes a
removed worker outright (`where s.removed_at is null`). And §2.12 settles the policy
anyway — *"A GDPR-removed worker (§1.7) is the one exception: their personal data is gone
and cannot be matched against, so they apply as a genuinely new candidate and receive a new
Employee ID."* So the rows are anonymised in place, per submission; the outcome is kept,
because that is what the office did rather than who they did it to.

**3. `willo_candidate_id` — nulled, with the video still to delete.** The handle on the
interview video is gone from the profile. Deleting the video *at Willo* is an API call that
waits on P3's account (O3). So the id is written into the `gdpr_remove` audit row before it
is nulled — nulling it alone would strand the video for ever with nothing able to name it.

> **The one thing left for you here:** when the Willo account lands, the videos of anyone
> removed in the meantime need deleting. `select data->>'willoCandidateId' from audit_log
> where action = 'gdpr_remove'` lists exactly which.

**Still outside this:** `notification_outbox` payloads keep the name (and E8's keeps the NI
number) until the row is drained and pruned, and `location_pings` keep the GPS trace of
shifts worked. Both are arguably operational records rather than profile data, and §1.7
does not mention either way — raised here rather than decided.

## O13 · The repository's default branch was not `main` — **RESOLVED 22.09**

**Done by the owner.** `GET /repos/saveezirfan0-cloud/thc-portal` now returns
`"default_branch": "main"`, and `actions/workflows` resolves both workflow files at
`blob/main/` rather than at the old branch. Kept here because the cost below is what
makes the two clicks worth understanding, and because the trap catches the next
trigger-based workflow, not just this one.

The default branch had been `claude/youthful-meitner-hs0o7d` — an agent branch from the
first afternoon of the build, which happened to be what the repository was created from and
was never changed. Everything since has merged into `main`, so nothing looked wrong.

### What it cost

The database deploy. `deploy.yml` was added on 22.09 to run `supabase db push` after `ci`
succeeded on `main`, triggered by `workflow_run`. **It never ran once, and never could.**
GitHub registers `workflow_run`, `schedule`, `workflow_dispatch` and `repository_dispatch`
triggers only from the copy of the file on the *default* branch. `deploy.yml` was on `main`, so as far as GitHub
was concerned the workflow did not exist — `actions/workflows` listed two workflows, `ci`
and `claude`, and no third. Meanwhile `ci` concluded **success on `main` five times**
between that merge and this one, every one of which should have deployed.

The failure mode is the bad kind: not an error, not a red X, not a skipped job with a
notice. No run, no record, nothing to notice. The live project quietly went from seventeen
migrations behind to twenty-six while a file sat in the repository claiming to prevent
exactly that.

The deploy is now the `deploy-database` job inside `ci.yml`, gated on `needs: build-test`.
`push` triggers run the workflow file from the pushed commit on whatever branch it was
pushed to, so it fires regardless of this setting, and `deploy.yml` is deleted rather than
left as a decoy. **That fix stands on its own — changing the default branch is not required
to make the database deploy.**

### What the fix restored

All five are live again now that the setting is `main`:

- Anything trigger-based added later no longer walks into the trap. `schedule` was the one
  to watch: the jobs layer (§8, `pg_cron`) has a plausible future need for a nightly
  workflow, and it would have been just as silently inert.
- A new pull request defaults its base to `claude/youthful-meitner-hs0o7d`, so a session
  that does not set the base explicitly proposes a merge into a dead branch.
- Branch protection is configured per branch. docs/12 asks you to require `ci` on `main`;
  GitHub's own "protect the default branch" affordances all point somewhere else.
- A fresh `git clone` checks out that branch, which is a day-one confusion for whoever
  takes this over.
- GitHub renders the repository — README, the file listing, the language bar — from the
  default branch, so the front page is a snapshot of 21.09.

No code change was waiting on it. It was a setting, and it is now `main`.

**The catch-up has happened.** The first `deploy-database` job ran on `1c78fc8` at
15:34 on 22.09 and applied all 26 pending migrations in one push, from
`20260921153000_checkin_write_paths` through `20260922160000_accept_invite_event_ended`,
ending `Finished supabase db push.` The live project is current for the first time since
21.09, and the twenty-six-migration gap this question was opened over is closed.

Read the job's log rather than the badge on any future run: `db push` applies migrations
one at a time, so a failure halfway leaves the project part-applied with a green
`build-test` above it, and the log is the only place that says which version it stopped
at.

## O16 · A worker could read the manager's reason for blocking them — **RESOLVED 23.09**

`0001_init.sql:482` grants a worker their own row and every column on it:

```sql
create policy staff_self on staff for select using (user_id = auth.uid());
```

So `GET /rest/v1/staff?select=block_reason` returned the internal note a manager typed
about that worker. §10.1 is explicit: "the manager's reason for the block is internal and
is never shown to the worker." The application never fetched it — `staff_me()` does not
select it and says so — but the API did, so the rule was held by discipline rather than by
structure.

**RLS could not fix it.** Policies filter rows, never columns. And the obvious privilege
fix breaks the office: admins and workers are the same Postgres role, and both
`staff_directory_v` and `staff_profile_v` are `security_invoker`, so a blanket
`revoke select (block_reason) … from authenticated` would have closed §9.6's screens with
it.

`20260923090000_block_reason_is_internal.sql` applies ADR-0004 one column wide: the
table-wide SELECT is revoked and re-granted for every column **except** that one, and the
office reads it back through `staff_block_reason_v`, an owner-rights view carrying
`current_app_role() = 'admin'` in its own body. `staff_directory_v` keeps its column list,
order and `security_invoker` reloption — verified identical — so no office column list
moved.

**Two consequences worth knowing before you touch `staff`:**

- A column added to `staff` by a later migration is **not readable** by `anon` or
  `authenticated` until that migration grants it. That is deliberate — `staff` carries the
  date of birth, NI number, home address and right-to-work branch, so failing closed on a
  new column is correct, and the failure is a loud 42501 rather than a quiet leak. It will
  still surprise whoever hits it.
- An **admin** can no longer read `block_reason` off the table either, by design. The
  owner-rights view is the whole of the office's access to it.

The migration ends with a `do` block that raises if the revoke did not take or the re-grant
did not — a `revoke` that silently no-ops is how `20260921123503` was defeated by PostGIS's
grants, and that would have left this leak open under a green deploy.

## O15 · `BottomNav`'s `renderLink` callback crashed the Staff App twice — **RESOLVED 23.09**

**It was `design-system`'s, and it was a prop that should not have existed. It is gone.**

`BottomNav` lives in `packages/ui/src/components/Mobile.tsx` under a file-level
`'use client'`, and it takes

```ts
renderLink?: (item: BottomNavItem, className: string, children: ReactNode) => ReactNode;
```

A server component cannot pass it. React refuses to serialise a function across that
boundary, and the page answers **500** — not a warning, not a degraded render.

It has happened twice in one day, both times in code that shipped green:

- `StaffShell` (#35) took out `/shifts`, `/invites`, `/radar` and their three detail
  routes. CI missed it because `staff.working-screens.spec.ts` skipped on
  `.mcard, .empty` being absent, which is equally true of a 500 page.
- `ProfileShell` (#42) took out `/profile`, `/profile/details`, `/profile/security` and
  `/profile/payments` — the whole §10.1 profile sheet, Security settings, Bank &
  payroll, and the leaver's earnings history behind the P45 flow.

Both now render `apps/staff/app/_components/BottomTabs.tsx`, which takes the same
`{href, label, locked}` data and decides what a link is itself, so only strings cross the
boundary. Same markup, same classes, same "locked is a span, not a link" behaviour.

**Why it keeps happening**, and why the next one is a matter of time: the Back Office's
`Sidebar` takes an identical-looking `renderLink` and is completely safe, because
`packages/ui/src/components/Shell.tsx` carries no `'use client'`. The two look the same at
the call site and differ only in a directive at the top of a file nobody opens. A screen
bot copying the Office pattern into the Staff App writes a 500 and gets a green build.

**The prop is gone.** `BottomTabs` proved the data-driven shape covers every caller, and a
check of the remaining `BottomNav` callers — `/shifts/[id]`, the design-system showcase and
two `packages/ui` tests — found that none of them passed `renderLink`, so deleting it broke
nothing and no caller had to change. `packages/ui/src/components/Mobile.tsx` now carries the
reasoning where the next person will read it, including why the Office's `Sidebar` keeps an
identical-looking callback and is safe.

Note for whoever adds the next mobile component: the asymmetry is still there.
`Shell.tsx` has no `'use client'` and `Mobile.tsx` does, so a function prop is fine in one
and a 500 in the other, and nothing at the call site says which you are in. A lint rule
banning function props to anything exported from `Mobile.tsx` would make that structural
rather than remembered; it is not written.

