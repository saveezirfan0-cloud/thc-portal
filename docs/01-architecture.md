# 01 · Architecture

**Product:** The Hospitality Company staffing platform (Scope of Work v1.6, `docs/scope/`).
**Delta from the scope:** Flutter native app → **PWA**; Django/DRF/PostGIS → **Supabase**; React/Vite → **Next.js on Vercel**. Every rule, screen and state in the scope stays the same. See `06-pwa-vs-native.md` for the one requirement a PWA cannot meet on its own (background geofence) and how we cover it.

## 1. Shape of the system

Three applications on one database, exactly as §1.2, delivered as one monorepo and three Vercel projects:

| App | Path | Users | Domain (suggested) | Notes |
|---|---|---|---|---|
| Back Office Portal | `apps/office` | Admin | `office.thc.example` | Responsive web (tablet/phone too) |
| Staff App | `apps/staff` | Staff | `app.thc.example` | Installable PWA; also hosts the public `/apply`, `/apply/submitted`, `/activate` pages |
| Client Portal | `apps/client` | Client | `clients.thc.example` | Read-only, no money, responsive |

Shared packages:

| Package | Contents |
|---|---|
| `packages/ui` | The design system (§1.6/§10.1) as React components: `Sidebar`, `Topbar`, `AppHeader`, `Pill`, `Button`, `SegToggle`, `Input`, `DocRow`, `Avatar`, `Stepper`, `Kanban`, `Modal`, `Toast`. Tokens live in `tokens.css` and mirror `wireframes/assets/thc.css`. |
| `packages/domain` | Pure TypeScript rules with unit tests: scoring (§6), pay window RULE-01/02/14/15, weekly cap RULE-20, booked-elsewhere gap, HMRC statement derivation, share-code validation, state machines (§2.12, §3.6), time-zone display helpers (§1.8). No I/O. |
| `packages/db` | Generated Supabase types, typed query helpers, RLS-aware clients (server/browser), Storage helpers. |
| `packages/notifications` | Template registry N1–N15 and E2–E9 (§8), copy as constants, outbox writer. |
| `packages/pdf` | Allocation sheet / sign-out timesheet renderer (§11.3) with pagination (12 rows/page). |
| `supabase/` | Migrations, seed, Edge Functions, cron definitions, pgTAP tests. |

## 2. Backend on Supabase

| Scope concept | Supabase implementation |
|---|---|
| PostgreSQL + PostGIS | Postgres with the `postgis` extension. Venues/homes stored as `geography(point)`. Haversine → `ST_Distance`. Geofence → `ST_DWithin(venue, fix, radius_m)`. |
| DRF Token auth, RBAC (§1.4) | Supabase Auth (email + password). `profiles.role` ∈ admin/client/staff. **RLS on every table.** The client role holds a policy only on tables with no money and no worker personal data (`events`, `feedback`); everything else it sees comes from a `client_*` view that scopes itself with `client_portal_visible()` and selects no rate column (ADR-0004). Role-based routing is enforced in each app's middleware AND by RLS, so the client can never read office data even with a forged URL. |
| Worker activation link (§2.7) | `auth.admin.generateLink({type:'invite'})` sent in E3 from `admin@`; the worker sets a password on `/activate`. |
| Django Admin config (§6 weights, Willo stage map, venue radii §9.11, senders §9.12) | `settings` table (jsonb) + `venue_types` table, edited from a small "System settings" page in the Back Office restricted to admins. No release needed to change them. |
| Background jobs (§7) | `pg_cron` schedules → `pg_net` HTTP call → Edge Function. See §4 below. |
| Willo webhook (§2.4) | Edge Function `willo-webhook` (verifies signature, maps stage via `settings.willo_stage_map`, moves the card). |
| AI document extraction (§2.6) | Edge Function `extract-document` behind a `DocumentExtractor` interface; provider = **Gemini** (decided 17.07.2026), swappable. Writes `ai_extracted`, `ai_confidence`, `needs_manual_review`. **Never verifies** — a manager does. |
| gov.uk share-code check (§2.6) | Edge Function `rtw-check`. **Risk R-02:** gov.uk has no public API for the employer "view a job applicant's right to work" check. v1 plan: the function validates the code format, opens the check for the manager with code + DOB pre-filled, and the manager attaches the PDF result; the date is read from the PDF by the extractor. If THC obtains API access (or accepts a browser-automation worker), swap the implementation behind the same interface. Decide at kick-off, recorded in ADR-0002. |
| Email (§9.12) | Resend (or Postmark) with two verified senders: `timesheets@` and `admin@`. DNS (SPF/DKIM/DMARC) is THC's dependency B7. |
| Push (§8, §10.5) | **Web Push (VAPID)** to installed PWAs. Edge Function `notify-drain` sends from `notification_outbox`. iOS requires the app to be installed to the Home Screen (iOS 16.4+). |
| SMS (§1.3 "via Willo") | Willo sends its own interview SMS/email. No other SMS in v1. |
| Files | Supabase Storage, private buckets: `documents`, `photos`, `reports`, `timesheets`. Signed URLs, short TTL. |
| Realtime | Supabase Realtime on `check_logs`, `bookings`, `violations`, `location_pings` → the Check-in monitor updates live (§9.5). |
| PDFs (§11.3) | `packages/pdf` with `@react-pdf/renderer` in a Next.js route handler (`apps/office/app/api/documents/[eventId]/route.ts`); output stored to `timesheets` bucket and emailed via Resend. |
| CSV exports (§9.9) | Route handlers in `apps/office`; BG-08 Monday 09:00 job builds the same CSVs and emails finance. |
| Maps / geocoding | Mapbox GL + Mapbox Geocoding (reverse geocode pin → address; forward geocode home address). Google Maps works equally; pick one at kick-off. |

