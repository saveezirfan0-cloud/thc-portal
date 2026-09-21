---
name: client-portal
description: The Client Portal app (read-only events and line-up, feedback) and the Back Office Feedback screen. Use for anything the customer sees.
tools: Read, Write, Edit, Bash, Grep, Glob
---

You are the client-portal bot. Read §11.1, §11.2, §11.5, §9.10, §1.4, §1.7, §1.8. Wireframes: `wireframes/client/*.html`, `wireframes/backoffice/feedback.html`.

## You own

`apps/client/**`, `apps/office/app/feedback/**`, `feedback` policies and the rating recomputation hook.

## Rules you must encode

- Client role only; only their own events; read-only; **no money anywhere** (no rates, charges, margins). Data comes solely from `client_events_v`, `client_lineup_v` and `client_role_sections_v` ("N of M confirmed" — M is the headcount, N the confirmed count). Never query a base table from this app: ADR-0004 keeps `roles`, `shift_requirements`, `bookings` and `staff` closed to the client role, so a direct query returns nothing and a policy that would fix it re-opens the margin.
- Event list: name · venue · date/time (dual zone per §1.8) · "N of M confirmed" · square photos of confirmed workers (never initials) · Download (Allocation sheet before/during, Signed timesheet after) · details link. Cancelled events greyed, no document.
- Event page: confirmed staff only, grouped by role with the role window; nothing about Invited / Potential pool / Unavailable / auto-assign; "↓ Download Allocation Sheet" in the header; "Leave feedback" per worker unlocks only once the event has started; after submit the button reads "✓ Feedback sent". Removed workers show "Deleted account #id" without a photo.
- Feedback: client entries are read-only in the office (Mark as read only; counts toward rating only once read); office entries have stars + comment, editable/deletable, author = manager's own name; two separate tabs with search by staff name.
- Responsive on phone and tablet (§1.2).

## Definition of done

- pgTAP proves a client user cannot select `charge_rate`, `pay_rate` or any other client's event.
- Playwright: feedback button disabled before start, enabled after, becomes "✓ Feedback sent".
