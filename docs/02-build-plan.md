# 02 · Build plan

Eight phases, each a shippable increment with its own acceptance list taken straight from the scope. Phases 1–3 are the critical path (a worker can be onboarded, an event can be filled). Each phase names the domain bot that owns it (`docs/05-domain-bots.md`) and the wireframes that are its acceptance reference.

Team assumption: one human lead (product + QA + THC liaison) driving Claude Code sessions per domain, plus THC supplying the Appendix B inputs on time. Durations are calendar estimates for that setup.

## Phase 0 · Foundation (week 1–2)
Bot: `platform`
- Turborepo + pnpm; `apps/office`, `apps/staff`, `apps/client`; `packages/ui|domain|db|notifications|pdf`.
- Supabase project (London), `0001_init.sql`, RLS, Storage buckets, generated types, seed data (5 clients, 8 venues, 6 roles, 40 workers).
- Vercel: three projects from the monorepo, preview deploys, Supabase branch per PR.
- Auth: email+password for admin/client; invite link → `/activate` for staff; role routing middleware in each app; RLS tests with pgTAP for the three roles.
- `packages/ui` from `wireframes/assets/thc.css` (tokens, Sidebar, Topbar, Pill, Button, SegToggle, Input, DocRow, Avatar, Stepper, Modal, AppHeader, BottomNav, Sheet). Storybook or a `/design-system` route mirroring `wireframes/design-system.html`.
- CI: lint, typecheck, unit tests, pgTAP, Playwright smoke (login per role).
- Definition of done: all three apps deploy, log in per role, show the shell with the right menu; `packages/domain` has the rule test vectors file started.

## Phase 1 · Onboarding / ATS (week 3–6)
Bot: `onboarding`
- Public `/apply` (+ duplicate check → "returning applicant" entry) and `/apply/submitted`; age ≥ 18 on form + server (§2.1, §2.12).
- Willo: create candidate on submit, webhook → stage moves, E2 on reject, E3 activation on accept; manager picks role qualification at acceptance (§2.4, §9.6).
- Kanban `/onboarding` (6 columns, Active/Rejected), candidate profile by phase (§2.2–2.3).
- Staff PWA wizard 11/11 (§10.3): RTW branch with the 5 document sets (§2.5), share-code validator, address pin, selfie, documents + criminal declaration (auto-verify on No), H&S induction viewer, quiz (80%, 3 attempts, E4 + terminal screen), HMRC checklist with derived A/B/C (§2.8), two references, bank details, contract (versioned text, timestamp = signature), "How it works".
- AI extraction Edge Function (Gemini) behind `DocumentExtractor`; expiry, term dates, completion letter fields; confidence + manual-review flag (§2.6). gov.uk check per ADR-0002.
- Verify/Reject with reason → N8; quiz gate unlocks automatically; contract signed → `compliant`, Employee ID generated (§2.7).
- Acceptance: Appendix A journey end-to-end on staging with a real Willo sandbox; wireframes `backoffice/onboarding.html`, `candidate.html`, `staff/onboarding-1..3.html`, `public/*`.

## Phase 2 · Directory data (week 5–6, overlaps Phase 1)
Bot: `directory`
- Roles & rates with holiday +12.07% label (§9.8); Clients + New/Edit client modal, rate card with per-client charge rate + dress-code list, qualified staff block, events block (§9.7); Venues list/map/modal with type→radius defaults, slider, reverse geocoding, soft delete (§9.11); Staff directory filters incl. Inactive and the Student-visa view (§9.6, §4.5).
- Client qualification: manual add from profile and client card, automatic grant after a clean shift (trigger on booking → worked with no unresolved violation), Do-not-return (§9.6).

## Phase 3 · Scheduling + Auto-assign (week 7–11)
Bot: `scheduling`
- Shift Builder with per-role windows, min 4 h validation, buffer absolute, allocation default headcount+buffer, PO number, notes, on-site contact, dress code from rate card + Other, edit-lock at start, Duplicate (§3.2).
- Events List/Calendar (month/week/day) with fill chips and daily counters (§3.1).
- Event board with Confirmed / Invited / Potential pool / Unavailable, live recomputation, score breakdown, qualified chip, Applied marker, Withdraw, No-show + Get back with payroll-export warnings, Cancel event with N12 (§3.3).
- Auto-assign Edge Function: hard gates → Wave 1 → Wave 2, hourly additive rounds, 12:05 cutoff with N6b, 10-minute escalation (3 miles), first-to-confirm RPC, overlap auto-withdraw, booked-elsewhere 2 h gap (§3.4–3.6, §6).
- Staff PWA: Invites (accept/decline, overlap popup, Limit Reached), Shifts (three-stage confirmation, time-changed re-confirm, Cancel shift >72 h), Radar (qualified-first visibility, Applied section, N10/N10c) (§10.4).
- Acceptance: a 15-event day fills from seed data with the scoring order provable from `job_runs`; wireframes `backoffice/events.html`, `shift-builder.html`, `event-board.html`, `staff/invites.html`, `shifts.html`, `radar.html`.

