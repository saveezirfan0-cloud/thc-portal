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
