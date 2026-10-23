# ADR-0199 · Tickets: the team logs issues, requests and updates from the Back Office

**Status:** Accepted (request of the product owner, 23.10.2026) · an addition to scope v1.6; not in §8 or §9.

## Context

During the test run the team needs somewhere to say "this is broken", "can we have this" or "here is an update" that reaches the owner without anyone retyping it, and that can be tracked afterwards. The product owner's other portal has a top-bar "Feedback" button feeding a triage inbox with numbered reports (FB-64). This is the same for the Back Office. It is **not** `/feedback`, which is §9.10's worker ratings; the word is "ticket" so the two never share a name.

## Decision

- **Report** button in every Back Office top bar (`_components/ReportButton.tsx`, in `OfficeShell`). Kind (bug, request, idea, update, question), optional severity (low to critical), a one-line summary, details, an optional link to a screenshot or recording. The page the person was on is sent with it. Any Back Office login, a Viewer too.
- Each report is a `tickets` row numbered **TK-n** (`ticket_no`, an identity column; `id` stays a uuid). Status: New, In progress, Waiting, Resolved, Closed; Open is the first three.
- `ticket_comments` is the thread: comments and, as `kind = change`, every status or severity change in plain words ("Status: New → In progress").
- `/tickets` (Open / Closed / All, search by number, words or reporter, filters by type, severity and status) and `/tickets/:id` (the thread, status and severity, add an update). Any Back Office login may read and comment; changing status or severity needs `office_can('write')`, so a Viewer cannot.
- **Email (TK1).** A new ticket, and every comment or note, is emailed from admin@ to the addresses in `settings.ticket_recipients` (seeded `["saveezirfan@gmail.com"]`; change the row to change who is told, no release needed). TK1 pins no recipient in the register: the address is on the outbox row, written by the database from that setting, never from the caller (20260922170000). Keys `TK1:ticket:<id>` and `TK1:comment:<comment id>`; switchable under Settings → Notifications. The email names the ticket but carries no link, because the Back Office origin is not in the database and a link is never taken from the caller (20261012120500).
- At most 20 new tickets an hour per login. A ticket is saved even when no usable address is configured.
- Writes are three definer functions (`create_ticket`, `add_ticket_comment`, `update_ticket`); the tables carry one `admin_read` policy and grant no write to any API role. They are on 750's read-only allow-list because reporting and commenting change no business record and must stay open to a Viewer; `update_ticket` asks `office_can('write')` itself.

## Not in this version

Screenshot or recording **upload** (a link is accepted instead: Storage buckets, policies and signed URLs are a separate piece of work), assignee, a menu counter, emailing the reporter, and tickets from the Staff App and Client Portal. All are additions to this table and these functions, not a redesign.