## Phase 4 · Compliance (week 10–12)
Bot: `compliance`
- Needs review queue + Radar tab with counters (§4.1); expiry ladder N1–N4 and auto-block BG-04/05 with booking release (§4.2–4.3); full compliance re-check on any verify; manual Block/Unblock with reason; Reset to candidate (supersede evidence, keep Employee ID) (§9.6, §2.12).
- RULE-20 cap: SQL + TS implementations with shared vectors; N14 on band change; completion letter → `graduated_at` (§4.4–4.5).
- In-employment conviction declaration: RPC that blocks, releases bookings, writes E9; Verify → N15 / Reject → manual block (§10.7, RULE-21).
- Staff PWA: Documents tab states, re-upload, app-lock cases 1–3 (§10.1, §10.4).

## Phase 5 · Check-in / out, breaks, violations, monitor (week 12–15)
Bot: `checkin`
- RPCs `attempt_check_in` (grace 30 min, strict-buffer turn-away RULE-15, lock at start+30 except post-start confirmations), `check_out` (in/out of radius, last-on-site fallback, RULE-02 triggers), breaks start/finish, 6-hour alert BG-10 (§5.1–5.2b).
- Pay maths RULE-01/02/14/15 in `packages/domain/pay.ts` + `payable_shifts_v`; check-out confirmation screen with earnings (§5.1).
- Check-in monitor with Realtime, all status pills, dual-zone WINDOW column, Breaks column, Violation log + detail window + Resolve (mandatory note; No check-out needs "Actual finish (UK time)" with server validation) (§9.5).
- **Option B Capacitor shell** for background geofence if confirmed (see `06-pwa-vs-native.md`); `location_pings` ingestion, Off-site status, BG-06/07 violations.
- Staff PWA: all shift-detail states, static message screens, N9/N9b (§10.4).

## Phase 6 · Reports, documents, Client Portal (week 15–18)
Bot: `reports` and `client-portal`
- Financial / Payroll / New Starter tabs, CSV one row per shift, holiday broken out, Pending rows held, BG-08 Monday 09:00 email + send status (§9.9).
- Allocation sheet + sign-out timesheet PDF (§11.3) with 12-row pagination, PO number, anonymised names after removal; Send/Download from the event page, sender `timesheets@` (§11.4).
- Client Portal: login, events list with photos and dual-zone times, event page with confirmed line-up only, feedback popup after start (§11.1–11.2, §11.5).
- Feedback screen (two tabs, Mark as read affects rating) and profile feedback (§9.10).

## Phase 7 · Lifecycle, GDPR, migration, hardening (week 18–21)
Bot: `platform` + all
- Request my P45 (RULE-19, E8, leaver screen), Inactive tab; GDPR Remove; profile edits with E5/E6/E7; email change verification (§10.1, §10.6, §1.7).
- Old-system import (B5) against staging, sign-off dry run (B6): workers arrive `compliant` or `blocked` per document dates.
- Load test: 1,000 workers, 15 events/day, hourly rounds under 30 s; push fan-out; Realtime with 60 concurrent monitor viewers.
- UAT with THC, DNS (B7), production Supabase org + Vercel team transferred to THC (B8), runbooks.

## Cross-cutting checklists (every phase)
- Every user-visible time follows §1.8 (dual for scheduled, local for actual, "(UK time)" on typed inputs, UK-only for audit stamps).
- Every push/email uses the register in `packages/notifications` with the exact copy from §8.
- Every state transition goes through `packages/domain/state.ts`; illegal transitions are rejected by DB triggers too.
- Every new table gets RLS + a pgTAP test for admin / client / staff.
- Every screen matches its wireframe; deviations are recorded in `docs/adr/`.

## Dependencies from THC (Appendix B) mapped to phases
B1 Willo keys → Phase 1 · B2 contract text → Phase 1 · B3 sample letters → Phase 1 · B4 logo → Phase 0 · B5/B6 export + sign-off → Phase 7 · B7 DNS → Phase 6 · B8 hosting decision → Phase 7. Extra for the PWA route: Apple/Google developer accounts if Option B is chosen (Phase 5).
