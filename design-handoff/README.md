# Handoff: The Hospitality Company — staffing platform UI

## Overview

The Hospitality Company (THC) is a London event-staffing agency (~1,000 zero-hours workers, 10–15 events/day in season). The platform replaces their legacy system with three applications on one Django/DRF/PostgreSQL+PostGIS backend:

1. **Back Office Portal** (web, React) — the agency's admin staff
2. **Staff App** (mobile, Flutter native iOS/Android — native is required for background geofencing)
3. **Client Portal** (web, React) — the customer's own events and line-up, no money shown

This bundle covers **eleven screens** across all three apps, in two themes. Everything here is derived from *Scope of Work — The Hospitality Company, v1.6 (17 September 2026)*. Section references (§) throughout point back at that document, which is the contractual source of truth for behaviour.

## About the design files

The `.dc.html` files in this bundle are **design references created in HTML** — prototypes showing intended look, structure and content. They are **not production code to copy**. Two things in particular do not transfer:

- They are **static boards**. Nothing is wired: no routing, no state, no data. Every value is realistic dummy content.
- They use **inline styles exclusively** and repeat literal values rather than using tokens, because of how the prototyping environment streams markup. Do not mirror that. Use the Design Tokens section below and the target codebase's styling approach.

The task is to **recreate these designs in the target codebase's existing environment** — React for the two web apps (the scope fixes the stack: React + Vite + React Router + axios), Flutter for the mobile app — using its established component patterns, not to port the HTML.

Each screen frame carries a `data-screen-label` attribute so you can find it in the source quickly.

## Fidelity

**High fidelity.** Final colours, typography, spacing, states and copy. Recreate the UI faithfully using the codebase's libraries. Where a measurement is not stated below, read it off the HTML — the inline styles are exact.

One caveat on theme, see *Design Tokens*: v2 deliberately departs from the scope's stated zero-radius rule at the client's request in review. Confirm which of v1/v2 is being built before you start.

---

## Screens / Views

### Back Office Portal (web, 1440px design width, responsive down to tablet/phone)

Persistent chrome on every back-office screen:

- **Sidebar**, 236px fixed, panel background, 1px right divider. Brand lockup in a 64px header (circular accent tile, 34px, holding the two-glasses mark; wordmark "The Hospitality / Company" in heading font 13px/1.15 semibold). Nav order is fixed by §9: Dashboard · Onboarding · Scheduling · Compliance · Check In / Out · *(divider)* · Staff · Clients · Roles · Reports · Feedback · Venues. Count badges sit right-aligned in the row (Onboarding = active candidates, Compliance = blocked workers, danger-coloured).
  - **v1 active state**: 3px accent left bar + 8% accent fill + accent text, `padding:11px 18px`. Consistent on every page (§1.6).
  - **v2 active state**: pill — `padding:11px 16px; margin:2px 12px; border-radius:14px`, 12% accent fill, accent text, no left bar.
- **Top bar**, 64px, 1px bottom divider, page title in heading font 20px/700, right-aligned user chip (30px avatar + name).

---

#### BO1 — Dashboard `/dashboard` (§9.1)

**Purpose:** first screen after login; answers "what is on fire right now".

**Layout:** content column padded 26px 28px 32px, three stacked blocks with 26px gaps.

1. **KPI row** — 4 equal tiles. Each: label (10px, muted, uppercase in v1 / sentence case in v2), value (heading font, 40px/700, colour-coded), one-line description (12px muted).
   - Open positions — **47**, amber. Unfilled positions across *all* events however far out. "Sold but not staffed" — the headline business number.
   - On shift now — **128**, green. Currently checked in.
   - Staff available — **612**, default ink. Compliant and unbooked.
   - Compliance blocks — **9**, danger. Blocked on an expired document.
2. **This week (Mon–Sun) financial snapshot** — panel with header row ("This week" + the date range), then 3 tiles: Chargeable £84,210 · Payable £51,940 (sub-line "Base £46,350 · holiday +12.07% £5,590") · Margin £32,270, green, sub-line "38.3% · includes holiday pay". Holiday pay is **always broken out**, never blended (§9.9).
3. **Upcoming events, next 10 days** — table, columns `150px 1fr 1fr 190px 120px 130px`: Date · window / Client / Venue / Role / Fill / Margin. Date cell is two lines (date bold, window muted 12px). Fill is a pill: green when every role is confirmed, amber when short, danger when badly short, text `N of M (+buffer)`. Margin is green, right-aligned, `+£X/h` = charge − final pay.

