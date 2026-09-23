# 10 · Working with several agents at once

`docs/05-domain-bots.md` says who the bots are and what each one owns. This file is the
operational companion: how to actually run several of them in parallel without them
standing on each other, and when not to bother.

## 1. The three places a bot runs

| Where                                            | How you start it                                | Good for                                                                                                                                                                         |
| ------------------------------------------------ | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Subagent inside one session**                  | "Use the `scheduling` agent to …"               | A slice of work you want done while you keep the thread. The subagent gets only the brief you write plus `.claude/agents/<bot>.md`; it reports back and you keep the conclusion. |
| **Its own session** (web or CLI, one per domain) | Open the repo, start on `feat/<domain>-<thing>` | A whole feature. This is the real parallelism: separate branches, separate working trees, separate PRs.                                                                          |
| ~~**GitHub Action**~~                            | —                                               | **Removed 23.09.2026** (O8). `.github/workflows/claude.yml` is deleted, so `@claude` and the `domain:*` label do nothing on GitHub. Run the bots in-session instead.             |

The unit of parallelism is **a branch**, not a bot. Two bots in one branch will collide.
One bot in two branches is fine.

## 2. The collision map

Parallel work is safe exactly when the file sets are disjoint. This is the ownership map
by path, which is what actually determines a merge conflict:

| Path                                                                         | Owner                      | Notes                                                         |
| ---------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------- |
| `apps/office/app/(events\|checkin)/**`                                       | `scheduling`, `checkin`    | Split by route folder, not by file.                           |
| `apps/office/app/(onboarding\|compliance)/**`                                | `onboarding`, `compliance` |                                                               |
| `apps/office/app/(staff\|clients\|venues\|roles)/**`                         | `directory`                |                                                               |
| `apps/office/app/reports/**`                                                 | `reports`                  |                                                               |
| `apps/office/app/feedback/**`                                                | `client-portal`            | Feedback is one domain across two apps.                       |
| `apps/staff/app/(shifts\|invites\|radar)/**`                                 | `scheduling`               |                                                               |
| `apps/staff/app/(documents\|locks)/**`                                       | `compliance`               |                                                               |
| `apps/staff/app/onboarding/**`                                               | `onboarding`               |                                                               |
| `apps/staff/{middleware,manifest,sw}.ts`, `app/(login\|install\|profile)/**` | `staff-pwa`                | The shell, not the screens inside it.                         |
| `apps/client/**`                                                             | `client-portal`            |                                                               |
| `packages/ui/**`                                                             | `design-system`            | **Hot spot.** See §3.                                         |
| `packages/domain/**`                                                         | whoever owns the rule      | **Hot spot.** One file per rule family keeps this survivable. |
| `packages/db/**`, `supabase/migrations/**`                                   | `platform`                 | **Hot spot.** Migrations are append-only and numbered.        |
| `packages/notifications/**`                                                  | `notifications`            |                                                               |
| `packages/pdf/**`                                                            | `reports`                  |                                                               |
| `.github/**`, `turbo.json`, root configs                                     | `platform`                 |                                                               |

Three rules follow from the map:

