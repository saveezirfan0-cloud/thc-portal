# ADR-0202 · Tickets: the team logs issues, requests and updates from the Back Office

**Status:** Accepted (request of the product owner, 23.10.2026). **Not part of the Scope of Work.** Tickets are the product owner's own tool for tracking work on the platform; they are not a scope item, are not in §8 or §9, and are never counted as one.

## Context

During the test run the team needs somewhere to say "this is broken", "can we have this" or "here is an update" that reaches the owner without anyone retyping it, and that can be tracked afterwards. The product owner's other portal has a top-bar "Feedback" button feeding a triage inbox with numbered reports (FB-64). This is the same for the Back Office. It is **not** `/feedback`, which is §9.10's worker ratings; the word is "ticket" so the two never share a name.

The product owner also bills for the work, so each ticket must be traceable against the original scope (is it a fix, an update, an issue, something against the scope, or an addition that was never in it?) and the time spent on it must be recorded, by the owner or by Claude, for the month-end bill. Neither is for the office to see.

## Decision

**Reporting**

- **Ticket** button in every Back Office top bar (`_components/ReportButton.tsx`, in `OfficeShell`). Category (bug, request, idea, update, question), optional severity (low to critical), a one-line summary, details, an optional link to a screenshot or recording. The page the person was on is sent with it. **Dictate** buttons on the summary and details use the browser's own speech recogniser (`en-GB`; Chrome, Edge, Safari — Firefox has none and the button says so). The browser sends the audio to its speech service; nothing of ours stores it.
- Each report is a `tickets` row numbered **TK-n** (`ticket_no`, an identity column; `id` stays a uuid). Status: New, In progress, Waiting, Resolved, Closed; Open is the first three.
- A report is **never** labelled by the reporter. The scope label is set afterwards, by the owner, and nothing about it appears on the ticket anyone else reads.

**Following up** (`/tickets`, `/tickets/:id`, laid out as the reference's report panel)

- `/tickets`: Open / Closed / All, search by number, words or reporter, filters by type, severity and status. `/tickets/:id`: **Triage** (status, category, severity, owner), the **Report**, **Context** (who, when in UK time, which page), a **Resolution** note and **Updates**.
- **Updates** are a Note, Email, Call, Meeting or Task, filterable; the status, category, severity and owner changes are lines on the same thread.
- **Replies to the reporter** (20261026090000): when somebody else adds a comment or a note to a ticket, its reporter is emailed (TK1 variant `reply`, key `TK1:reply:<comment id>`, to their own sign-in address; a trigger on `ticket_comments`, so `add_ticket_comment` and `update_ticket`'s note are both covered). Not for their own comments, the status / owner lines, or a resolution note (its own `resolved` email). The owners' list is still emailed every comment (`comment`).
- **Settings → Tickets:** a tab in System settings (owners) that links to `/tickets` and, for a tracker only, to `/tickets/time`.
- **Resolution:** when a ticket is set to Resolved or Closed with a resolution note, the note is kept, shown on the thread and **emailed to the person who reported it** (TK1 variant `resolved`, to their own sign-in address, read by the database, never taken from the caller).
- **Delete this report:** owners only, behind a confirm, and refused (`ticket_has_time`) while any time is logged on it, so a bill can always be traced to its tickets. Close it instead.
- Anyone in the Back Office reads tickets. A **Viewer reads and changes nothing** (ADR-0060): both tables carry the `office_read_only` statement trigger, which keys on the session's user and so refuses a Viewer's insert into `notification_outbox` inside these functions too. Letting a Viewer report would mean weakening that guard for every definer function; an auditor who finds a problem asks an owner to log it. The screens still draw their controls for a Viewer, as everywhere in the Back Office, and the database answers `read_only`.
- At most 20 new tickets an hour per login. A ticket is saved even when no usable address is configured.

**Email (TK1)** — a new ticket, and every comment or note, is emailed from admin@ to the addresses in `settings.ticket_recipients` (seeded `["saveezirfan@gmail.com"]`; change the row to change who is told, no release needed). TK1 pins no recipient in the register: the address is on the outbox row, written by the database, never by the caller (20260922170000). Keys `TK1:ticket:<id>`, `TK1:comment:<comment id>`, `TK1:resolved:<comment id>`; switchable under Settings → Notifications. The email names the ticket but carries no link: the Back Office origin is not in the database and a link is never taken from the caller (20261012120500).

**The owner's own tracking — internal, hidden from everyone else by the database**

- `ticket_scope`: one label per ticket — **Fix**, **Update**, **Issue** (in scope), **Against scope** (contradicts what was agreed), **Addition** (not in the original scope) — with an optional note. Unlabelled is a state of its own ("Not labelled yet"). Set with `set_ticket_scope()` after the ticket exists.
- `ticket_time`: time on a ticket as a **start / stop timer** (one running per login; survives a refresh and another device; shown in the top bar as `TK-12 · 00:12:30`) or a **manual entry** ("15", "1h 30m", "1.5h"), each labelled **Me** or **Claude**, with a day (UK), a note and a **billable** flag that defaults on for Against scope and Addition and can be changed. Starting a timer on a New ticket moves it to In progress; setting the ticket to Waiting, Resolved or Closed stops the owner's own running timer and logs it. Entries can be corrected or removed. 1 minute to 24 hours each.
- `/tickets/time` is the month's time for the bill: billable and total hours, by label, by who worked, and ticket by ticket, with a **CSV** of every entry (`/tickets/time/export`). Timers still running are not counted until stopped.
- **Who may see or keep any of it** is `ticket_tracker_allowed()`: an Owner login whose sign-in email is on `settings.ticket_tracking_emails` (20261026090000: an empty list means nobody; seeded with Sam and Saveez). Both tables' only read policy is that function, so a manager's API call returns nothing; the pill, filter, panel, chip and report are not drawn for anyone else, and `/tickets/time` answers 404. **An owner added later sees no label and no time until they are named in that setting.**
- Claude's time is not logged by Claude from outside the app: the owner starts a timer labelled Claude, or logs the minutes by hand with that label.

**Writes** are definer functions (`create_ticket`, `add_ticket_comment`, `update_ticket`, `assign_ticket`, `set_ticket_kind`, `delete_ticket`, and for tracking `set_ticket_scope`, `start_ticket_timer`, `stop_ticket_timer`, `log_ticket_time`, `update_ticket_time`, `delete_ticket_time`); every table carries RLS and grants no write to any API role.

## Not in this version

Screenshot or recording **upload** and a Files & Docs tab (a link is accepted instead: Storage buckets, policies and signed URLs are a separate piece of work), a menu counter, and tickets from the Staff App and Client Portal. All are additions to these tables and functions, not a redesign.