**v1 vs v2:** in v1 the KPI and financial tiles are a 1px-gap grid on the divider colour (hairline separators, square). In v2 they are separated cards — `gap:12px`, each with a 1px border and 18px radius.

---

#### BO2 — Event board `/events/:id` (§3.3, §3.4)

**Purpose:** staff one event, role section by role section.

**Header** (padded 20px 28px, 1px bottom divider):
- Breadcrumb "Scheduling / Fri 25 Sep 2026".
- Title (heading 24px/700) "Autumn Partners Dinner", then a status pill (Upcoming / Ongoing / Completed / Cancelled — computed from the event window, except Cancelled which is manual) and a read-only PO chip `PO number · CLA-44192`.
- Right-aligned actions: Duplicate (outlined) · Cancel event (outlined, danger) · Edit event (solid accent).
- Meta row: Client · Venue + geofence radius · Window (`07:00 – 23:30 UK time`) · break policy ✓ · buffer policy ✕ with "(strict)". Break and buffer policy stay visible as read-only checkmarks after creation.

**Role sections** — one panel per role, ordered by start time, earliest first (the running order of the day). Section header carries: role name (heading 16px/700), that role's **own** window, dress code (from the client's rate card), pay and charge rates, then right-aligned `N confirmed` (green) · `M invited` (amber) · `K open of H (+buffer)` (danger), and the **Auto-Assign** switch — purple, default ON, per role.

Within an expanded section, four sub-lists in this order:

1. **Confirmed** — 4-up grid of cards (avatar + name + status line). Day-before confirmation state shows here. A no-show **stays in Confirmed** with a danger "No show" badge and a "Get back" action — it never moves to another list (§3.3).
2. **Invited · awaiting response** — same card shape, "Invited 09:17 · wave 1".
3. **Potential pool** — ranked table, columns `36px 1fr 200px 250px 96px 110px`: avatar / name + ★rating + show-rate / wave / match score / distance / Invite button.
   - Wave column shows a `Qualified — [client] · [role]` chip for wave-1 workers and a plain outlined `Wave 2 — not qualified here` chip otherwise. A Radar self-applicant carries "Applied 2h ago" in purple.
   - Match score is a 6px track + the 0–100 number. Wave-2 rows render the bar in muted grey, not accent, so ordering reads correctly at a glance.
   - Footnote: RULE-17 — a wave-2 worker scoring 94 is invited only after every eligible wave-1 worker; managers can override manually.
   - Toolbar above: search + a sort control ("Sort: applied first").
4. **Unavailable** — 3-up grid at 72% opacity with the reason as the sub-line: Blocked — compliance / Booked elsewhere · [event] / Rejected — self-cancelled (RULE-04). **Wrong-role workers never appear here** (§6) — they'd bury the section.

Collapsed sections render header only (shown for Waiting Staff and Bar Staff in the mock).

---

#### BO3 — Onboarding kanban `/onboarding` (§2.2)

**Purpose:** the candidate pipeline.

Six equal columns: Interview requested → Interview completed → Documents → Quiz → Additional info → Contract. Column header is a label + count over a 2px bottom rule (accent on the first column, divider colour on the rest).

Toolbar: title, then an **Active / Rejected** segmented toggle (Active selected, count in the label), search on the right. Rejected candidates are hidden by default and reachable only through this toggle.

Card anatomy: 30px avatar + name + sub-line, then a state chip. Variants shown:
- "Willo sent" (amber chip) — the interview invitation goes out automatically on form submission; there is no separate "Applied" stage.
- "Review interview on Willo ↗" link — the decision is made inside Willo; the system picks up the result itself.
- Document progress as a 5-segment bar (green verified / amber pending / empty) + "2 awaiting review".
- Danger chip "1 rejected — re-upload sent".
- Purple chip "AI · needs manual review".
- Quiz: "Attempt 2 of 3 · 65%" with "Pass mark 80%".
- **Returning applicant** card — purple border and chip, body text "Matches an existing record — Employee ID 10442. Reset to candidate, or reject." (§2.12: duplicate check on email, and mobile + DOB.)

