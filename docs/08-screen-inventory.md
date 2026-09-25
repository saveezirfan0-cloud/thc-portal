# 08 · Screen inventory (route → wireframe → scope section)

Every screen the scope names, its route in the app, the wireframe that is its acceptance reference, and the owning bot.

## Public (in `apps/staff`)
| Route | Screen | Wireframe | § | Bot |
|---|---|---|---|---|
| `/apply` | Application form | `public/apply.html` | 2.1, 2.12 | onboarding |
| `/apply/submitted` | Check your inbox | `public/apply.html#state=submitted` | 2.7 | onboarding |
| `/activate`, `/activate/:token`, `/activate/done` | Set password → Activated → Install the app | `public/activate.html` | 2.7 | onboarding, staff-pwa |
| `/privacy` | Privacy notice (placeholder until THC's legal text) | — | 1.7 | design-system |

## Back Office (`apps/office`)
| Route | Screen | Wireframe | § | Bot |
|---|---|---|---|---|
| `/login` | Login (a non-admin account gets the generic refusal) | `backoffice/login.html` | 1.4 | platform |
| `/login/verify` | Two-step sign-in code step: after email + password, a login with a verified authenticator types its 6-digit code; `next` carried through. States: code form, wrong / expired code, too many attempts, no session (→ `/login`), already verified (→ `next`), a factor this screen cannot challenge, Not you? Sign out | — (ADR-0037) | 1.4 | platform |
| `/login/forgot`, `/login/forgot/sent`, `/login/reset` | Forgot password → Reset link sent → Set new password (A1–A3, from `admin@`) | `backoffice/login.html#state=forgot`, `#state=sent` | 10.2, 9.12 | platform |
| `/forgot`, `/forgot/sent`, `/reset` | A1 Forgot password → A2 Reset link sent → A3 Set new password (+ link expired) | `backoffice/login.html` (forgot, sent) · `public/activate.html` (reset) | 10.2 | platform |
| `/dashboard` | Dashboard | `backoffice/dashboard.html` | 9.1 | reports |
| `/onboarding` | Kanban (Active / Rejected) | `backoffice/onboarding.html` | 2.2 | onboarding |
| `/onboarding/:id` | Candidate profile by phase | `backoffice/candidate.html` | 2.3 | onboarding |
| `/events` | List · Calendar month/week/day | `backoffice/events.html` | 3.1 | scheduling |
| `/events/new`, `/events/:id/edit` | Shift Builder (`/events/new?from=<id>` opens it as Duplicate: roles copied, no staff, date blank) | `backoffice/shift-builder.html` | 3.2 | scheduling |
| `/events/:id` | Event board | `backoffice/event-board.html` | 3.3–3.5, 11.4 | scheduling |
| `/compliance` | Needs review · Radar | `backoffice/compliance.html` | 4.1 | compliance |
| `/compliance/export` | Completion-letter audit trail (CSV download) | — | completion letter req. §4 | compliance |
| `/checkin` | Live monitor + Violation log | `backoffice/checkin.html` | 9.5 | checkin |
| `/staff` | Directory (All/Compliant/Blocked/Inactive/Removed, Student visa view) | `backoffice/staff.html` | 9.6, 4.5 | directory |
| `/staff/:id` | Profile (Overview/Documents/Client qualification/Shifts/Feedback). Documents: Verify / Reject on every document or Yes declaration this worker has on Needs review (Confirm date on an `rtw_date` row) — the `/compliance` actions and dialogs (`compliance/ReviewDialogs.tsx`), not a copy; none on a Rejected/Removed worker (§4.1) | `backoffice/staff-profile.html` | 9.6 | directory, compliance |
| `/clients` | Directory + New client | `backoffice/clients.html` | 9.7 | directory |
| `/clients/:id` | Client card (4 blocks) | `backoffice/client-card.html` | 9.7 | directory |
| `/roles` | Roles & rates | `backoffice/roles.html` | 9.8 | directory |
| `/reports`, `/reports/export` | Financial · Payroll · New Starter, CSV export | `backoffice/reports.html` | 9.9 | reports |
| `/api/documents/:eventId`, `/api/documents/:eventId/send` | Allocation sheet / sign-out timesheet PDF: Download and Send are two handlers | `client/timesheet.html` | 11.3–11.4 | reports |
| `/api/jobs/rtw-check` | Not a screen: the automated gov.uk right-to-work check job, POSTed by pg_cron with a bearer secret (ADR-0025). Its outcomes show on `/onboarding/:id`, `/staff/:id` Documents and `/compliance` | — | 2.3, 2.6 | compliance |
| `/feedback` | Client · Office | `backoffice/feedback.html` | 9.10 | client-portal |
| `/venues` | List · On map · modal | `backoffice/venues.html` | 9.11 | directory |
| `/settings` | Scoring weights, Willo map, venue radii, senders (Django-Admin replacement) | — (simple form) | 6, 2.4, 9.11, 9.12 | platform |
| `/users` | Users & access: every login by app, Invite a Back Office or Client Portal user (one-time set-up link), switch a login off/on, new invite link. States: empty tab, search with no match, invite link shown once, switch-off needs a reason, own row has no Switch off | — (ADR-0035) | 1.4, 1.7 | platform |
| `/activity` | Activity log: `audit_log` newest first with who / what / record / details, filters by area, person, text and period, paging by 50. States: empty period, no match, System entries | — (ADR-0035) | 1.7, 1.8 | platform |
| `/activity/export` | Activity log as CSV (the "Export CSV" button on /activity): the same filters from the query string (not the page), newest first, BOM, When (UK time) · Who · Action · Area · Record · Details; stops at 10,000 rows and says so on the last line; 401/403 without an admin session | — (ADR-0035) | 1.7, 1.8 | platform |
| `/account` | My profile: name, job title, phone; sign-in email change (confirmation link); password change (current password checked); sign out other devices; appearance | — (ADR-0035) | 1.4, 10.2 | platform |
| `/design-system` | Live component gallery (both token axes) | `design-system.html` | 1.6, 10.1 | design-system |

## Staff App PWA (`apps/staff`)
| Route | Screen | Wireframe | § | Bot |
|---|---|---|---|---|
| `/login`, `/forgot`, `/forgot/sent`, `/reset` | A0–A3 | `staff/auth.html` | 10.2 | staff-pwa |
| `/install`, `/notifications`, `/offline` | Install + push permission; offline fallback | `staff/auth.html` | 10.5 | staff-pwa |
| `/onboarding`, `/onboarding/:step` | Wizard, 11 steps. `/onboarding` resolves where the worker is and sends them on; each step really is its own path segment (`apps/staff/app/onboarding/[step]/page.tsx`). | `staff/onboarding-1.html`, `-2`, `-3` | 10.3, 2.5–2.11 | onboarding |
| `/documents` | Documents hub / tab | `staff/onboarding-3.html`, `staff/documents.html` | 10.4 | compliance |
| `/documents/upload/:docType` | Upload / re-upload a document | `staff/documents.html` | 10.4 | compliance |
| `/documents/completion-letter` | University completion letter (three forms) | `staff/documents.html` | completion letter req. §2.1 | compliance |
| `/documents/opt-out` | 48-hour opt-out: sign / give notice | `staff/documents.html` | RULE-20, completion letter req. §2.4 | compliance |
| `/documents/declare` | Declare a criminal conviction | `staff/documents.html` | 10.7 | compliance |
| `/shifts` | My shifts · Open shifts | `staff/shifts.html` | 10.4, 3.5 | scheduling |
| `/shifts/:id` | Shift detail, check-in/out, breaks, static screens, strict-buffer turn-away ("Thanks for coming", (m)) | `staff/shift-detail.html` | 5.1–5.2b, 10.4, 3.2 | checkin (see note) |
| `/radar`, `/radar/:id` | Radar, and one shift's detail before applying | `staff/radar.html` | 10.4 | scheduling |
| `/invites`, `/invites/:id` | Invites | `staff/invites.html` | 10.4, 3.4 | scheduling |
| (sheet) | Profile sheet | `staff/profile.html` | 10.1 | staff-pwa |
| `/profile`, `/profile/details`, `/profile/security`, `/profile/payments` | Profile sheet, Profile details, Security, Payment information | `staff/profile.html` | 10.1 | staff-pwa |
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
>
> The §3.2 strict-buffer turn-away is `checkin`'s too: a booking that
> `attempt_check_in()` turned away shows "Thanks for coming" (wireframe (m),
> `TurnedAwayScreen.tsx`) immediately after the press and on every visit
> after it. The sentence "We've logged that you arrived on time and you'll
> be paid for 4 hours." appears only when `staff_shift_detail()`'s
> `turned_away_pay_min` (RULE-15, SQL's `turned_away_minutes()` over the
> logged attempt) is 240; a late turn-away (0) never sees it. Copy and rule:
> `TURNED_AWAY_COPY` / `turnedAwayMessage()` in `packages/domain/src/staff.ts`.

## Client Portal (`apps/client`)
| Route | Screen | Wireframe | § | Bot |
|---|---|---|---|---|
| `/login` | Login | `client/login.html` | 1.4 | platform |
| `/forgot`, `/forgot/sent`, `/reset` | A1 Forgot password → A2 Reset link sent → A3 Set new password (+ link expired). The wireframe's address bar says `/forgot-password`; `/forgot` matches the other two apps | `client/login.html` (forgot) · `public/activate.html` (reset) | 10.2 | platform |
| `/client` | Event list | `client/events.html` | 11.1 | client-portal |
| `/client/events/:id` | Event page + feedback popup | `client/event.html` | 11.2, 11.5 | client-portal |
| `/client/events/:id/document` | Allocation sheet · Sign-out timesheet (latest final copy, ADR-0004) | `client/timesheet.html` | 11.3 | reports |
