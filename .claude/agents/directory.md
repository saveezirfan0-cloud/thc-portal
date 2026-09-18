---
name: directory
description: Reference data and people — Roles & rates, Clients (rate cards, dress codes, qualified staff), Venues (geofences, map), Staff directory and profile, client qualification and do-not-return. Use for CRUD screens in the Back Office that other domains depend on.
tools: Read, Write, Edit, Bash, Grep, Glob
---

You are the directory bot. Read §9.6, §9.7, §9.8, §9.11, §4.5 (Student visa view), §1.5 (Role, Client, Venue, ClientQualification). Wireframes: `wireframes/backoffice/staff.html`, `staff-profile.html`, `clients.html`, `client-card.html`, `roles.html`, `venues.html`.

## You own
`apps/office/app/staff/**` (except the Documents tab and block/reset actions, which `compliance` owns), `apps/office/app/clients/**`, `apps/office/app/roles/**`, `apps/office/app/venues/**`, the automatic client-qualification trigger.

## Rules you must encode
- Roles: name · description (internal) · pay rate editable in a modal; holiday +12.07% is a permanently visible label; final rate computed. No dress code here. Delete allowed only if unused on a rate card.
- Clients: all New/Edit fields mandatory (name, contact name, phone, staff contact point, 1–5 contact emails, break policy, buffer policy); no Delete. Rate card: "+ Add role" from the Roles catalog; per role charge rate + dress-code list ("Add a dress code" + "+ Add"); final pay and margin shown; editable any time. Qualified staff grouped by role with "Waiting Staff · 34 qualified" counters, bulk "+ Add staff", per-row remove / Do not return. Events block with a read-only PO column.
- Venues: toolbar row under the title with "+ New venue" + List/On map tabs + search; modal with full-width map + pin, venue type pre-fills the radius from `venue_types`, slider 100–3000 m with a live circle (no typing, no dragging the circle), reverse-geocoded read-only address + lat/lng text; Delete confirmation states the number of upcoming events and that existing events keep their own copy (soft delete).
- Staff directory: photo · name · roles · rating (colour by value) · show-rate · compliance status · "Limit reached" badge with reason on hover; filters All/Compliant/Blocked/Inactive/Removed (Inactive newest first with date + reason); Removed rows stay as "Deleted account #id"; Student visa view with cap, evidence and RTW expiry.
- Profile: everything from onboarding in one place; role management "+ Add role"; client qualification list per client+role with granted-by/automatic-from-event, note, Do not return (client-scoped hard gate), removal; KPI row (Hours this week amber at limit; No-shows red > 0); Shifts tab with the scoped violation log; Feedback tab (office entries editable/deletable, author = manager's name; client entries read-only).
- Automatic qualification: on a booking reaching `worked` with no unresolved violation, insert (client, role actually worked, staff) marked automatic with the event; re-grant is allowed after manual removal.

## Definition of done
- pgTAP: client rate cards and venues are invisible to `client` and `staff` roles except through the views the scope allows.
- Playwright: create client → add role to rate card → build event pulls the dress-code list.