---

#### BO4 — Candidate profile `/onboarding/:id` (§2.3)

**Purpose:** review one candidate at their current phase. Shown at the **Documents** phase.

**Identity header:** 72px square avatar (the onboarding selfie), name (heading 24px/700), contacts line (`email · phone · DOB 04.03.2004 (22)`), chips for RTW branch and each qualified role. The **only** top-area action is `Reject candidate` (outlined danger) — rejection is final; a rejected person must re-apply via `/apply`.

**Stepper:** six nodes, connected by 2px rules — completed = green ✓, current = accent numeral, future = outlined. Quiz node is labelled "Quiz · locked" in amber until every document is verified.

**Left column:**

- **Documents panel.** Header carries "2 awaiting review · quiz locked until all verified". Each row: 38px type tile (PDF / GOV / JPG / DEC), title, meta line, then either a state pill (Verified / Rejected) or the **Verify** (solid accent) and **Reject** (outlined danger) pair. Rows shown:
  - Passport — expiry read by AI, confidence 97% (green).
  - gov.uk share-code check — `W12 3AB 4CD` + DOB, right to work until 30.06.2028, report stored. Nobody types the date.
  - University Term Dates Letter — confidence 62%, amber "needs manual review", row tinted amber, Verify/Reject pair.
  - Criminal convictions declaration — answered **Yes**, so it follows the same Verify/Reject mechanic as a document. (A **No** answer is auto-verified on submission and never enters the queue.)
  - Proof of address — Rejected, with the reason inline and "re-upload requested".
- **Term dates panel.** Header explains "read from the letter by AI · confirm the dates, not the hours", with a `+ Add period` action so a manager can add a period OCR missed. 2-up grid of period cells; one is amber to show a low-confidence extraction. The number of periods is arbitrary (0–4+ in real cases).

**Right column:**

- **Weekly hours limit (RULE-20)** card — label, `20 h/week` at heading 34px/700, "Term time until 13.12.2026", and a bordered footnote: *calculated, never typed; it follows from the verified term dates; there is no field to edit*. This card must be read-only for every worker, student or not.
- **Interview** card — completion date + "Review interview on Willo ↗".
- **Application** card — definition rows: Home address / Applied / GDPR consent (green "Given") / Employee ID ("Generated on contract").

---

#### BO5 — Venues `/venues` (§9.11)

**Toolbar directly under the page title** (not in the top-right): `List / On map` segmented control, then `+ New venue` (outlined accent), with search by name and address right-aligned in the same row.

**Table**, columns `1.1fr 1.7fr 190px 110px 170px`: Venue (name + venue type sub-line) / Address / Geofence (a proportional 5px track across the 100–3000m range + the value) / Events count / per-row **Edit** and **Delete** buttons.

Rows demonstrate the default radii by venue type: banqueting 250m, racecourse 1500m, exhibition centre 400m, hotel 150m.

Not drawn here, but required: create/edit is a **modal** over the list (full-width map with a draggable pin, type selector that pre-fills the radius, a 100–3000m slider that redraws the circle, reverse-geocoded read-only address + lat/lng), and delete is a confirmation modal naming how many upcoming events use the venue.

---

### Staff App (Flutter, 390×844 design frame)

Persistent chrome:

- **Frosted top bar** — `background: rgba(panel, .6)` + `backdrop-filter: blur(18px)`, 1px bottom divider. Contains the status bar row, then the brand tile (26–30px accent circle/tile with the mark), screen title (heading 16px/700), optional count chip, and the worker's avatar right-aligned. Header collapses on scroll — logo stays left, profile stays right (§10.1).
- **Frosted bottom navigation** — same treatment, 4 equal tabs: **Documents · Shifts · Invites · Radar**, padded `14px 0 28px` for the home indicator. Active tab is accent, 600 weight.
- **Background glow** — two large radial gradients behind the content (cyan and purple in v1 dark; clay and amber in the warm themes), `pointer-events:none`, clipped by the frame.

