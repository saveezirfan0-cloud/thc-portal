# ADR-0134 · Client Portal round 3: the line-up stops at the headcount, and nine approved additions

**Status:** Accepted (product owner, 14.10.2026 — the "one decision" and the N1–N9, P4 proposals in `docs/20-release-audit-2026-10-14.md`, Part B) · **Builds on:** ADR-0004, ADR-0026 (the client reads only through owner-rights `client_*` views), ADR-0050, ADR-0053, ADR-0074, ADR-0088, ADR-0089, ADR-0119, ADR-0133 · **Departs from:** §11.2 and `wireframes/client/event.html` as listed per item below

The hard lines do not move: the portal is read-only apart from the existing feedback and password writes, there is no money anywhere, and every client read is an owner-rights `client_*` view that filters by `client_portal_visible()` in its own body and names its columns. No table gains a client policy (`001_rls_guard` still pins the empty set).

## 1 · The line-up stops at the headcount

### Context
Round 2 (ADR-0133) held every COUNT to the headcount the customer booked, but kept the line-up itself whole: an over-booked role showed six faces under "Waiting Staff · 4 of 4", and the raw `confirmed = 6` reached the browser in the page's props. Either way a customer could see THC's buffer (§3.2: insurance on top of the headcount, internal to THC). The product owner chose "only up to headcount".

### Decision
- **In the views, not the screen** (`20261014140000_client_lineup_within_headcount.sql`), so what the customer is not shown is never sent:
  - `client_lineup_v` returns at most `headcount` rows per role section;
  - `client_role_sections_v.confirmed` is `least(confirmed, headcount)`;
  - `client_arrivals_v` holds both `confirmed` and `arrived` to the headcount.
