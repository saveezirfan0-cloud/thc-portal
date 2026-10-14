# ADR-0135 · Client Portal round 4: named arrivals on the day, "Request again", and two client emails

**Status:** Accepted (product owner, 14.10.2026 — "Named arrivals on the day" and "Request again / notifications", proposals P1–P3 in `docs/20-release-audit-2026-10-14.md`, Part B) · **Builds on:** ADR-0004, ADR-0026 (the client reads only through owner-rights `client_*` views), ADR-0020 (the outbox and its drain), ADR-0053 (arrival counts), ADR-0074 / ADR-0088 (the Allocation Timesheet), ADR-0089 (recipients per event), ADR-0134 (the line-up stops at the headcount) · **Departs from:** ADR-0053's "counts only" (§1 below is the separate ADR it asked for); §11.1's "read-only — no editing whatsoever" for one message to THC (§2); §8, which has no client email but the two documents (§3)

The hard lines do not move. There is no money anywhere. Every client read is an owner-rights `client_*` view that filters by `client_portal_visible()` in its own body and names its columns. No table gains a client policy (`001_rls_guard` still pins the empty set). The portal never writes a booking, a qualification or any staffing state.

## 1 · Named arrivals on the day

### Context
ADR-0053 gave the customer "11 of 13 arrived" during the event and nothing per person, and said that "who is still missing" would need its own ADR. At 08:30 the customer's first question is who has not arrived. Today the answer is a phone call. The product owner approved the named version on 14.10.2026.

### Decision
- **In the view** (`20261014170000_client_named_arrivals.sql`). `client_lineup_v` gains two columns, appended:
  - `arrival_status`: `arrived` | `expected` | `not_arrived`;
  - `arrived_at`: the first check-in time of an `arrived` row.
- **What each state means.**
  - `arrived`: a `checked_in` check-log with a check-in time (the worker's own, on time or Late, or the office's "Get back", §9.5), or a booking already `worked`. This is exactly what takes a seat first under ADR-0134 and what `client_arrivals_v` counts, so the names and "N of M arrived" agree. An out-of-radius press is not an arrival.
  - `not_arrived`: no check-in 30 minutes after the **role section's own start** (RULE-18). That is the moment §9.5 marks a No-show and locks the check-in button.
  - A booking confirmed **after** the section started (a late replacement, §3.4) is exempt from that lock (§9.5, confirmed 01.09.2026), so it stays `expected` until the end.
  - `expected`: everyone else.