App lock has three distinct cases that must be built (§10.1): compliance auto-block → only Documents is reachable; manual block → a static "Your account is on hold" screen with no Documents action; quiz failed 3× → terminal screen carrying the exact rejection copy; and a leaver → the P45 screen with Payment information still reachable.

---

#### M1 — Shifts (§10.4)

Segmented control in the header: `My shifts · 2` / `Open shifts`.

- **TODAY** group. Accent-bordered card: event title (heading 17px/700), venue + address, a "TODAY" chip; a 3-up stat strip between two rules — **Your hours** `17:00 – 23:30`, Role, Rate; then dress code + on-site contact; then a full-width primary **Check in — opens 16:30**.
- **UPCOMING** group. Amber-bordered card with a solid amber "Needs confirmation" chip, the role window, amber body copy *"Confirm by 12:00 today or you'll be removed from this shift"*, and a full-width amber **I'm ready — confirm**.

Critical rule: the times on a shift card are always **the worker's own role window**, never the event window (RULE-18). A confirmed card also carries a text-link **Cancel shift**, shown only while >72h remain before the start (RULE-04).

---

#### M2 — Invites (§10.4)

Header carries a count chip. Each invite card: role (heading 17px/700), event + venue, a distance chip; a 2-column stat grid between rules — date + window, rate, and **dress code spanning both columns** (shown before the worker decides, confirmed 08.09.2026); then side-by-side **Accept** (solid accent) / **Decline** (outlined).

Second card demonstrates the **weekly-hours hard gate**: an amber notice block — *"Limit reached — You've worked 18 h of your 20 h this week. Accepting an 8 h shift would take you over — your limit resets Monday."* — and Accept rendered disabled at 55% opacity. Decline stays enabled; declining is always allowed with no show-rate impact.

On-site contact and break policy are **not** shown on an invite — they appear only after acceptance.

---

#### M3 — Onboarding wizard, step 1/11 (§10.3)

Header shows "Get set up" + `1 / 11` and a 3px progress track filled to 9%.

Body: title (heading 24px/700) "Your right to work", a plain-language sub-line, then five selectable option rows — 18px marker + title (15px/600) + explanation (12px/1.5 muted). The selected row (International student) takes an accent border, 7% accent fill and a filled marker.

Below: a **Share code** field, pre-filled `W12 3AB 4CD`, accent border, 16px mono-ish value, with helper text *"9 characters beginning with W. We check it with gov.uk using your date of birth — you don't upload anything."* Validation: exactly 9 alphanumerics starting with W, case-insensitive, spaces stripped.

Footer: full-width **Continue**, pushed to the bottom with `margin-top:auto`. Continue is disabled until the step is complete.

The full 11 steps: 1 Right to work · 2 Home address · 3 Profile selfie · 4 Documents (incl. criminal record declaration) · 5 H&S induction · 6 Safety quiz · 7 HMRC New Starter · 8 Two references · 9 Bank & payroll · 10 Contract · 11 How it works.

---

#### M4 — On shift: check-out and breaks (§5)

Header shows "On shift" plus a green `GPS on site` chip.

1. **Shift summary** card — event, client + venue + role, the role window.
2. **Live state** card, green-bordered: "Checked in 16:58 · on site", a `2:14` counter at heading 44px/700 with "chargeable so far", a 6px progress track, and the pay rule in plain words: *"Paid from 17:00, your scheduled start — arriving early isn't paid. Stay inside the venue area or the office is alerted."*
3. **Breaks** block (only where the client does **not** pay for breaks) — header with "1 taken · last 18:05 · 22 min total", the mandated amber banner *"A break will be applied to all shifts over 6 hours — please check with your Manager on site."*, a **Start break** button, and a footnote that break time comes off the hours and several breaks are allowed. Before check-in the button is disabled with the hint "Unlocks after check-in". While on break the timer runs, the chargeable timer pauses, and the button becomes "Finish break — back to work".
4. Footer: **Check out — available from 23:15**, outlined until active.

---

#### M5 — Profile sheet + Request my P45 (§10.1, §10.6)

A bottom sheet over a blurred, dimmed Shifts screen: 44px grab handle, 52px avatar + name + "Employee ID 10318 · Waiting Staff, Bar Staff", a 3-tile stat strip (Rating 4.8 green / Show-rate 98% / This week 18 / 20 h), then a divided link list — Profile details · Security settings · Payment information · Sign out — then the help line *"Need help? Please contact us at: admin@thehospitalitycompany.co.uk"*.