1. **One domain per PR.** Already in `CLAUDE.md`; this is why.
2. **Shared-package changes go first, in their own PR.** If `scheduling` needs a new
   function in `packages/domain`, that is one small PR ("domain: add booked-elsewhere gap
   helper + vectors"), merged, and then the feature PR builds on it. Bundling them is what
   turns two parallel sessions into one serialised one.
3. **Migrations are append-only, and named by timestamp.** Never edit a migration that
   exists. Name a new one `YYYYMMDDHHMMSS_<thing>.sql`, from the clock, not the next
   number in the folder.

   Sequential numbering does not survive parallel sessions. It was tried here and failed
   inside a day: five branches claimed `0008` at once, `main` ended up with two files
   numbered `0006`, and two sessions produced byte-identical weekly-cap migrations
   because each renumbered rather than noticing the other. Every session that pulls
   `main` has to renumber, which changes its file, which makes the next session
   renumber. Timestamps end that: two sessions never generate the same one, so a
   migration is written once and never renamed. It is also what the Supabase CLI does
   natively.

## 3. The hot spots, and what to do about them

**`packages/ui`.** Every screen bot wants components. The protocol: a screen bot never
edits `packages/ui` directly. It either uses what exists, or it files the gap and
`design-system` adds it. In a single session that is literally "use the design-system
agent to add a `ScoreBar` component matching `event-board.html`, then continue". The
component lands, then the screen consumes it.

**`packages/domain`.** Rules are the thing most worth getting right, and the most tempting
to duplicate. One file per rule family (`pay.ts`, `cap.ts`, `scoring.ts`, `state.ts`) means
two bots usually touch different files. When a rule is shared between SQL and TypeScript —
the weekly cap is the standing example — the **vectors file is the contract**. Add the
vector first, in its own PR, and both implementations get held to it.

**`supabase/migrations`.** Append-only, and schema changes ripple. A bot needing a column
opens the migration PR alone, `platform` reviews it, it merges, and everyone regenerates
types with `pnpm --filter @thc/db gen:types`.

Before starting any migration — or any slice at all — check what is already in flight:

```
pnpm check:overlap                 every open PR and the files it touches
pnpm check:overlap -- --pr 47      just what one PR collides with
```

It reads `origin` for the repository. The repo is private, so a local run needs
`GITHUB_TOKEN` set to a token with `pull-requests: read`; CI passes its own and
needs nothing. Either way the check never fails a build — it only reports.

This used to say "`git fetch origin`, `git branch -r`, and look at what each branch
touches". That was right in intent and unusable in practice: branch names do not say
what a branch edits, half of them have no open PR, and nobody diffs fifteen of them by
hand. It failed five times in one day (see §3b). The command above answers the question
the old advice was asking.

Two sessions writing the same migration is the most expensive collision here, because
both are long and both look correct in isolation.

## 3b. The collision that has actually happened, five times

Not hypothetical. In one day, on 22.09.2026:

| Both sessions built | Cost |
|---|---|
| The RULE-20 cap SQL | One landed unverified; `main` red for hours |
| `accept_invite`'s weekly-cap gate | Near-miss: see below |
| The `spatial_ref_sys` assertions | A branch dropped its copy at merge |
| The `--radius` / `--accent` tokens | A branch dropped its copy at merge |
| The §9.8 penny-sweep timeout | PR #47 closed unmerged against `main`'s copy |

Four of the five were a **red-`main` pile-on**: `main` breaks, every concurrent session
sees the same red, and every one of them reaches for the same fix. Nobody is being
careless — a red `main` is an open invitation, and the sessions cannot see each other.

The `accept_invite` pair is the one worth remembering. #31 added the RULE-20 cap gate and
#35 added RULE-16, in parallel, to the same function. `20260922160000` happened to build
on `20260922153000`'s body rather than replace it. Written as a straight `create or
replace` — the obvious way — it would have **deleted a shipped rule with a green build**,
because at the time no test asserted the two gates together. Nothing in git, in review or
in CI would have said a word.

So: the guard is advisory, not blocking. Overlap is often legitimate, and a check that
cries wolf gets switched off. What was missing was never enforcement. It was knowing.

## 4. What can actually run in parallel

From `docs/02-build-plan.md`, the phases that genuinely overlap:

- **Phase 1 (`onboarding`) ‖ Phase 2 (`directory`)** — the build plan schedules these
  together on purpose. Different tables, different routes, different wireframes.
- **Phase 3 (`scheduling`) ‖ Phase 4 (`compliance`)** — overlapping weeks, but they meet at
  the hard gates in auto-assign: blocked workers and the weekly cap. Agree the interface
  first (`isBookable()`, `weeklyCap()`), land it in `packages/domain`, then run both.
- **Phase 6 `reports` ‖ `client-portal`** — one phase, two bots, almost no shared files.
- **`design-system` alongside anything** — it is upstream of everyone, so it works best
  running slightly ahead.
- **`notifications` alongside anything** — the register is data; the bots that trigger a
  send only need the code, e.g. `N6b`.

What does not parallelise: anything sharing a state machine. `checkin` and `scheduling`
both write `bookings`, so the booking transitions belong to one of them at a time.

## 5. Recipe: running two domains at once

```
Session A                                   Session B
─────────────────────────────────────       ─────────────────────────────────────
git switch -c feat/onboarding-apply         git switch -c feat/directory-venues
"Use the onboarding agent to build          "Use the directory agent to build
 /apply per §2.1 and public/apply.html"      /venues per §9.11 and venues.html"
 ↓                                           ↓
pnpm lint typecheck test                    pnpm lint typecheck test
"Have qa-reviewer review this diff          "Have qa-reviewer review this diff
 against §2.1 and the wireframe"             against §9.11 and the wireframe"
 ↓                                           ↓
PR, domain:onboarding label                 PR, domain:directory label
```

Run `qa-reviewer` in-session on each before opening its PR — there is no automatic pass on
GitHub any more (O8). Merge order does not matter, because the file sets are disjoint.

## 6. Briefing a bot well

The brief is the only context a subagent has. What makes the difference, in order:

1. **The scope section number.** Not "build check-in" but "§5.1, and grep
   `docs/scope/scope-of-work-v1.6.txt` for `9.5 Check In`". The scope is the contract.
2. **The wireframe path.** A screen is done when it matches its wireframe. Name the file.
3. **What you have already ruled out.** Saves the agent from re-deriving your dead ends.
4. **The paths it may touch, and the ones it may not.** This is what keeps parallel safe.
5. **How you will judge it.** "pgTAP for three roles", "vectors in `cap.vectors.json`
   pass in both SQL and TS", "no hard-coded colour".

Ask for a plan before code on anything non-trivial. A wrong plan costs a paragraph; wrong
code costs a branch.

## 7. The review gate

`qa-reviewer` is read-only by design, and it is the one bot you should run on everything.
Two moments:

- **Before you open the PR** — cheap, and it catches scope drift while the context is hot.
- **On the PR** — automatic, and it is what a human reviewer reads first.

It reports drift as a checklist with § references. Findings it raises against the scope
are not style opinions; the scope wins over everything except the two deliberate changes
recorded in `CLAUDE.md`.

## 8. When not to use a second agent

A second agent costs a brief, a handoff and a summary, and you cannot see what it did.
Do the work yourself when it is one file, when you already know the answer, or when the
task is mostly a judgement call you would have to re-make anyway. Reach for another agent
when the work is genuinely separable, when it would otherwise block your main thread, or
when you want a review that is not anchored on your own conclusion.
