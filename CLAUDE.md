# The Hospitality Company · Staffing platform

Bespoke staffing platform for an event-staffing agency (~1,000 workers, 10–15 events/day). Three apps on one Supabase database: **Back Office Portal** (admin), **Staff App** (PWA, worker), **Client Portal** (customer, read-only, no money).

## Read first

- `docs/scope/scope-of-work-v1.6.txt` — the contract. Every behaviour is decided there. Grep it by section number (e.g. `grep -n "9.5 Check In"`). Where this file and the scope disagree, the scope wins, except the two deliberate changes below.
- `docs/01-architecture.md` — Supabase + Next.js/Vercel + PWA layout; where each rule lives.
- `docs/08-screen-inventory.md` — every route → wireframe → § → owning bot.
- `wireframes/` — the visual contract. Open `wireframes/index.html`. A screen is done when it matches its wireframe.

## Deliberate changes from the scope (agreed)

1. Staff App is a **PWA** (Next.js + Serwist), not Flutter. Background geofence is covered per `docs/06-pwa-vs-native.md` (ADR-0001).
2. Backend is **Supabase** (Postgres + PostGIS, Auth, RLS, Storage, Edge Functions, pg_cron), not Django/DRF. "Django Admin" settings live in the `settings` table + a `/settings` page.

## Visual direction

One user-facing switch (ADR-0003, `docs/09-visual-direction.md`): **Light mode = Warm look** (rounded, Plus Jakarta Sans, tinted surfaces), **Dark mode = Scope §1.6 look** (navy, cyan, zero radius, mono labels). Under the hood these are two token axes (`data-style` warm/scope, `data-theme` light/dark) so the pairing can change without touching screens. Components read tokens only; never hard-code colours or radii.

## Stack

pnpm + Turborepo · Next.js (App Router, TypeScript) on Vercel · Supabase · Tailwind is **not** used: the design system is plain CSS tokens/classes in `packages/ui` mirroring `wireframes/assets/thc.css` · Vitest · Playwright · pgTAP.

## Commands

```
pnpm i                      install the workspace (pnpm + Turborepo, Node 22)
pnpm dev                    all three apps: office :3000 · staff :3001 · client :3002
pnpm lint                   eslint, flat config at the repo root
pnpm typecheck              tsc --noEmit per workspace
pnpm test                   vitest per package
pnpm build                  next build for all three apps
pnpm format                 prettier

pnpm --filter @thc/office dev          one app only
pnpm --filter @thc/domain test         one package only
pnpm --filter @thc/db gen:types        regenerate Supabase types after a migration

supabase start · supabase db reset · supabase test db · supabase functions serve
```

## Layout

`apps/office` `apps/staff` `apps/client` · `packages/ui` (design system, plain CSS tokens
mirroring `wireframes/assets/thc.css`) `packages/domain` (pure rules + vectors)
`packages/db` (Supabase clients, roles) `packages/notifications` (§8 register)
`packages/pdf` (§11.3 documents) · `supabase/` (migrations, seed, tests).

## Domain rules that are easy to get wrong (assert these in code and tests)

- Times: stored timestamptz, rules evaluated in Europe/London. Scheduled times display UK + "your time" second line when the viewer's zone differs; actual check-in/out stamps show viewer-local only; manager-typed time inputs are labelled "(UK time)"; audit stamps (contract signature, verification) are UK-only (§1.8).
- Per-role windows (RULE-18): every timing rule uses the role section's start/end, never the event window. Event window = min start → max end.
- Buffer is absolute and displays as `6 (+1)`, never `7`. Fill counts ONLY confirmed.
- Weekly cap (RULE-20) is calculated, never stored or typed: 20 h in term, 48 h in holidays, 48 h after a verified completion letter, no ceiling only with the 48h opt-out and no visa limit; a Mon–Sun week straddling term/holiday takes the lower cap.
- Auto-assign: hard gates (wrong role → no row at all; blocked; booked elsewhere with the 2 h different-venue gap; hours limit; self-cancelled off this event; do-not-return) → Wave 1 qualified at client+role → Wave 2 the rest. Score = 0.30 show + 0.25 rating + 0.25 proximity + 0.10 fair + 0.10 venue. Additive hourly rounds; invitations are never withdrawn by auto-assign.
- Three-stage confirmation: accept → "I'm ready" by 12:00 the day before (hard: 12:05 cutoff releases + N6b) → on-the-day confirm (reminder only, never releases).
- Check-in: 30-min grace = Late; start+30 → automatic No-show and button lock (exempt if the booking was confirmed after the shift started). Check-out open from start until end+4 h from anywhere; off-site uses last on-site fix; end+4 h → "No check-out" violation, never a silent default. Strict buffer policy: first `headcount` check-ins work; later ones are turned away (RULE-15: fixed 4 h if on time, nothing if late).
- Pay (RULE-01/02/14): payable = [check-in, check-out] ∩ [start, end]; 15-min check-out grace; unpaid breaks deducted; 4-hour floor unless Left-early violation or unresolved No check-out; payroll exports never corrected retroactively (show warnings instead).
- Worker sees base rate only; client sees no money at all; holiday +12.07% is always broken out, never blended.
- Client data path (ADR-0004): the client role gets a policy only on a table carrying no money and no worker personal data (today `events` and `feedback`). Everything else the portal shows comes from a `client_*` view that runs with owner rights, filters by `client_portal_visible()` in its own body and names its columns. Never add a client policy to `roles`, `shift_requirements`, `bookings` or `staff` — a view cannot take back a privilege the base table grants.
- Notifications: copy and timing come from the §8 register in `packages/notifications`; every send goes through `notification_outbox` with a unique key.
- Every state change = one function in `packages/domain/state.ts` + a DB function; illegal transitions are rejected in the DB too.
- GDPR removal anonymises to "Deleted account #id", keeps history rows and already-issued PDFs.

## Conventions

- Branch `feat/<domain>-<thing>`; small PRs; one domain per PR; shared-package changes in their own PR first.
- Every table: RLS + pgTAP test for admin/client/staff.
- Every screen: matches its wireframe; states listed in `docs/08-screen-inventory.md`; deviations → `docs/adr/`.
- Never put secrets in code; Edge Function secrets via `supabase secrets`, Vercel env vars per app.
- Sample/seed data mirrors `wireframes/CONVENTIONS.md` so screenshots and tests read the same.
- Use the domain bots in `.claude/agents/` (see `docs/05-domain-bots.md`). Ask `qa-reviewer` before opening a PR.
- Running more than one bot at once: `docs/10-working-with-agents.md` (ownership map, the three shared hot spots, which phases overlap).
- Starting a session: `docs/11-session-prompts.md` has a self-contained prompt per phase; `docs/00-how-to-build-with-claude.md` is the operating manual and current status.
- Keys, connections and brand assets: `docs/12-keys-and-assets.md`. Source logos go in `brand/`; the generated icons are named in `apps/staff/app/manifest.ts`.
