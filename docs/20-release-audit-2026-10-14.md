# 20 · Release audit, 14.10.2026 — Back Office and Client Portal

**How it was done.** No route to the hosted Supabase / Vercel from the session, so the whole product was
stood up locally (`scripts/local-stack/up.sh`: Postgres 16 with all 264 migrations + seed and GoTrue's real
auth schema, PostgREST, GoTrue, production builds of the apps) and driven in a real browser (Playwright,
Chromium) by five agents in parallel, at 1440 / 1024 / 768 / 390 px, light and dark, signed in through the
real forms. Every record an agent created was prefixed `AUDIT-`, logged, and deleted afterwards (verified by
query). Storage, Edge Functions, Realtime and email were not running: failures caused only by that are marked
*env-limited* and not counted, unless the UI handled them badly.

| Area | Blocker | Major | Minor | Polish |
|---|---|---|---|---|
| Back Office — lists & tables | 0 | 3 | 10 | 7 |
| Back Office — events & scheduling | 0 | 7 | 14 | 9 |
| Back Office — detail pages & editing | **1** | 7 | 16 | 3 |
| Client Portal — live walk | 0 | 1 | 9 | 6 |
| Client Portal — desk review | 0 | 1 (High) | 1 (Medium) + 8 Low | — |

**The Back Office has no column chooser, resize or reorder anywhere, and the wireframes do not ask for one**
(sorting is a "Sort:" select). If "changing columns" means show/hide/reorder, that is a new feature, not a
fix — see package F.

---

## Part A · Back Office — flagged, awaiting approval (nothing changed)

### Blocker

- **B1 · "Do not return" cannot be switched on or off by any office login** (client card → Qualified staff, and
  staff profile → Client qualification). `set_do_not_return()` is `SECURITY INVOKER` and inserts into
  `audit_log`, whose only policy is `admin_read` (SELECT) — so the insert is refused by RLS for every admin.
  Verified on the database (`prosecdef = f`). The client card shows the raw text *new row violates row-level
  security policy for table "audit_log"*; the profile says "Only the office can do this." — both rendered
  behind the still-open modal. pgTAP `270_client_card.sql:141` calls it as superuser, which is why CI is
  green. Source: `supabase/migrations/20260922094500_staff_profile.sql`. §9.6 calls this the tab's only hard
  gate. **This is live in production too** (same migrations).

### Majors

| ID | Where | What | Likely cause |
|---|---|---|---|
| E-M5 | Event board | "Withdraw" on a **confirmed** worker is one click, no confirm, no undo, and queues the N10b push at once; the list closes up so the next worker's Withdraw slides under the pointer — a double-click removes two people | `events/[id]/_components/BookingActions.tsx:147-155` |
| L1 | /staff /clients /venues /users /compliance /onboarding | Search, filters, sort and page live only in React state: lost on Back and on reload (feedback/activity/inbox/reports keep them in the URL) | `staff/StaffScreen.tsx:93-101` and the same pattern in each screen |
| L2 · E-M1 · D-M4 | Every wide table at ≤1024 px, and /events list even at 1280–1440 | Tables scroll sideways **inside** their card, but the only scrollbar is at the card's bottom (7,216 px down on Venues); right-hand columns — including row actions (Edit/Delete, Users actions, rate-card Remove, the DNR toggle) and Fill/Status on /events — are cut with no cue; no sticky header, no pinned first column | `packages/ui/src/styles/components.css:565-576` (`min-width: 6.5rem` on every cell + `overflow-x:auto`), `:2622`; `events/events.css:305-340` |
| L3 | /onboarding kanban | Three stacked scrollers (page, board sideways, each column); column bottoms land below the fold; 6th column clipped at 1440 | `onboarding/onboarding.css:9-11, 50-62` |
| E-M2 | /events Week | Status and fill pills spill into the next day's column; times wrap to three lines | `events/events.css:151-158` |
| E-M7 | /events Day ≤1200 px | Long role chips run under the fill pill | `events/events.css:443-447` |
| E-M6 | /events at 390 px | A long client name widens the filter row to 535 px inside a 350 px toolbar; Search and Status are cut off and unreachable | `components.css:2749-2751` (`min-width:0` missing) |
| E-M3 | Shift Builder → Save | The board opens scrolled to where the form was, not the top | `events/actions.ts:200, :347` |
| E-M4 | Shift Builder (also /settings, every modal) | A filled-in form is discarded without warning by a sidebar link, Cancel, Esc or a backdrop click | `ShiftBuilder.tsx:138, 676-678`; `packages/ui/src/components/Modal.tsx:105-112` |
| D-M1 | Client card, rates, roles, qualifications, office feedback, event create/edit | Most edits write **no** `audit_log` row (and `events.created_by` stays NULL), while /users tells managers "Every change is recorded in the activity log" | `update_client`, `create_client`, `set_staff_pay_rate`, `add_staff_role`, `grant_client_qualification`, `add_office_feedback`, `events/actions.ts` |
| D-M2 | New / edit client | Accepts phone "not a phone", 4 contact emails under a "2–3 people" label, a 326-character name; no field-level errors | `clients/validate.ts`, `ClientModal.tsx:187` |
| D-M3 | Venues, staff feedback, client card | One long unbroken string breaks the page (2,802 px wide); no server-side length caps on venue/client name, dress code, office feedback | `components.css:2951,3109` (wrap only in phone queries) |
| D-M5 | Roles, client card, documents | Raw database text on screen, e.g. *duplicate key value violates unique constraint "roles_name_key"* | `roles/actions.ts:34`, `clients/[id]/actions.ts:38`, `onboarding/actions.ts:482,490` |
| D-M6 | Client card → Add staff | Picker lists every worker with no search (unusable at ~1,000); multi-select checkboxes are drawn as circles | `clients/[id]/QualifiedStaff.tsx` ~340-365 |
| D-M7 | Pay rate, role base rate, rate card | £0.00 pay and £5.00 base accepted with no minimum-wage floor or warning; a charge rate below final pay saves silently ("£-5.69/h") | `roles/money.ts:46-52`; DB check `pay_rate >= 0` |

