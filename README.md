# The Hospitality Company · Staffing platform

Staff-management platform for an event-staffing agency: Back Office Portal (web), Staff App (PWA), Client Portal (web) on one Supabase database, deployed on Vercel. Built from the Scope of Work v1.6 with two agreed changes: PWA instead of Flutter, Supabase instead of Django.

**Start here**
1. `docs/00-how-to-build-with-claude.md` — how to run the build with Claude Code and the domain bots.
2. `docs/01-architecture.md` → `docs/02-build-plan.md` → `docs/03-data-model.md`.
3. `docs/04-setup-github-vercel-supabase.md` — connect the services.
4. `wireframes/index.html` — every screen, every state, in the real design system.

**Layout**
```
CLAUDE.md            rules for every Claude session
.claude/agents/      domain bots      .claude/skills/  shared know-how
docs/                plan, architecture, ADRs, scope text
supabase/migrations/ schema           wireframes/      the visual contract
.github/workflows/   ci + claude bot
```
Application code (`apps/`, `packages/`) is created in Phase 0 of the build plan.