## 3. Where the rules live (and why)

The scope is rule-heavy. Every rule is implemented **once**, in the layer that must enforce it, and reused:

| Rule family | Primary home | Reused by |
|---|---|---|
| Display + form logic (dual time zones, "(UK time)" labels, buffer "6 (+1)", masked NI) | `packages/domain` + `packages/ui` | all three apps |
| Weekly cap RULE-20 | SQL function `weekly_cap_hours(staff, date)` (needed inside auto-assign queries) **and** `packages/domain/cap.ts` (for the profile explanation string). Both covered by the same test vectors in `packages/domain/__tests__/cap.vectors.json` and pgTAP. | auto-assign, Radar, Invites, profile |
| Auto-assign engine (§3.4, §6, RULE-17) | Edge Function `auto-staffing` (TypeScript, imports `packages/domain/scoring.ts`), runs per role section; hard gates first, then Wave 1 (qualified) → Wave 2. Uses PostGIS for proximity. | hourly cron, 12:05 cutoff, 10-minute escalation, "Potential pool" ranking on the event board (same function called synchronously with `dryRun:true`) |
| Atomic transitions (first-to-confirm RULE-03, accept with overlap block, strict-buffer check-in RULE-15, No-show lock at start+30) | Postgres functions with `select … for update` (`accept_invite()`, `attempt_check_in()`, `check_out()`) | Staff app via RPC; jobs |
| Pay window RULE-01/02/14/15, breaks §5.2b | `packages/domain/pay.ts` (pure) + SQL `payable_minutes()` / `turned_away_minutes()` and the view `payable_shifts_v` implementing the same maths for reports. Both held to `packages/domain/src/pay.vectors.json` (0006) | check-out screen, payroll report, CSV, timesheet |
| State machines (§2.12 staff, §3.6 booking) | `packages/domain/state.ts` (transition table) + DB triggers that reject illegal transitions | everywhere |
| Notification register (§8) | `packages/notifications/templates.ts` (copy is data, not code) + `notification_outbox` (unique `key` → idempotent) | jobs, RPCs |

## 4. Background and time-based rules (§7) → jobs

Cron entries are **data**, in the `job_schedules` table
(`20260921130927_jobs_and_outbox_drain.sql`), applied to pg_cron by
`select install_job_schedules()` as a deploy step. They are not scheduled by the migration
itself: doing that would start a per-minute `net.http_post` against an Edge Function URL
that does not exist yet, on every `supabase start` in CI, and it would bake the
service-role key into a stored command string. The command reads the base URL from
`settings.edge_base_url` and the key from `vault` when it runs.

Schedules below are **UTC**, because pg_cron is. The three jobs the scope pins to a UK
wall-clock time — the 12:05 cutoff, the 05:00 compliance sweep and the Monday 09:00
finance send — are therefore registered as every-5-minute entries with the UK-minute
decision inside the Edge Function, per `.claude/skills/supabase-workflow`. **That gate is
load-bearing:** an `auto-staffing?mode=cutoff` that forgets it runs the §3.5 cutoff 288
times a day, dropping confirmed workers on each pass (N6b). Every job is also disabled in
the registry until its Edge Function exists.