- **Who takes the seats** follows the strict buffer policy (RULE-15, "the first headcount check-ins work"):
  1. anyone with a `checked_in` check-log (their own check-in, on time or Late, or the office's "Get back"), or a `worked` booking, by first check-in time;
  2. then everyone else by `bookings.confirmed_at` (`created_at` for an old row without one);
  3. then the booking id, so the order is total and a refresh never swaps two people.

  Before the event nobody has checked in, so the people confirmed first hold the seats. On the day the seats follow the door. An out-of-radius press is not a check-in and takes no seat.
- **A worker the customer has already rated stays visible** whatever their seat. The customer rated a person they saw, and the line-up (and the feedback history, N4 below) must not make that entry vanish. This is the one way a section can show more faces than its headcount, and only with a face the customer has already seen. The section's count still reads the booking ("4 of 4").
- **Arrivals agree with the faces.** Because the checked-in take the seats first, "arrived among the visible line-up" is exactly `least(arrived, headcount)`. The feedback nudge ("N to go") and the faces are computed from the rows the view returns, so all three follow the same set. The round 2 caps in `rules.ts` stay as a second guard and are a no-op on what the views now return.

### Consequences
- The seat order can change during the event. If a buffer worker checks in before a late one, the buffer worker's face replaces theirs, which is what RULE-15 does at the door.
- `submit_client_feedback()` is unchanged. It still accepts any booking on the confirmed line-up of the caller's event, but a booking id outside the trimmed set never reaches the browser.
- The admin passes `client_portal_visible()` and so reads the trimmed line-up through these views too. The Back Office has its own reads and is unaffected.
- pgTAP `815_client_lineup_within_headcount.sql`: six confirmed on four gives four rows, the right four before and during the event, the tie-break, the arrivals cap (including a fifth check-in), the rated worker kept, tenancy, and the restated views' ADR-0004 shape.

## 2 · Three things the event page now says (N1–N3)

All three come from `20261014140100_client_portal_phone_dress_code_recipients.sql`. Each is THC's public contact detail or the customer's own data: no money, and nothing about a worker.

### N1 · THC's on-the-day phone number
- **Where the number lives.** Nothing in the schema held an office phone, so a settings key carries it: `client_portal_phone`, a JSON string, seeded `""`. The office edits it in a new **Client Portal** block on `/settings`. The admin-only `settings` policy is the gate, as for every other key. Blank hides the number. Otherwise it must be digits, spaces, `+`, brackets, dashes and dots, 10–15 digits, at most 30 characters (`validateClientPortalPhone`).
- **How the portal reads it.** `settings` also carries job secrets and payroll recipients, so the client role gets no policy on it. Instead a new owner-rights view, **`client_portal_contact_v`**, returns one column, `phone` (trimmed, null while empty or not a string). It has `client_company_v`'s shape: `current_client_id()` + `client_portal_visible()` in the body, one row for a client user whose login is linked to a company, none for anybody else, SELECT to `authenticated` only. `001_rls_guard` now pins **eighteen** owner-rights views (fifteen selectable), and `docs/14-handover.md` counts 15.
- **On the page.** A ghost button reads **"Call THC · 020 7946 0000"** beside "Contact THC about this event". It is a `tel:` link that dials digits only, keeps a leading +, and drops a UK "(0)" (the Staff App's rule). It is named "Call THC on …" for a screen reader. There is no button while the setting is empty, and a failed read hides it without breaking the page.

### N2 · The dress code per role
- `client_role_sections_v` gains **`dress_code`**: the section's own text, which the office picks from the customer's rate card (`client_rate_cards.dress_codes`). A blank value is null.
- The event page draws it as one quiet line at the top of each role panel ("DRESS CODE Black tie"). The list does not ask for it.
- **`events.notes` stays out.** It is the office's internal note (ADR-0026), and pgTAP 816 asserts no `client_*` view names `notes`, `cancel_reason`, `pays_buffer` or `buffer`.
- This departs from ADR-0128's "once per event" for the board. The customer reads one role at a time, and the owner asked for it per role.

### N3 · "Timesheets go to …"
- `client_events_v` gains **`timesheet_recipients`** = `coalesce(events.document_recipients, clients.contact_emails)`. That is `event_document_recipients()` to the letter, written inline because that function reads `clients` with the caller's rights.
- The event page's meta block lists the addresses once each ("Timesheets go to", sub-line "for this event · ask THC to change who receives them"). There is no line for a cancelled event (§3.3: no documents), and none without addresses. Only the event page asks for the column.
- An event's own list may name addresses that are not on the client card (ADR-0089). They are the people THC was asked to send this customer's documents to, so showing them to that customer reveals nothing new.
- Each address takes its own line, with a break opportunity after the "@" (the round 3 walk found "leonardo-stpauls" breaking at its hyphen in a 220px column).

## 3 · In-scope additions (N4–N9, P4)

### N4 · "Feedback you've given" (`/client/feedback`)
- **What it shows.** A read-only page listing every entry the customer has left, newest first: worker · role · event (linked) · the event's UK date and venue · their stars · when they sent it · their comment. On a phone the table becomes cards. The page is reached from "Feedback you've given" under the event list.
- **Where the data comes from.** It reads `client_lineup_v`'s feedback columns (`feedback_given = true`, at most 500 rows + 1 to detect "more") and names each event from `client_events_v`. A worker the customer rated stays on the line-up whatever their seat (§1), so no entry is lost to the headcount trim.
- **The comment column.** It needed **`client_lineup_v.feedback_text`** (`20261014140200_client_lineup_feedback_text.sql`, approved): the customer's own entry's text only, on the same lateral row as the stars. The office's entries and words never match (§9.10).
  - **The comment is withheld once the worker is removed** (§1.7). GDPR removal keeps feedback text verbatim for the office to redact by hand (`20260921190118`), and a comment naming the person would undo the "Deleted account #id" the line-up shows. The stars stay, and the page says "Comment not shown — account removed".
  - The list and the event page do not ask for the column, so a comment is never shipped where it is not shown.
- pgTAP `817`: the customer's own words only, never the office's or another customer's; null without a comment; withheld for a removed worker; the view's shape is kept.
- The page has a route `loading.tsx`. It has no 404 of its own, so the event page's reason for having none (N9) does not apply.

### N5 · Search by worker name
- The list's search ("Search events or staff") also matches the names on each loaded line-up (`lineupNames`, `staffMatching`). The match ignores case and accents and treats any run of spaces as one, so "zoe" finds "Zoë".
- It reaches exactly what the browser already holds: the window read (ADR-0133) and, within it, the line-ups already held to the headcount. A buffer worker the customer never sees is not findable.
- A "Deleted account #id" is not a name to search for.
- A row found by a person says who: "On the line-up: Priya Shah". When the search hides everything and there is older history, "Search older events too" pages the window back with the search kept (the existing `since`).

### N6 · Printable line-up
- **"Print line-up"** is a ghost button in the event header. It is not offered on a cancelled event.
- The `@media print` rules print the event header and meta, every role panel with its window and dress code, and every face and name (two per row, never split across a page). They hide the top bar, the actions, the banners, "Leave feedback", "Rate everyone" and the welcome.
- While printing (from the button or the browser's own Print), `PrintButton` puts `data-theme="light"` on `<html>` and restores the reader's own afterwards. Paper is light, and the colours still come only from the tokens. Nothing is written to storage.

### N7 · "Add all upcoming to calendar"
- One `.ics` file holds a VEVENT for every event that has not ended and is not cancelled (`upcomingForCalendar`, the Upcoming tab's rule), soonest first. It is built in the browser by `buildCalendar`.
- Each VEVENT is byte for byte the one ADR-0050 writes for a single event, with the same `UID:{eventId}@thehospitalitycompany.co.uk`. Importing it again, or after a single event's file, updates entries rather than doubling them.
- It carries no worker names and no money. The file is named "THC upcoming events.ics".
- The button sits under the list, beside "Feedback you've given", and is drawn only when something is ahead.

### N8 · First-visit welcome
- Three lines above the list:
  1. what the portal shows;
  2. when the timesheets arrive, in round 2's words: `ALLOCATION_TIMING`, "sent the day before, once every role is confirmed", one constant shared with the list's quiet line;
  3. how feedback works.
- "Got it" dismisses it for this device (`localStorage` `thc.client.welcome.dismissed`, every access in try/catch). A browser that refuses storage shows it again next visit.
- It is drawn only after mounting, so a returning customer never sees it flash. It is an `<aside>`, not a `.panel`, so it never becomes the list's titled card.

### N9 · Event-page loading skeleton, still a 404
- There is still no `loading.tsx` on `/client/events/:id`. A route `loading.tsx` wraps the whole page in Suspense, so the shell and its 200 would be sent before `notFound()` could answer 404 (docs/08).
- **The page now reads the event's own row first** (`loadEventRow`, one indexed read, also used by the tab title) and decides between itself and the 404 before anything streams.
- Only then does a Suspense boundary inside the page stream `EventBody` (sections, line-up, phone, photos, documents, arrivals). Its fallback is `EventSkeleton`: the real event name and venue over the header's shape and two role panels of faces, announced once as busy.
- `loadEvent` remains as the two reads together. pgTAP is unaffected. The e2e "another customer's event is 404" check passes against the built server.

### P4 · Rate everyone in one pass
- **When it is offered.** On a started or finished event with two or more people still to rate (`stillToRate`: not rated, not sent from this page, not a removed account), "Rate everyone (N)" sits under the feedback banner. The per-person "Leave feedback" stays.
- **The dialog.** It lists each person with their face, name, role and a star row (an APG radio group as in the single popup: one tab stop, arrows, Home and End). An optional comment per person is collapsed behind "Add a comment". A row without stars is skipped.
- **No new write path.** "Send N ratings" sends each rated row through the existing `leaveFeedback` → `submit_client_feedback()`, one after another, so the database applies every rule to every entry.
  - Each row reports its own outcome. A sent row reads "✓ Feedback sent", and a refused or failed one shows the customer sentence the single popup would.
  - One aria-live line sums it up ("2 ratings sent · 1 couldn't be sent — see the row below and try again"). Pressing again retries only the unsent rows.
  - A lapsed session stops the run and offers "Sign in again" in a new tab, keeping what was typed. An over-long comment is caught before anything is sent.
- **What the page does afterwards.** The roster is fixed when the dialog opens, because each send re-reads the page. When every row went, the dialog closes and the page refreshes.

### Consequences
- `apps/client/app/client/events/[id]/page.tsx` now renders `EventBody` behind a Suspense boundary. `EventBody`, `EventSkeleton` and `LoadFailed` live in `EventBody.tsx`, because Next.js allows a page file only its own exports.
- `client_lineup_v` has been restated three times in this round (`140000`, `140200` here, and the column lists in `050`); 050, 664, 809, 815 and 817 hold its shape.
- e2e: the client specs' "Search events" placeholder still matches ("Search events or staff"). A fresh browser context now shows the welcome above the list. It is not a `.panel`, so `section.panel h3`.first() is still the list's title.
