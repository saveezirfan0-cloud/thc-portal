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

## O0 · An under-18 with an opt-out tick has NO weekly hours ceiling — live on `main`

Found while merging, not looked for, and it is the most serious thing in this file.

`090_weekly_cap.sql` assertion 2 is failing on `main` right now:

```
have: ("An under-18 cannot opt out, so a recorded tick does not lift the ceiling", , uncapped)
want: ("An under-18 cannot opt out, so a recorded tick does not lift the ceiling", 48, standard_48)
```

The vectors are right and the SQL is wrong. `weekly_cap()` honours `wtr_optout` without
checking age, so a worker under 18 whose record carries that tick comes back `uncapped` —
no weekly ceiling at all. Under-18s cannot sign the 48-hour Working Time opt-out; young
workers have a lower statutory limit, not a removable one. Auto-assign's hours gate reads
this function, so the effect is not cosmetic: nothing would stop a 16-year-old being
booked past any limit.

Assertion 7 fails with it, for the same reason — `remaining_hours` returns a row where it
should return none.

Not fixed here deliberately: this is the compliance domain and that session pushed the
cap change minutes before this was found, so it is very likely already in hand. It is
written down because the failing test is the only thing currently carrying it, and this
session has now watched a red `main` teach four pull requests to read past a failing
suite (O2). If it is still red by the next compliance session, it should be the first
thing that session does.

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

## O8 · The PR review bot — two faults, and the second one needs you today

### The one blocking it now: there is no API key

Since roughly 17:09 on 21.09 the `claude` check fails after **twelve seconds**, before it
reads a line of the diff:

```
##[error]Action failed with error: Environment variable validation failed:
  - Either ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, or workload identity federation
    (ANTHROPIC_FEDERATION_RULE_ID and ANTHROPIC_ORGANIZATION_ID) is required when using
    the direct Anthropic API.
```

and the step's own environment dump shows `ANTHROPIC_API_KEY:` with nothing after it.
`.github/workflows/claude.yml` passes `${{ secrets.ANTHROPIC_API_KEY }}`, so the
repository secret is empty, deleted, or not reaching the workflow.

It worked earlier the same day — a run at 16:29 took 9m 40s and billed $3.44 — so
something changed between the two. Whether the secret was removed or the account behind it
ran out is not visible from the log, and both look identical from here.

**This one is yours and nothing in the repo can substitute for it.** A bot cannot hold or
set a repository secret, and CLAUDE.md rightly forbids putting one in code. Set it at
Settings → Secrets and variables → Actions → `ANTHROPIC_API_KEY`.

Re-running the check is pointless until then, which is why I have not spent a re-run on
it. Note that `build-test` is the gate and is unaffected: the `claude` check is advisory,
so this does not block merging.

### The one underneath it: the review is thrown away after it succeeds

This is the fault that will come back the moment the key is restored, so it is recorded
rather than closed. Before the key went, the check was failing like this:

```
"subtype": "success", "is_error": false, "num_turns": 61
##[error]Claude reported a successful result after 61 turns, exceeding the configured
maximum of 60
```

`claude.yml` sets `--max-turns 60`. That run completed its review, cost $3.44, and the
action discarded the result and failed the check. Nothing was posted to the pull request.

Two things to weigh, and both cost money, which is why this is yours too:

1. **Raise the limit.** The obvious fix and the one with a recurring bill attached. These
   PRs are large — five or six commits across SQL, tests and docs — so the reviewer needs
   the turns. Roughly $3.50 a review at 60 turns; a higher ceiling raises the worst case,
   not the average, since a short PR still finishes early.
2. **Spend fewer turns.** The same run logged `permission_denials_count: 17`. Seventeen
   tool calls were refused, and every refusal costs a turn that did no work. Pre-approving
   the read-only tools a reviewer needs — `Read`, `Grep`, `Glob`, `git diff`, `git log` —
   would likely bring it under the existing limit for free. Cheaper than (1) and worth
   trying first.

Neither is changed here, because both are standing costs on every pull request in the repo
rather than a bug in one.

### Meanwhile

The review still happens — I run the `qa-reviewer` agent in-session before pushing, which
is what CLAUDE.md asks for anyway ("Ask `qa-reviewer` before opening a PR"). On PR #24 that
found four blockers the CI bot never got the chance to. So the gap is a missing second
opinion, not a missing review.

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

5. **`request_p45()` and `declare_conviction()` are service-role only too, and for a
   sharper reason.** Both take a staff id and neither checks that it is the *caller's* —
   they are written for a server action holding the service key, which is how the Staff
   App reaches every other write path. Granting either to `authenticated` as they stand
   would let any signed-in worker retire a colleague or suspend them on a fabricated
   declaration. Whoever builds S4 and S6 either keeps the server-action shape or adds the
   self-check and the grant in the same commit — never the grant alone.

None of these blocks the other work. They are recorded so that "compliance is built" is
not read as "workers are being told", and so that the missing grants read as deliberate
rather than forgotten.

---

## O11 · GDPR removal cannot reach everything §1.7 asks it to

`remove_worker()` (§1.7) anonymises the profile, deletes the documents, bank details,
referees, HMRC checklist and push subscriptions, and releases future bookings. Four places
hold personal data it does **not** reach, three of which need a decision from you.

**1. The files themselves.** The `compliance_docs` rows go; the objects they pointed at —
a passport scan in the `documents` bucket, a selfie in `photos` — do not. §1.7 says
"contacts / documents / photo wiped", and today the row is wiped while the file survives.
SQL cannot call the Storage API, so this needs either an Edge Function called after
removal, or a queue the drain picks up. **This is the one that matters most**: it is the
actual document, not a reference to it.

**2. `applications`.** The public form (§2.1) stores `first_name`, `last_name`, `email`,
`phone` and `age_band` per submission, keyed to the staff record. `remove_worker` never
touches it, so the worker's name and contact details survive an irreversible
anonymisation. Fixable in SQL; not done here because the application row is also the
duplicate-check §2.12 relies on for a returning applicant, and blanking it changes that
behaviour. **Ask:** should removal anonymise the application rows too, accepting that the
person can then re-apply as a genuinely new candidate — which is what §2.12 says happens
to a removed worker anyway?

**3. `staff.willo_candidate_id`.** A live identifier for the interview video held by a
third party. Nulling it is one line; deleting the video is a Willo API call we cannot make
until P3's account exists. Left as-is so the two go together rather than leaving an
orphaned video nobody can find.

**4. Lower risk, same decision.** `notification_outbox` payloads keep the name, and E8's
keeps the NI number, until the row is drained and pruned; `location_pings` keep the GPS
trace of shifts worked. Both are arguably operational records rather than profile data,
but they are personal data and they are not mentioned in §1.7 either way.

Recorded rather than guessed at, because each one trades a GDPR obligation against a
behaviour the scope defines elsewhere, and that is your call rather than a bot's.
