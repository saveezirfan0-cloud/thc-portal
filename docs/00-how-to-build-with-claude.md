# 00 · How to build this with Claude Code

This repo is set up so that a Claude Code session can pick up any slice of the scope and build it correctly on the first pass. This page is the operating manual.

## What is already in the repo (this session's output)
| Folder | What |
|---|---|
| `docs/scope/` | The full scope text, greppable by section. |
| `docs/01–08` | Architecture, build plan, data model, setup, bots, PWA analysis, design system, screen inventory. |
| `docs/adr/` | Decisions that change or interpret the scope (PWA, gov.uk). |
| `supabase/migrations/0001_init.sql` | The core schema, enums, RLS skeleton, calculated-cap function. |
| `wireframes/` | Every screen as static HTML in the real design system. Open `wireframes/index.html`. |
| `CLAUDE.md` | The rules every session reads automatically. |
| `.claude/agents/` | Twelve domain bots. `.claude/skills/` — four reusable skills. |

## First three sessions (do these in order)
1. **Bootstrap** — "Use the platform agent to bootstrap the monorepo per docs/04, create apps/office, apps/staff, apps/client, packages/ui|domain|db|notifications|pdf, wire Supabase local + Vercel, and get login per role working. Then run /init to refresh CLAUDE.md commands."
2. **Design system** — "Use the design-system agent to port wireframes/assets/thc.css into packages/ui with the components listed in docs/07 and a /design-system route that mirrors wireframes/design-system.html."
3. **Domain core** — "Use the scheduling and compliance agents to implement packages/domain (state machines, scoring, cap, pay, overlap) with test vectors from the scope, and the SQL functions listed in docs/03."
Then follow `docs/02-build-plan.md` phase by phase.

## Prompt pattern that works
```
Use the <bot> agent. Goal: <feature> (§x.y). Read the § and the wireframe first.
Constraints: one domain, one PR; no shared-package changes without a separate PR; tests for every rule.
Done when: <acceptance from the build plan>. Then run qa-reviewer on the diff.
```

## Where to work
- **Claude Code on the web** (claude.ai/code): one session per domain in parallel, each on its own branch; the Vercel and Supabase connectors (once connected) let the session deploy previews, run migrations on a branch DB, and read build logs.
- **CLI / IDE**: same repo, same agents; `supabase start` for a local DB.
- **GitHub**: `@claude` in an issue with a `domain:*` label routes to that bot; every PR gets a `qa-reviewer` comment (workflow in `.github/workflows/claude.yml`).

## Guard-rails
- The scope wins over any suggestion, including Claude's; changes are ADRs.
- Never let a bot "simplify" a rule (e.g. store the weekly cap, blend holiday pay, show the event window on a shift card). `qa-reviewer` checks these explicitly.
- Keep THC's Appendix B inputs (Willo keys, contract text, sample letters, logo, DNS) in an issue with due dates; several phases block on them.
