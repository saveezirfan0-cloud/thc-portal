# The Hospitality Company · Staffing platform

Staff-management platform for an event-staffing agency: Back Office Portal (web), Staff App (PWA), Client Portal (web) on one Supabase database, deployed on Vercel. Built from the Scope of Work v1.6 with two agreed changes: PWA instead of Flutter, Supabase instead of Django.

**Start here**

1. `docs/00-how-to-build-with-claude.md` — how to run the build with Claude Code and the domain bots.
2. `docs/01-architecture.md` → `docs/02-build-plan.md` → `docs/03-data-model.md`.
3. `docs/04-setup-github-vercel-supabase.md` — connect the services.
4. `wireframes/index.html` — every screen, every state, in the real design system.
5. `docs/10-working-with-agents.md` — running several domain bots in parallel.

**Layout**

```
CLAUDE.md            rules for every Claude session
.claude/agents/      domain bots      .claude/skills/  shared know-how
docs/                plan, architecture, ADRs, scope text
supabase/migrations/ schema           wireframes/      the visual contract
.github/workflows/   ci + claude bot
```

Application code lives in `apps/` (office, staff, client) and `packages/` (ui, domain, db,
notifications, pdf). Phase 0 is in place: `pnpm i && pnpm dev`.
