# 10 · Working with several agents at once

`docs/05-domain-bots.md` says who the bots are and what each one owns. This file is the
operational companion: how to actually run several of them in parallel without them
standing on each other, and when not to bother.

## 1. The three places a bot runs

| Where                                            | How you start it                                | Good for                                                                                                                                                                         |
| ------------------------------------------------ | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Subagent inside one session**                  | "Use the `scheduling` agent to …"               | A slice of work you want done while you keep the thread. The subagent gets only the brief you write plus `.claude/agents/<bot>.md`; it reports back and you keep the conclusion. |
| **Its own session** (web or CLI, one per domain) | Open the repo, start on `feat/<domain>-<thing>` | A whole feature. This is the real parallelism: separate branches, separate working trees, separate PRs.                                                                          |
| **GitHub Action**                                | `@claude` on an issue/PR, or a `domain:*` label | Review on every PR, and small fixes from a comment thread. `.github/workflows/claude.yml` routes the label to the agent file; no label means `platform`.                         |

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
3. **Migrations are append-only.** Never edit a migration that exists; add
   `000N_<thing>.sql`. Two bots that both add a migration get sequential numbers, not a
   conflict — but they must both pull `main` before numbering.

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

Both PRs get the automatic `qa-reviewer` pass from `.github/workflows/claude.yml`. Merge
order does not matter, because the file sets are disjoint.

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