- **When.** Both columns are null unless all of these hold:
  - the event is live (`now()` between its window's start and end, the same test `client_arrivals_v` and `event_status()` use);
  - it is not cancelled;
  - the row holds a seat (`seat <= headcount`). A worker kept visible only because the customer rated them (ADR-0134 §1) is outside the trimmed line-up and gets nothing.
- **What the customer reads** (`arrivalState` in `rules.ts`), under each name on the event page:
  - **"Arrived 08:52"**: the check-in is an actual stamp, so it is written in the viewer's own zone and nothing else (§1.8), 24-hour.
  - **"Not here yet"**: once the person's section has started. Before that the row says nothing, as the per-role "N of M arrived" pill already hides itself (RULE-18).
  - **"Not arrived"**: from start + 30 minutes. The hover note says "Not checked in 30 minutes after the start. THC can see this too — call THC if you need to talk about cover." That is true: the office's board flags a worker not checked in, and §9.5 records the No-show. The customer is told the fact at their door, never the office's record.
- **Accessible.** The words carry the state, and the dot only repeats it (filled, hollow, square). A visually hidden sentence names the person ("Tom Hale: not arrived"). The state is never told by colour alone.
- **The list keeps counts.** The event page asks for the two columns (`EVENT_LINEUP_COLUMNS`) and the list never does, so no name-and-state pair reaches the list's props. The print stylesheet leaves the states off, because paper goes stale.

### Privacy
- **What is new to the customer.** Per person, during the event only: whether they have checked in, and when. Before this ADR, a one-person section, or a section reading 0 of N or N of N, already told them that (ADR-0053 §2). This makes it explicit for every section.
- **Why it is proportionate.** It is what the customer's own host at the door sees for themselves: the worker in front of them, at that time. The customer needs it to run their event (who to wait for, when to call THC). Workers already know their name and face are shown to the client they are booked with (§11.2).
- **What it never says:**
  - "Late" or "No-show", minutes late, or any violation. Those are the office's records, with pay and show-rate consequences (§9.5, §9.6), and they can be reclassified ("Get back");
  - where anyone is: no location, distance, accuracy, geofence result or attempt count. The location trail is the office's (§5.2b), and no `client_*` view has such a column (pgTAP 831 asserts it);
  - when anyone left, or any check-out;
  - anything about a buffer worker past the headcount, or a worker the customer cannot see.
- **It never becomes a record.** The columns are null before the event, after its end and for a cancelled event. After the event, nothing tells the customer who arrived when. The signed timesheet (§11.3), which THC issues deliberately, is the record of the day. Polling during the event can date a check-in to the minute, but `arrived_at` already gives the minute, at the door's own precision.
- **Removed workers** (§1.7) read "Deleted account #id" as before. Their state is shown during the live window like anyone's, because the slot is still filled or not.
- **Tenancy** is the view's, as for every column: `client_portal_visible(e.client_id)` in its own body. pgTAP 831 checks:
  - another customer, a worker and a client login with no company see nothing;
  - nothing is shown outside the window, for a cancelled event, or for an unseated row;
  - the admin reads the same definition.

### Consequences
- `client_lineup_v` has been restated again (`050`, `831`). `815`, `817` and `809` still hold its other columns and their rules.
- ADR-0053's last paragraph ("a future request … needs its own ADR") is answered by this section. `client_arrivals_v` is unchanged.

## 2 · "Request this person again"

### Context
After a good event the customer wants the same people next time. Today that is an email nobody files. §11.1 says the portal is read-only. A request is a message to THC, not an edit of anything THC holds, so the product owner approved it as one recorded exception (P1).

### Decision
- **Where.** On a finished event (by the clock as well as the status, and never when cancelled), every person on the line-up except a removed account gets **"Request again"** beside "Leave feedback".
  - It opens a small dialog: the face, the role and event, and one sentence saying it books nobody and changes nothing on this event.
  - There is an optional **note to THC** of at most 500 characters, counted as the database counts them.
  - **Send request to THC** sends it.
- **One write path: `client_request_worker(p_booking_id, p_note)`** (`20261014170100_client_worker_requests.sql`). It is SECURITY DEFINER and granted to authenticated only. It refuses, in this order:
  1. anyone but a client login (42501);
  2. a note over 500 (22023 `request_note_too_long`);
  3. a booking that is not on the caller's visible line-up, or is on a cancelled event: one sentence for all of them (42501). The function reads `client_lineup_v` itself, so tenancy, the confirmed status and ADR-0134's headcount trim are the view's own rules, and a buffer worker the customer never saw cannot be asked for;
  4. an event not yet finished (22023 `request_after_event`);
  5. a GDPR-removed worker (22023 `worker_removed`).
- **What it writes.**
  - An open request for the same client and worker answers `{already: true}` and writes nothing. The dialog then says **"Already requested — THC has it."**
  - Otherwise it writes **one `client_worker_requests` row** and queues **CP1** through `notification_outbox` (key `CP1:request:<id>`).
  - It refuses a 21st request from the same company within 24 hours (P0001 `request_limit_reached`).
  - The dedupe and the count run under a per-client advisory lock.
  - It never touches bookings, client qualifications or any staffing state (pgTAP 832 counts both tables before and after).
- **The table.** `client_worker_requests`:
  - RLS on, `admin_read` only, no client or staff policy (ADR-0026; `001_rls_guard` now lists 61 tables);
  - the `office_read_only` guard (ADR-0060);
  - a partial unique index for one open request per client and worker.
- **What the customer sees afterwards.**
  - `client_lineup_v.worker_requested` is true while an open request exists for that worker, so every row of theirs, on any event, reads **"✓ Requested"** (`aria-disabled`, named for the person).
  - The open requests are listed under **"People you've asked for again"** on `/client/feedback`: name, role, the event it was asked from, the date and the customer's own note.
  - That list reads a new owner-rights view, **`client_worker_requests_v`**:
    - named columns, no staff id;
    - `client_portal_visible()` in its body;
    - SELECT to authenticated only;
    - the name reads "Deleted account #id" and the note is withheld once the worker is removed, as `feedback_text` is.
  - `001_rls_guard` now pins nineteen owner-rights views (sixteen selectable), and `docs/14-handover.md` counts 16.
- **CP1, to the office** (`packages/notifications`, `CLIENT_PORTAL_CODES`):
  - an email to admin@ from admin@, like every office notice;
  - subject: "Client asked for a worker again — {name} · {client}";
  - it names the worker and their Employee ID, the event, its date and the role, the client's note, who pressed it (portal name and sign-in email) and when (UK);
  - it ends "This is a request, not a booking";
  - it is listed in `/inbox` (`OFFICE_INBOX`) and can be switched off on `/settings → Notifications`, while the request still reaches the client card.
- **The office's side: the client card.** This was the lowest-friction place: the office already decides there who is qualified for this client. A **Requests from the Client Portal** block sits before Events:
  - open requests first, then the latest handled;
  - the worker (linked to their profile), the event and role, the note, who asked and when;
  - **Mark handled** (`mark_client_worker_request_handled`: admin only, a viewer refused by the read-only guard, idempotent).
  - Handling is audited by an AFTER UPDATE trigger in the shape of 20261014093200. The action is `client.worker_request_handled`, filed under the client so it appears in the card's History, with ids only in `data`.
  - The office reads through `clients_worker_requests_v` (security_invoker, so the admin's own policies apply).
  - Once handled, the request leaves the customer's list, and the customer may ask again.

### Consequences
- The client role's writes are now two RPCs (`submit_client_feedback`, `client_request_worker`) plus its own password. It still holds no table policy.
- `client_lineup_v` is restated with `worker_requested` (`050`, `832`).
- A worker removed after a request: the open request stays for the office to close, shown as "Deleted account #id". The note is kept verbatim for the office, as feedback text is (§1.7).

## 3 · Two emails to the customer: "fully confirmed" and "changed after the Allocation Timesheet"

### Context
§8 sends the customer two things only: the Allocation Timesheet and the Completed Allocation Timesheet. A customer learns that their line-up is complete, or that it changed after the sheet went, only by opening the portal or by phoning. The product owner approved two emails (P3).

### Decision
- **Two register entries** (`packages/notifications`, `CLIENT_PORTAL_CODES`), both from admin@:
  - **CP2 · "Your line-up is fully confirmed — {event} · {date}"**. Sent once per event, when every role section of an **upcoming** event holds its headcount of confirmed workers.
  - **CP3 · "Line-up changed after your Allocation Timesheet was sent — {event} · {date}"**. Sent when a confirmed worker leaves the line-up (withdrawn, cancelled, released at the cut-off) or a new one is confirmed, on an upcoming event whose Allocation Timesheet has already been queued (`event_documents` kind `allocation` with `queued_at`, sent by the office or automatically, ADR-0074/0088).
- **Content.** Values only:
  - the event's title, UK date, UK window and venue;
  - one line per role section: "Waiting Staff · 17:00–23:30 · 4 of 4 confirmed". The count is the portal's: confirmed or worked, held to the headcount, so THC's buffer never appears;
  - a **"See who is coming" / "See the current line-up"** button to `/client/events/:id`.
  
  The emails carry no worker names and no money. pgTAP 833 and `templates.test.ts` check both.
- **Recipients.** The event's timesheet recipients, `coalesce(events.document_recipients, clients.contact_emails)`. This is `event_document_recipients()` (ADR-0089) to the letter. A Client Portal login is not a recipient unless its address is on that list. The recipients are written on the outbox row; the register names none for these two codes.
- **Triggered in the database** (`20261014170200_client_lineup_emails.sql`):
  - one internal function, `client_lineup_notices(event, change?, now)`, called by AFTER triggers on `bookings` (status into or out of confirmed / worked; worked from confirmed is not a change) and `shift_requirements` (a section added or removed, or a headcount changed, which can make or unmake "fully confirmed" but is not a change of who is coming);
  - the function takes its clock as a parameter, so pgTAP holds the quiet hours and the debounce;
  - a failure inside it is a WARNING and never blocks the booking change that set it off.
- **Unique keys and timing:**
  - **CP2: `CP2:event:<id>`, once per event.**
    - If the line-up drops below full before the queued row is sent, the row is **withdrawn** (`failed_at`, "withdrawn: the line-up is no longer fully confirmed").
    - It is revived when the line-up is full again.
    - The customer is never told "fully confirmed" about a short line-up, and a sent CP2 is never repeated.
  - **CP3: `CP3:event:<id>:<send epoch>`, at most one per event per hour.** A change is sent at the top of the next hour. Every further change before then refreshes that one queued row, so the email says where the line-up stands when it goes. The key is the send time, so a night of changes is one email.
  - **Quiet hours.** Nothing is due between 23:00 and 07:00 UK. Such a send is queued for 07:00 UK (`client_email_send_time`), through BST and GMT.
  - **Not after the start.** Nothing is queued whose send time would be at or after the event's first start: the customer is on site and the office phones.
  - **Not for a cancelled event.** Nothing is queued, and cancelling an event withdraws whatever is still queued for it.
- **Switches.**
  - **Per client:** two switches on the client card ("Line-up emails"), both **on** by default (`clients.lineup_confirmed_emails`, `clients.lineup_changed_emails`). They are set through `set_client_lineup_emails()`: admin only, a viewer refused, audited as `client.lineup_emails`. Switching one off also withdraws that kind's queued rows.
  - **Global:** the /settings switch per code (ADR-0083) still applies. CP2 and CP3 are in "Client emails" beside D1 and D2.
- **The customer can see it.** `/client/account` gains **"Emails about your events"** (read-only), fed by `client_account_v`'s two new columns:
  - the timesheets: always;
  - "Line-up fully confirmed": On or Off, in words;
  - "Line-up changed after your Allocation Timesheet was sent": On or Off, in words;
  - who these go to, the quiet hours, and "email the office" to change them.
- **The link.** The database does not know the portal's address, and a link must never come from a row: a row is data, and a link in it would be a phishing vector, as ADR-0058's set-up links were.
  - The drain builds the link at send time: `CLIENT_PORTAL_URL` (a new optional Edge Function secret, docs/12), reduced to its origin, plus `/client/events/<eventId>`.
  - `eventId` must be a uuid, or the row fails.
  - A `link` in the payload is dropped.
  - While `CLIENT_PORTAL_URL` is unset, CP2 and CP3 rows are held as **unconfigured**: no attempt is spent, as with a missing Resend key (ADR-0020 §4). Every other email is unaffected.
- **Sending is off locally.** The rows queue and the drain holds them without keys, as for every other email.

### Consequences
- **No backfill.** An event that was already full when this deployed gets its CP2 on the first booking change afterwards, if it is still upcoming and full. There is no backfill job.
- **CP3 and the updated Allocation Timesheet.** CP3 does not replace ADR-0088's updated Allocation Timesheet; the two can both arrive. CP3 promises nothing about it.
- **Tests.**
  - pgTAP 833: the quiet hours in BST and GMT; fully confirmed fires once and never says "3 of 2"; withdrawn and revived; a change after D1 fires; the hourly and overnight debounce; not after the start; both switches, with withdrawal and the audit row; the cancelled event withdrawn and silent; recipients from the event or the card.
  - 606 holds `client_account_v`'s four columns.
  - `drain.test.ts`: the link, the hostile payload link, the hold, and a bad event id.

## 4 · Hardening: feedback only on the line-up the customer is shown

ADR-0134 §1 left `submit_client_feedback()` unchanged, on the grounds that "a booking id outside the trimmed set never reaches the browser". The function still accepted such an id, though. A stale tab from before the trim, or an id learned some other way, let the customer rate a buffer worker they were never shown.

`20261014170300_client_feedback_within_lineup.sql` restates the function with one more condition in its single refusal: the booking must be on the caller's line-up as `client_lineup_v` returns it, read with the event filter. A booking past the headcount that has not already been rated answers **"That booking is not on your line-up"** (42501), the same sentence as an unknown, unconfirmed, cancelled or foreign booking. A worker the customer already rated stays in the view, so a second entry still answers "already left" (23505). `client_request_worker()` (§2) applies the same check. pgTAP 834; 160, 792 and 810 are unchanged and pass.