### Minor and polish (summary — full tables in the agents' reports)

- **Lists:** /venues and /staff/requests have no paging (68 venues = 22,093 px on a phone); pager leaves you
  at the bottom of the new page; column widths jump while searching; stray scrollbars at 1440 on /users and
  Financial; New Starter preview wider than its card; /roles "✎" not clickable; /activity shows raw JSON and
  ISO UTC stamps; list edits give no "saved" feedback; tab strips on phone hide overflow with no cue.
- **Scheduling:** week day headers don't stick; /checkin table scrolls sideways at 1024 ("−3 worker");
  Cancel-event dialog copy contradicts ADR-0099; Auto-assign switch shows ON after cancel until reload; the
  10-day dashboard list is unbounded; small text at 4.36–4.48:1 contrast; ISO dates on the board; monospace
  font in Shift Builder inputs; "0 (+-2)" for a negative buffer; cancelled board shows an amber fill; the
  Shift Builder accepts a date already in the past (the board then refuses invites).
- **Editing:** settings save-bar errors land off-screen; Enter never submits a modal; editing patterns are
  inconsistent (autosave / inline / modal / edit-mode / instant remove with no undo); the selected tab isn't in
  the URL; offline venue creation can't complete; client card leaks "migration 20261008180000" and raw outbox
  keys; rate-card field errors appear at the top with the wrong copy; /users says "emailed" when only queued;
  native date inputs show mm/dd/yyyy; no `<main>` landmark or skip link (18 Tab stops before content);
  unlabelled "Remove" chips.
- **Shell (every page):** the sidebar's "My profile" sits half under the user footer at 900 px tall; labels
  truncate at 1024 ("Compli…").
- **Seed data:** Amara's letter is `verified` with `reviewed_at` NULL, so the Student view and Radar disagree;
  a staff rating of 4.4 "from 0 counted entries".

### Open PR #184 ("tables scroll in their card")

It would fix part of L2 (scrollbar in view, sticky header — no pinned column), most stray scrollbars and the
Reports top bar. It is 180 commits behind `main`, conflicts in 16 files, its ADR-0104 collides with main's,
and it introduces a page-plus-frame double vertical scroll — the L3 pattern. Recommendation: close it and
redo the table frame in package B on top of current `main`, reusing its CSS ideas.

### Proposed fix packages (each a small PR, in this order)

| Pkg | Contents | Size |
|---|---|---|
| **A · Safety (do first)** | B1 (make `set_do_not_return` write its audit row through a definer path + a pgTAP test that calls it as an admin, not superuser; show the error inside the modal); E-M5 confirm on Withdraw confirmed; D-M5 map raw DB errors to sentences | S |
| **B · Tables & scrolling** | One table frame in `packages/ui`: header sticky, actions always reachable (card rows or a sticky actions column ≤1024), scrollbar cue, wrap rules, stable widths; then /events list, week/day overlaps, 390 filter row, kanban single scroll, sidebar fit, /venues + /staff/requests paging | M–L (shared package PR first, then screens) |
| **C · Lists keep their state** | L1 filters/sort/page in the URL on the six screens; pager scrolls to top; profile tab in `?tab=` | S–M |
| **D · Editing safety** | Unsaved-changes guard (Shift Builder, settings, dirty modals); Enter submits; land at top after save; client validation; length caps + wrapping; pay-rate floor/confirm and margin warning; rate-card field errors; searchable worker picker | M |
| **E · Audit trail** | Audit rows for every client/rate/role/qualification/feedback/event edit (+ `created_by`), or change the /users copy | M (DB functions + pgTAP) |
| **F · Columns (new feature, needs your call)** | Column show/hide (and optionally reorder) per list, remembered per user — not in scope or wireframes | M |
| **G · Polish & a11y** | Remaining minors/polish above, landmark + skip link, contrast, touch targets | M |

