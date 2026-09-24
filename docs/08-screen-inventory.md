# 08 · Screen inventory (route → wireframe → scope section)

Every screen the scope names, its route in the app, the wireframe that is its acceptance reference, and the owning bot.

## Public (in `apps/staff`)
| Route | Screen | Wireframe | § | Bot |
|---|---|---|---|---|
| `/apply` | Application form | `public/apply.html` | 2.1, 2.12 | onboarding |
| `/apply/submitted` | Check your inbox | `public/apply.html#state=submitted` | 2.7 | onboarding |
| `/activate/:token` | Set password — E3's personal one-time link; the token is spent on submit, never on page load | `public/activate.html` (`activate`) | 1.4, 2.7, 2.8, 10.2 | onboarding, staff-pwa |
| `/activate/done` | Activated → Install the app | `public/activate.html` (`activated`) | 2.7, 10.5 | staff-pwa |
| `/privacy` | Privacy notice the `/apply` consent links to (placeholder body until THC's legal text) | — (`auth-card`) | 1.7, 2.1 | staff-pwa |

## Back Office (`apps/office`)
| Route | Screen | Wireframe | § | Bot |
|---|---|---|---|---|
| `/login` | Login | `backoffice/login.html` | 1.4 | platform |
| `/dashboard` | Dashboard | `backoffice/dashboard.html` | 9.1 | reports |
| `/onboarding` | Kanban (Active / Rejected) | `backoffice/onboarding.html` | 2.2 | onboarding |
| `/onboarding/:id` | Candidate profile by phase | `backoffice/candidate.html` | 2.3 | onboarding |
| `/events` | List · Calendar month/week/day | `backoffice/events.html` | 3.1 | scheduling |
| `/events/new` | Shift Builder | `backoffice/shift-builder.html` | 3.2 | scheduling |
| `/events/:id/edit` | Shift Builder, same form on a saved event; locked once the event is live, the work moves to the board | `backoffice/shift-builder.html` | 3.2, 9.7 | scheduling |
| `/events/:id` | Event board | `backoffice/event-board.html` | 3.3–3.5, 11.4 | scheduling |
| `/compliance` | Needs review · Radar | `backoffice/compliance.html` | 4.1 | compliance |
| `/compliance/export` | Completion-letter / opt-out audit trail as CSV (route, no screen; admin-only via `audit_log`) | — | completion letter requirement §4 (AC7) | compliance |
| `/checkin` | Live monitor + Violation log | `backoffice/checkin.html` | 9.5 | checkin |
| `/staff` | Directory (All/Compliant/Blocked/Inactive/Removed, Student visa view) | `backoffice/staff.html` | 9.6, 4.5 | directory |
| `/staff/:id` | Profile (Overview/Documents/Client qualification/Shifts/Feedback) | `backoffice/staff-profile.html` | 9.6 | directory, compliance |
| `/clients` | Directory + New client | `backoffice/clients.html` | 9.7 | directory |
| `/clients/:id` | Client card (4 blocks) | `backoffice/client-card.html` | 9.7 | directory |
| `/roles` | Roles & rates | `backoffice/roles.html` | 9.8 | directory |
| `/reports` | Financial · Payroll · New Starter | `backoffice/reports.html` | 9.9 | reports |
| `/reports/export` | Export CSV per tab (route, no screen; same builders as the Monday send, held No check-outs left out) | — | 9.9 | reports |
| `/feedback` | Client · Office | `backoffice/feedback.html` | 9.10 | client-portal |
| `/venues` | List · On map · modal | `backoffice/venues.html` | 9.11 | directory |
| `/settings` | Scoring weights, Willo map, venue radii, senders (Django-Admin replacement) | — (simple form) | 6, 2.4, 9.11, 9.12 | platform |
| `/design-system` | Live component gallery (both token axes) | `design-system.html` | 1.6, 10.1 | design-system |

## Staff App PWA (`apps/staff`)
| Route | Screen | Wireframe | § | Bot |
|---|---|---|---|---|
| `/login`, `/forgot`, `/forgot/sent`, `/reset` | A0–A3 (A2 "Check your inbox" answers the same for an unknown address, §1.7) | `staff/auth.html` | 10.2 | staff-pwa |
| `/install`, `/notifications` | Install + push permission | `staff/auth.html` | 10.5 | staff-pwa |
| `/offline` | Offline shell, precached by the service worker | — | 10.5, ADR-0001 | staff-pwa |
| `/onboarding/1…11` | Wizard — step 1 collects gender since `20260926100300` (§9.9 Tab 3), step 2 stores the postcode and country | `staff/onboarding-1.html`, `-2`, `-3` | 10.3, 2.5–2.11, 9.9 | onboarding |
| `/documents` | Documents hub / tab | `staff/onboarding-3.html`, `staff/documents.html` | 10.4 | compliance |
| `/documents/upload/:docType` | Upload / re-upload one document — where the row's Upload and N8's Re-upload deep link land; `share_code_report` reads "New share code" | `staff/documents.html` | 10.4, 4.1, 2.6 | compliance |
| `/documents/completion-letter` | Official University Completion Letter upload (Student / Tier 4 only) | `staff/documents.html` | 4.5, completion letter requirement §2.1 | compliance |
| `/documents/opt-out` | 48-hour opt-out — sign / cancel with notice; never offered under 18 | `staff/documents.html` | completion letter requirement §2.4 | compliance |
| `/documents/declare` | Declare a criminal conviction (`declare_my_conviction()`) | `staff/documents.html` | 10.7 | compliance |
| `/shifts` | My shifts · Open shifts | `staff/shifts.html` | 10.4, 3.5 | scheduling |
| `/shifts/:id` | Shift detail, check-in/out, breaks, static screens | `staff/shift-detail.html` | 5.1–5.2b, 10.4 | checkin (see note) |
| `/radar` | Radar | `staff/radar.html` | 10.4 | scheduling |
| `/invites`, `/invites/:id` | Invites | `staff/invites.html` | 10.4, 3.4 | scheduling |
| (sheet) | Profile sheet | `staff/profile.html` | 10.1 | staff-pwa |
| `/profile`, `/security`, `/payments` | Profile details, Security, Payment information | `staff/profile.html` | 10.1 | staff-pwa |
| (flow) | Request my P45 → leaver screen | `staff/profile.html` | 10.6 | staff-pwa |
| (lock) | Doc block · Manual hold · Quiz failed · Leaver | `staff/locks.html` | 10.1 | staff-pwa |

> **Note · `/shifts/:id` is the one route two bots share.** `checkin` owns the
> route and everything §5 puts on it: the map, the geofence, check-in and
> check-out, the breaks block and the chargeable-so-far counter — including
> the "No check-out" static screen (RULE-02), which it already renders in
> §10.4's own words. `scheduling` owns the two remaining §10.4 static
> screens, for a cancelled event (N12) and a withdrawn booking (N10b), and
> **they are not built yet**: they need `events.cancelled_at` and
> `bookings.cancel_cause` on that screen's `ShiftDetail`. The rule and the
> approved copy for all three live in `packages/domain/src/staff.ts`
> (`staticScreenCase`, `STATIC_SCREEN_COPY`), tested, so wiring them is a
> two-column select and one branch rather than a second copy of the copy.

## Client Portal (`apps/client`)
| Route | Screen | Wireframe | § | Bot |
|---|---|---|---|---|
| `/login` | Login | `client/login.html` | 1.4 | platform |
| `/client` | Event list | `client/events.html` | 11.1 | client-portal |
| `/client/events/:id` | Event page + feedback popup | `client/event.html` | 11.2, 11.5 | client-portal |
| `/client/events/:id/document` (`?kind=allocation\|signout`) | Download Allocation Sheet · Download Signed Timesheet — newest stored copy through `client_event_documents_v` (ADR-0004), a one-minute signed link; another customer's event is a 404 | `client/timesheet.html` | 11.2, 11.3 | client-portal (route), reports (PDF) |
| (PDF) | Allocation sheet · Sign-out timesheet | `client/timesheet.html` | 11.3 | reports |