| Scope job | Schedule | Edge Function | Notes |
|---|---|---|---|
| `auto_staffing` | hourly at :17 | `auto-staffing?mode=hourly` | every unfilled role section whose shift has not started |
| `auto_staffing --cutoff` | every 5 min, UK 12:05 gate in the function | `auto-staffing?mode=cutoff` | drops confirmed workers without "I'm ready" for tomorrow → N6b → refill |
| `auto_staffing --escalation` | every 10 min | `auto-staffing?mode=escalation` | events under way and short; 3-mile widened pool; ignores headcount+buffer cap |
| `compliance_daily` | every 5 min, UK 05:00 gate in the function | `compliance-daily` | auto-block on expiry (BG-05), release bookings, N1–N4 tiers, N14 cap-band changes |
| BG-01/02/02b/03/09/10 per-booking timers | every minute | `booking-tick` | selects due bookings and writes outbox rows keyed `N9:booking:<id>` etc.; raises No-show at start+30 (exempt if confirmed after start), No check-out at end+4h, 6-hour break alert |
| BG-08 finance reports | every 5 min, UK Monday 09:00 gate in the function | `finance-reports` | payroll CSV always; New Starter CSV only if any; holds shifts with unresolved No check-out |
| Outbox drain | every minute | `notify-drain` | Web Push + email; retries with backoff; marks `sent_at`/`failed_at` |
| Willo | webhook | `willo-webhook` | New Response → interview_completed; Stage Change → documents / rejected (+E2) |
| RULE-16 stale invites | none | live filter `event_window.ends_at < now()` in queries | no job, per spec |

Every job is **idempotent** (outbox keys, `for update skip locked`, and per-run `job_runs` rows) so a re-run after a failure never double-sends N6b or double-invites.

## 5. Staff App (PWA) specifics

- Next.js App Router + **Serwist** service worker; `manifest.webmanifest` (name "The Hospitality Company", display `standalone`, theme `#04080F`), offline shell for Shifts/Documents, background sync for check-in attempts made with poor signal (queued, replayed with the original `attempted_at`).
- Geolocation: `navigator.geolocation.watchPosition` while the app is open; Screen Wake Lock during an active shift; distance to venue computed on the device (haversine from `packages/domain`) and verified on the server (`ST_DWithin`) at check-in/out.
- Push: `PushManager.subscribe` after activation (permission requested on a user gesture, screen in `wireframes/staff/auth.html`).
- Camera: `getUserMedia` for the selfie (3/11) and document capture; HEIC accepted via file input.
- **Background geofence (BG-06/07) is not possible in a PWA.** The plan in `06-pwa-vs-native.md` covers it with a Capacitor shell that reuses the same Next.js build. Nothing in the UI changes.

## 6. Security and GDPR (§1.7)

- TLS everywhere (Vercel + Supabase), encryption at rest (Supabase), RLS on every table, service-role key only in Edge Functions and Next.js server code.
- Sensitive data (criminal declaration details, bank details, NI) is readable only by `admin` policies; never selected in client views or exports.
- GDPR Remove = Postgres function `gdpr_remove(staff_id)`: anonymises name/contacts/photo, deletes Storage objects, sets `removed_at`, disables the auth user, releases future bookings; history rows stay. Already-issued PDFs are never touched; regenerated ones read the anonymised name (§1.7).
- Audit: `audit_log` for verify/reject/block/unblock/resolve/reset/remove with actor + timestamp (shown in UK time as an audit record, §1.8).

## 7. Environments

| Env | Supabase | Vercel | Notes |
|---|---|---|---|
| local | `supabase start` (Docker) | `pnpm dev` | seed data from `supabase/seed.sql` |
| preview | Supabase **branch** per PR (created by the Supabase GitHub integration) | Vercel preview per PR | branch DB URL injected automatically |
| staging | project `thc-staging` | `staging-*` domains | migration dry-run for the old-system import (B5/B6) |
| production | project `thc-prod` (London region) | production domains | code handed to THC; Supabase org owned by THC (§1.1) |

## 8. Repository layout

```
Portal/
  CLAUDE.md                  ← rules every Claude session follows
  .claude/agents/            ← domain bots (subagents)
  .claude/skills/            ← reusable know-how (design system, domain rules, migrations, PWA)
  apps/office | staff | client
  packages/ui | domain | db | notifications | pdf
  supabase/migrations | functions | seed.sql | tests
  wireframes/                ← the visual contract (this session's output)
  docs/                      ← this folder; ADRs in docs/adr
  .github/workflows/         ← CI + the database deploy, Claude review bot
```
