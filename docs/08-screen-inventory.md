# 08 · Screen inventory (route → wireframe → scope section)

Every screen the scope names, its route in the app, the wireframe that is its acceptance reference, and the owning bot.

## Public (in `apps/staff`)
| Route | Screen | Wireframe | § | Bot |
|---|---|---|---|---|
| `/apply` | Application form | `public/apply.html` | 2.1, 2.12 | onboarding |
| `/apply/submitted` | Check your inbox | `public/apply.html#state=submitted` | 2.7 | onboarding |
| `/activate` | Set password → Activated → Install the app | `public/activate.html` | 2.7 | onboarding, staff-pwa |

## Back Office (`apps/office`)
| Route | Screen | Wireframe | § | Bot |
|---|---|---|---|---|
| `/login` | Login | `backoffice/login.html` | 1.4 | platform |
| `/dashboard` | Dashboard | `backoffice/dashboard.html` | 9.1 | reports |
| `/onboarding` | Kanban (Active / Rejected) | `backoffice/onboarding.html` | 2.2 | onboarding |
| `/onboarding/:id` | Candidate profile by phase | `backoffice/candidate.html` | 2.3 | onboarding |
| `/events` | List · Calendar month/week/day | `backoffice/events.html` | 3.1 | scheduling |
| `/events/new`, `/events/:id/edit` | Shift Builder | `backoffice/shift-builder.html` | 3.2 | scheduling |
| `/events/:id` | Event board | `backoffice/event-board.html` | 3.3–3.5, 11.4 | scheduling |
| `/compliance` | Needs review · Radar | `backoffice/compliance.html` | 4.1 | compliance |
| `/checkin` | Live monitor + Violation log | `backoffice/checkin.html` | 9.5 | checkin |
| `/staff` | Directory (All/Compliant/Blocked/Inactive/Removed, Student visa view) | `backoffice/staff.html` | 9.6, 4.5 | directory |
| `/staff/:id` | Profile (Overview/Documents/Client qualification/Shifts/Feedback) | `backoffice/staff-profile.html` | 9.6 | directory, compliance |
| `/clients` | Directory + New client | `backoffice/clients.html` | 9.7 | directory |
| `/clients/:id` | Client card (4 blocks) | `backoffice/client-card.html` | 9.7 | directory |
| `/roles` | Roles & rates | `backoffice/roles.html` | 9.8 | directory |
| `/reports` | Financial · Payroll · New Starter | `backoffice/reports.html` | 9.9 | reports |
| `/feedback` | Client · Office | `backoffice/feedback.html` | 9.10 | client-portal |
| `/venues` | List · On map · modal | `backoffice/venues.html` | 9.11 | directory |
| `/settings` | Scoring weights, Willo map, venue radii, senders (Django-Admin replacement) | — (simple form) | 6, 2.4, 9.11, 9.12 | platform |

## Staff App PWA (`apps/staff`)
| Route | Screen | Wireframe | § | Bot |
|---|---|---|---|---|
| `/login`, `/forgot`, `/reset-sent`, `/reset` | A0–A3 | `staff/auth.html` | 10.2 | staff-pwa |
| `/install`, `/notifications` | Install + push permission | `staff/auth.html` | 10.5 | staff-pwa |
| `/onboarding/1…11` | Wizard | `staff/onboarding-1.html`, `-2`, `-3` | 10.3, 2.5–2.11 | onboarding |
| `/documents` | Documents hub / tab + declare conviction | `staff/onboarding-3.html`, `staff/documents.html` | 10.4, 10.7 | compliance |
| `/shifts` | My shifts · Open shifts | `staff/shifts.html` | 10.4, 3.5 | scheduling |
| `/shifts/:id` | Shift detail, check-in/out, breaks, static screens | `staff/shift-detail.html` | 5.1–5.2b | checkin |
| `/radar` | Radar | `staff/radar.html` | 10.4 | scheduling |
| `/invites`, `/invites/:id` | Invites | `staff/invites.html` | 10.4, 3.4 | scheduling |
| (sheet) | Profile sheet | `staff/profile.html` | 10.1 | staff-pwa |
| `/profile`, `/security`, `/payments` | Profile details, Security, Payment information | `staff/profile.html` | 10.1 | staff-pwa |
| (flow) | Request my P45 → leaver screen | `staff/profile.html` | 10.6 | staff-pwa |
| (lock) | Doc block · Manual hold · Quiz failed · Leaver | `staff/locks.html` | 10.1 | staff-pwa |

## Client Portal (`apps/client`)
| Route | Screen | Wireframe | § | Bot |
|---|---|---|---|---|
| `/login` | Login | `client/login.html` | 1.4 | platform |
| `/client` | Event list | `client/events.html` | 11.1 | client-portal |
| `/client/events/:id` | Event page + feedback popup | `client/event.html` | 11.2, 11.5 | client-portal |
| (PDF) | Allocation sheet · Sign-out timesheet | `client/timesheet.html` | 11.3 | reports |
