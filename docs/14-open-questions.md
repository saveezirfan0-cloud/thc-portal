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

Nothing here needs undoing; it is a process note. The cheapest guard is the one already
written at the top of `docs/13`: `git fetch origin && git branch -r` before naming a
migration, and prefer a timestamp with real minutes in it over a round number.

## O3 · The accounts the build is waiting on

Steps 2 and 3 of `docs/04` still need THC's own accounts, and `docs/12` lists the keys.
Nothing in Phases 1–5 is blocked on them yet; Phase 6 onwards is.