Below a rule, visually separated and deliberately **not** styled as a primary action: **Request my P45** (outlined danger) with the consequence stated underneath — *"You'll be taken off every shift you're booked on and won't be invited again unless you re-apply."* Behind it sit a full confirmation sheet and a second "Are you sure?" step. The action is disabled while the worker is checked in, with the hint "Available once you've checked out".

---

### Client Portal (web, 1180px shown, responsive to phone and tablet)

#### CP1 — Event + line-up (§11.1)

**Header bar**, 66px: brand tile + wordmark, then tabs My events / Timesheets / Feedback (active tab carries a 2px accent underline), client chip right-aligned.

**Event header:** title (heading 26px/700), date + venue line, an "Upcoming" pill, a `PO · CLA-44192` chip, and a right-aligned **dual-zone window** — `07:00 – 23:30 UK time` over `09:00 – 01:30 your time` (§1.8; the second line is omitted entirely for a UK viewer).

**Stat row:** Staff booked `21 of 26` · Roles `3` · On-site contact (name + phone).

**Line-up panel:** one group per role. Group header = role name, the role's own window in both zones, and `N of M confirmed` (green when full, amber when short). Below it a 5-up grid of staff: 34px avatar + name. A GDPR-removed worker still occupies a slot, labelled **"Deleted account #8841"** with no photo, so headcount isn't skewed (§1.7). An unfilled slot is a dashed placeholder reading "Being filled". Overflow shows "+ 10 more".

**Footer:** `Download allocation sheet` (primary) with the note that it is sent from `timesheets@thehospitalitycompany.co.uk` the day before the event.

**Never render in this portal:** pay rates, charge rates, margin, totals, criminal declaration details, or any worker's personal data beyond name and photo.

---

## Interactions & Behavior

The boards are static; this is the behaviour they imply. The scope is authoritative — these are the rules the screens are shaped around.

**Navigation**
- Sidebar routes: `/dashboard`, `/onboarding`, `/onboarding/:id`, `/events`, `/events/:id`, `/compliance`, `/checkin`, `/staff`, `/staff/:id`, `/clients`, `/clients/:id`, `/roles`, `/reports`, `/feedback`, `/venues`.
- Role-based routing is hard: a client user can never reach a back-office route and vice versa (§1.4).
- Kanban cards open the candidate profile; event chips open the event board; venue create/edit and client create/edit are modals, not routes.

**Hover / focus / press**
- Buttons animate on hover (§1.6). Solid accent → lighter accent fill; outlined → accent border + accent text; danger outlined → 12% danger fill.
- Table and list rows in the violation log are clickable, with a "Details" button alongside as the keyboard path.
- Give every interactive element a visible keyboard focus ring in the accent colour — never the browser default.

**Auto-assign (§3.4)** — a switch, default ON, settable per event or per role. From creation it adds `allocation` invites per hour in descending score order, working **Wave 1 (qualified at this client for this role)** to exhaustion before **Wave 2**. Earlier invitations are never pulled. It keeps going until headcount + buffer is filled.

**Confirmation chain (§3.5)** — accept → day-before confirm by 12:00 → on-the-day "I'm ready". Missing the 12:00 cutoff drops the worker automatically at 12:05 and re-opens the slot. Skipping the on-the-day confirm does not block check-in; it shows as "Not confirmed today" on the monitor.

**Check-in / check-out (§5)** — 30-minute grace after the scheduled start; check in during it and you're marked Late but paid from the scheduled start. At start+30 with no check-in the system marks No-show and **locks the check-in button**. Check-out has a 15-minute grace; between 15 minutes and 4 hours a late check-out red-flags on the monitor but doesn't change pay; at 4 hours the button locks and a "No check-out" violation is raised, leaving payable time undetermined until a manager resolves it with an actual finish time.

