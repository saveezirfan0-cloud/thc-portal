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

---

# For the owner

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