---

## Part B · Client Portal — release status

**Verdict: on scope and security it is ready.** Every §11.1, §11.2, §11.5 bullet and every docs/08 state is
built; no money and no cross-client data reached any page or response (text and network bodies searched;
another client's event, document and malformed ids all give the same 404); `submit_client_feedback` refuses
everything it should; 489 → 544 Vitest tests, typecheck, lint and 576 pgTAP assertions on the client views
are green.

### Fixed on `claude/intelligent-brown-gme4gz`

Round 1 (`22e8afec`, ADR-0133):
- **List read bounded** (was: every event and line-up row ever, unordered; PostgREST's 1,000-row cap would
  silently drop faces, counts and then events within ~5 months for a busy hotel). Now: not-ended events in
  full + a 90-day past window with "Show older events", reads scoped to loaded events, ordered, and a cap
  shows a notice instead of wrong numbers.
- **Photo links reused** for half their life (the 60 s refresh re-downloaded every face every minute).
- **"Contact THC about this event"** on the event page; one source for the office address.
- **noindex** everywhere, branded `global-error`, per-event tab titles that leak nothing on a 404, a message
  for a login not linked to a company, and a "you've been signed out" feedback error that keeps the comment.

Round 2 (in progress — see the commit that follows this document):
- **"N of M confirmed" could show a fully-staffed event while a role was empty** (Bar 0/2 + Waiting Staff
  6/4 with buffer = "8 of 8", green) and exposed THC's buffer as "6/4". Each role now counts at most its
  headcount and the event is green only when every role is full.
- Header crowding at 761–1024 px and "UTC (UTC)"; UK date entry for the From/To filters (native inputs show
  mm/dd/yyyy on US-locale devices) and a message for a reversed range; a quiet status line instead of a dead
  "Allocation Timesheet" button when nothing is issued; named "Leave feedback for …" buttons, focus after
  submit, rating error clears; ≥44 px touch targets on tablets; pending state on downloads and one-shot
  notices; finished-event wording and no "Add to calendar" on past events; contrast of "Happening now";
  cancelled events not counted as Upcoming; wireframe's tablet table; phone panel title.

### Go-live checklist (not code)

- `SUPABASE_SERVICE_ROLE_KEY` must be set on the **client** Vercel project, or every face is a silhouette
  and every download fails (`photos.ts`, `documents.ts`).
- The login's "Privacy notice" link points at the Staff App's `/privacy` via env — confirm it is the public
  URL in production.
- No seeded worker has a photo and Storage was off: confirm real faces appear in the line-up against the
  hosted project before announcing the portal (§11.1's "recognise them by face").

### Feature proposals — need your approval

Neither hard line moves: read-only (a "request" is a message to THC, never a booking write) and no money.

| # | Feature | Why the customer cares | Scope | Effort |
|---|---|---|---|---|
| N1 | THC on-the-day phone number on the event page | "Who do I call at 07:30?" | Extension: one-column `client_*` view | S–M |
| N2 | Dress code per role on the event page | Confirms what staff will arrive in; it is the client's own data | Extension: column on `client_role_sections_v` | S |
| N3 | "Timesheets for this event go to …" | Answers "why didn't my colleague get it?" | Extension: `client_events_v` | S |
| N4 | Your feedback history | See what you rated before booking again | In scope | S–M |
| N5 | Search by worker name ("which events was Priya on?") | Asked for in the walk | In scope (now safe after round 1) | S |
| N6 | Printable line-up (print stylesheet) | For the door host before the PDF is issued | In scope | S |
| N7 | "Add all upcoming events to calendar" | One import instead of one per event | ADR-0050 note | S |
| N8 | First-login welcome panel | What arrives when, how feedback works | In scope | S |
| N9 | Event-page loading skeleton (keeping the 404) | Slow venue Wi-Fi | In scope | S |
| P1 | "Request this person again" / favourites → a message to THC | Rebook the people they liked | ADR (deviation from "no editing") | M |
| P2 | **Who hasn't arrived yet**, by name, on the day | The customer's first question at 08:30 — today it's a phone call | ADR + privacy review (ADR-0053 limits to counts) | M–L |
| P3 | Client emails: line-up fully confirmed / changed after the timesheet went | Fewer surprises | §8 register entries + preferences | M–L |
| P4 | Rate everyone in one pass after a large event | 40 popups after a 40-person event | In scope | M |
| P5 | Company users list on the account page | Who else at the hotel has access | Extension view | S–M |
| P6 | Document history (sent versions only) | Audit trail for the hotel | Extension | M |

**One decision for you:** an overbooked role shows every confirmed worker in the line-up (e.g. 6 faces under
"Waiting Staff · 4 of 4"). That is who is coming, so round 2 keeps it — but it still lets a sharp-eyed customer
see the buffer. The alternative is to show only the first *headcount* people and keep the rest internal.