**Time zones (§1.8)** — scheduled times are shown in **both** zones (UK first, viewer's local second, second line omitted when they match). Actual check-in/check-out stamps and the "Due" pill are shown in the **viewer's** zone only. Audit stamps (contract signature, document verification) are **always UK time, never converted**. Every field where a manager types a time must carry "(UK time)" in its own label.

**Empty, loading and error states to build**
- Potential pool exhausted; no upcoming events; no invites; Radar with nothing nearby; "No earnings yet" before the first paid shift.
- Applying/accepting re-checks availability first: if the role filled since the screen loaded, show "Sorry, this shift is now full" and do not record the application.
- Accepting an overlapping shift is blocked with "You're already booked for an overlapping shift."

**Responsive** — both web apps must work on phone and tablet, not desktop only (§1.2). Suggested behaviour: sidebar collapses to icons then to a drawer under ~1024px; the KPI row wraps 4 → 2 → 1; the potential-pool table becomes stacked cards below ~768px; the line-up grid goes 5 → 3 → 2 columns.

## State Management

Per screen, the state the UI needs:

- **Dashboard** — KPI figures (live, "as of this minute"), week range, financial totals, upcoming-events list. Polling or websocket for "On shift now".
- **Event board** — event + role sections; per role: confirmed / invited / potential / unavailable collections, auto-assign on/off, allocation-per-hour; per candidate: match score and its five-factor breakdown; optimistic invite/withdraw with rollback.
- **Kanban** — candidates grouped by stage, Active/Rejected filter, search. Stage changes arrive from Willo webhooks, so the board must update without a manual refresh.
- **Candidate profile** — phase, per-document review status, AI confidence and needs-manual-review flags, extracted term-date periods (editable list), derived weekly cap (never editable, always computed at point of use).
- **Venues** — list/map tab, search, modal form state (pin lat/lng, reverse-geocoded address, venue type, radius).
- **Staff app** — auth/session, compliance gate (which tabs are open), wizard step + per-step validity, shift list with confirmation state, invite list, live shift (check-in timestamp, break log, chargeable timer), background geolocation stream.
- **Client portal** — event list, selected event, line-up grouped by role. Read-only throughout.

Data fetching: axios against DRF, token auth. The mobile app additionally needs FCM/APNs registration and background geolocation permissions.

## Design Tokens

Four theme files are included. **v1 is the scope-compliant system (§1.6). v2 is a softened variant produced at the client's request in review and deliberately breaks the zero-radius and mono-label rules — confirm which one is being built.**

### Colour

| Role | v1 dark (scope §1.6) | v1 light (warm) | v2 dark | v2 light (warm) |
|---|---|---|---|---|
| Background | `#04080F` | `#F6F1EA` | `#070C16` | `#F6F1EA` |
| Panel / surface | `#0B1220` | `#FFFCF7` | `#111A2B` | `#FFFCF7` |
| Line / divider | `#1C2839` | `#E2D6C7` | `#28354C` | `#E2D6C7` |
| Text | `#E9EEF5` | `#241D16` | `#E9EEF5` | `#241D16` |
| Muted text | `#8A97A3` | `#7A6B5C` | `#8A97A3` | `#7A6B5C` |
| Accent (primary) | `#3EDCEC` | `#0B7A88` | `#3EDCEC` | `#0B7A88` |
| Auto-Assign | `#A879FF` | `#6E45C4` | `#A879FF` | `#6E45C4` |
| Success | `#3DDC97` | `#1F7A4D` | `#3DDC97` | `#1F7A4D` |
| Warning | `#F5B83D` | `#B5730A` | `#F5B83D` | `#B5730A` |
| Danger | `#FF6E61` | `#C2402F` | `#FF6E61` | `#C2402F` |
| Canvas (outside frames) | `#0a0c10` | `#EDE6DC` | `#0a0c10` | `#EDE6DC` |

Notes:
- The light themes are **not** a mechanical inversion. Raw cyan `#3EDCEC` fails contrast on a light ground, so deep teal `#0B7A88` carries the accent role; neutrals are warmed (bone, clay, warm grey) rather than pure grey.
- v2 primary buttons use a gradient: dark `linear-gradient(135deg,#3EDCEC 0%,#8F7BFF 100%)`, light `linear-gradient(135deg,#0B7A88 0%,#7C5CD6 100%)`, both with the background colour as the label.
- Tinted fills are the role colour at 3–15% alpha; tinted borders at 40–50%.
- Status colour coding for ratings (§9.6): 0–2.9 danger · 3.0–3.9 warning · 4.0+ success.

### Typography

| | v1 (scope §1.6) | v2 |
|---|---|---|
| Headings | Space Grotesk, 600–700 | Outfit, 600–800 |
| Body | Inter, 400–600 | Plus Jakarta Sans, 400–700 |
| Labels | IBM Plex Mono, **uppercase**, letter-spacing .08–.14em | Plus Jakarta Sans, sentence case, letter-spacing .01em |

Scale in use: 40px / 34px / 30px / 26px / 24px / 20px / 19px / 17px / 16px / 15px / 14px / 13px / 12px / 11px / 10px / 9px. Body copy is 12–15px at line-height 1.45–1.6. Nothing below 9px, and nothing below 12px for anything a user must read.

### Spacing

4 · 6 · 8 · 10 · 12 · 14 · 16 · 18 · 20 · 22 · 26 · 28 · 32 · 44 · 56. Page gutters 28px (web) / 20px (mobile); card padding 12–20px; section gaps 14–26px.

### Radius

- **v1: 0px everywhere.** Cards, buttons, pills, inputs, nav, stepper, avatars — all square. The circular logo is the only exception (§1.6).
- **v2:** cards/panels 20px · tiles 18px · buttons and inputs 14px · sidebar nav pills 14px · chips, pills, segmented controls and progress tracks 999px · avatars, stepper nodes, radio markers and the logo tile 50% · phone frames 44px · desktop frames 24px. Internal `border-top` divider rows stay flat.

### Elevation and effects

Frosted surfaces (mobile top bar, bottom nav, profile sheet): `background: rgba(panel, .6–.88)` + `backdrop-filter: blur(18–26px)` + 1px divider. Background glows: `radial-gradient(circle, rgba(...,.16–.22), transparent 68%)` on ~320–340px circles, `pointer-events:none`, clipped by the frame. No drop shadows are used anywhere.

## Assets

- `assets/thc-mark.png` — the two-glasses mark, dark ink on transparent. Use on the accent tile in the dark themes.
- `assets/thc-mark-cream.png` — same mark in cream, for the accent tile in the light themes.

Both were extracted and cleaned from a client-supplied PNG. **Ask THC for the original vector** before implementation — these are raster and will not scale cleanly at large sizes or on high-DPI export. One name and one logo across the whole system; no other product name appears anywhere in the UI (§1.6).

Icons: none are drawn in these mocks. Pick one consistent set (Lucide suits the geometry) and apply it at 16–20px in the sidebar, table actions and mobile nav.

Avatars: the onboarding selfie carries through the whole system, square in v1 and circular in v2, falling back to monogram initials on the divider colour.

## Files

| File | What it is |
|---|---|
| `THC Platform Screens.dc.html` | v1 dark — the scope-compliant system (§1.6), square, mono labels |
| `THC Platform Screens Light.dc.html` | v1 light — warm ground, same square geometry |
| `THC Platform Screens v2.dc.html` | v2 dark — softened: rounded, sentence-case labels, gradient primaries |
| `THC Platform Screens v2 Light.dc.html` | v2 light — softened on the warm ground |
| `support.js` | Runtime required by the four HTML files; keep it alongside them |
| `assets/` | The logo marks |

Open any `.dc.html` directly in a browser. Each screen frame carries `data-screen-label` (`BO1 Dashboard`, `BO2 Event board`, `BO3 Onboarding kanban`, `BO4 Candidate profile`, `BO5 Venues`, `M1 Shifts`, `M2 Invites`, `M3 Onboarding wizard`, `M4 On shift`, `M5 Profile sheet`, `CP1 Client Portal event`).

## Not covered by these mocks

Designed elsewhere or still to be designed, all specified in the scope: Compliance queue and expiry radar (§4), Check-in monitor and violation log (§9.5 — the densest operational screen in the product), Staff directory and profile (§9.6), Clients and rate cards (§9.7), Roles and rates (§9.8), Reports, three tabs (§9.9), Feedback (§9.10), the public `/apply` form (§2.1), Radar (§10.4), Documents hub (§10.4), and the timesheet / allocation-sheet PDFs (§11.3).
