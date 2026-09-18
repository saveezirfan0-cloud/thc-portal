# 05 · Domain bots — one Claude agent per domain

"Bot" here means a Claude Code **subagent** with a fixed brief, file ownership and checklist, plus the GitHub automation that invokes the same brief on issues and PRs. The briefs live in `.claude/agents/*.md` (this repo) so they version with the code. The reusable know-how they all share lives in `.claude/skills/`.

## The roster

| Bot | Owns (paths) | Scope sections | Wireframes it must match |
|---|---|---|---|
| `platform` | monorepo, `packages/db`, `supabase/migrations`, auth, RLS, CI, deploys, jobs framework | §1.3–1.8, §7 (job plumbing), §9.12 | `backoffice/login.html`, `client/login.html`, `staff/auth.html` |
| `design-system` | `packages/ui`, tokens, Storybook, accessibility, responsive | §1.6, §10.1 | `wireframes/design-system.html`, `assets/thc.css` |
| `onboarding` | `/apply`, Willo, kanban, candidate profile, wizard 11/11, AI extraction, quiz, HMRC, contract, Employee ID | §2.1–2.12, §10.3, App. A | `backoffice/onboarding.html`, `candidate.html`, `staff/onboarding-*.html`, `public/*` |
| `directory` | Roles, Clients, Venues, Staff directory + profile, client qualification | §9.6–9.8, §9.11, §4.5 (student view) | `backoffice/staff*.html`, `clients.html`, `client-card.html`, `roles.html`, `venues.html` |
| `scheduling` | Shift Builder, events views, event board, auto-assign engine, bookings, invites, radar | §3.1–3.6, §6, §10.4 (Shifts/Invites/Radar) | `backoffice/events.html`, `shift-builder.html`, `event-board.html`, `staff/shifts.html`, `invites.html`, `radar.html` |
| `compliance` | review queue, radar, expiry ladders, auto-block, RULE-20 cap, completion letter, block/unblock, reset, conviction declaration | §4.1–4.5, §9.6 (block), §10.7, RULE-20/21 | `backoffice/compliance.html`, `staff/documents.html`, `staff/locks.html` |
| `checkin` | check-in/out RPCs, breaks, violations, pay maths, monitor, geofence (+ Capacitor shell) | §5.1–5.2b, §9.5, BG-01..03/06/07/09/10 | `backoffice/checkin.html`, `staff/shift-detail.html` |
| `notifications` | outbox, Web Push, email templates, the §8 register, senders | §8, §9.12 | push galleries inside `staff/*.html` |
| `reports` | Financial/Payroll/New Starter, CSV, BG-08, PDFs (allocation/sign-out), send/download | §9.9, §11.3–11.4 | `backoffice/reports.html`, `client/timesheet.html` |
| `client-portal` | `apps/client`, feedback | §11.1–11.5, §9.10 | `client/*.html`, `backoffice/feedback.html` |
| `staff-pwa` | `apps/staff` shell: PWA manifest, service worker, offline, push subscription, camera, geolocation, app-lock routing, profile sheet, P45 | §10.1–10.2, §10.5–10.6 | `staff/profile.html`, `staff/locks.html`, `staff/auth.html` |
| `qa-reviewer` | read-only: reviews every PR against the scope and wireframes, runs tests, reports drift | all | all |

## How to run a bot in Claude Code

Subagents are picked up automatically from `.claude/agents/`. In a session:

```
> Use the scheduling agent to implement the 12:05 cutoff job (§3.5, N6b) with tests.
> Have qa-reviewer review the diff on this branch against §9.5 and the checkin wireframe.
```
or explicitly: `/agents` to list them. Each agent brief tells it which spec sections to read first, which wireframe is its acceptance reference, which files it may touch, and the definition of done. Because the brief is the only context the agent has, the briefs are deliberately long.

### Session recipe (per feature)
1. Start on a fresh branch: `feat/<domain>-<thing>`.
2. Ask the domain bot for a plan first (`EnterPlanMode` or "plan only"), check it against the scope section, then let it build.
3. Ask `qa-reviewer` for a review before opening the PR. It reports drift from the scope as a checklist with § references.
4. Open the PR; the GitHub action runs the same review; address findings; merge.

### Parallel work
Different bots own different paths, so several sessions can run at once (Claude Code on the web: one session per domain, each on its own branch). Shared packages (`packages/domain`, `packages/ui`, `supabase/migrations`) are the merge hot-spots: the convention is that a bot needing a change there opens a small separate PR first ("domain: add cap vectors for split week") rather than bundling it.

## GitHub automation (the same bots, invoked from GitHub)

`.github/workflows/claude.yml` (sketch):
```yaml
name: claude
on:
  issue_comment: { types: [created] }
  pull_request_review_comment: { types: [created] }
  pull_request: { types: [opened, synchronize] }
jobs:
  claude:
    if: contains(github.event.comment.body, '@claude') || github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    permissions: { contents: write, pull-requests: write, issues: write, id-token: write }
    steps:
      - uses: actions/checkout@v4
      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          # On PRs: run the qa-reviewer brief. On @claude comments: the label decides the domain bot.
          prompt: |
            ${{ github.event_name == 'pull_request' && 'Run the qa-reviewer agent brief from .claude/agents/qa-reviewer.md on this PR.' || '' }}
          claude_args: "--max-turns 40"
```
Routing rule (in the prompt or a small script): the `domain:*` label on the issue/PR → the agent file with that name. No label → `platform`.

Optional **Routines** (Claude Code on the web → Routines): a nightly "spec drift" run that asks `qa-reviewer` to compare `docs/08-screen-inventory.md` with the routes that exist and open an issue per missing screen; a weekly "dependency + advisor" run that calls the Supabase `get_advisors` tool and files security/performance findings.

## What each brief contains (template)
1. Identity and scope sections to read first (with `grep -n` hints into `docs/scope/scope-of-work-v1.6.txt`).
2. Owned paths; paths it must not touch without a separate PR.
3. The rules that most often go wrong in this domain, stated as assertions (e.g. "buffer is displayed as `6 (+1)`, never `7`").
4. Acceptance: wireframe files, test vectors, pgTAP policies.
5. Definition of done checklist and how to hand off to `qa-reviewer`.
