# ADR-0119 · The Client Portal downloads only copies THC has issued, and a Completed Timesheet waits for the last check-out window

**Status:** Accepted (12.10.2026) · Records existing behaviour and amends one predicate · Builds on ADR-0004, ADR-0026, ADR-0074, ADR-0088 · **§11.1, §11.2, §11.3, §11.4, §3.3, RULE-02**
**Code:** `supabase/migrations/20261013100300_client_views_cancelled_feedback_final_copy.sql` (`client_event_documents_v`), `apps/client/app/client/documents.ts`, `apps/client/app/client/events/[id]/document/route.ts`, `apps/client/app/client/events/[id]/page.tsx` · **Tests:** pgTAP `411_event_documents.sql`, `443_final_timesheet_for_client.sql`, `809_client_views_cancelled_and_own_feedback.sql`; Vitest `document-route.test.ts`, `pages-load-failure.test.tsx`

## Context

§11.1 and §11.2 give the customer a download button: the Allocation Timesheet before and during the event, the Completed Timesheet after it (ADR-0074's names). §11.3 says the PDF can be "emailed or downloaded" with no time restriction, which could be read as "the portal draws the PDF on demand".

It does not, and should not:

- Drawing the PDF needs `event_document_data()`, which reads the line-up, check-ins and pay lines from tables the client role cannot read (ADR-0004, ADR-0026). Running it for a customer would need a `security definer` path into exactly the data the portal is built to keep out.
- The office decides when a document is ready. A copy the customer can pull at 09:00 on the day, while the line-up is still moving, is not one THC stands behind.

Two gaps also showed in review:

1. `client_event_documents_v` treated a sign-out copy drawn after the last role's end as final. Check-out stays open until end + 4 h (RULE-02, §9.5), so a copy drawn at end + 1 h could print blank Finish Time and Hours Worked cells and became the customer's "Completed Timesheet".
2. The download route answered a copy not yet issued with a bare-text 404 page, a storage failure with a bare-text 503, and an unknown `kind` with the allocation sheet.

## Decision

**1. The portal downloads stored copies only.** `client_event_documents_v` returns, per event and kind, the newest row of `event_documents` the office has issued. Nothing is generated for the customer.

- **Allocation Timesheet:** the latest stored copy of any age. A copy is stored when THC presses Send or Download on the event page, or when the automatic D1 goes the day before (ADR-0074, ADR-0088). Until one of those happens the button is disabled ("THC has not issued this document yet").
- **Completed Timesheet** (code: `signout`): the latest copy that is **final** — sent (`sent_at is not null`), or drawn at or after the last role's **end + 4 hours** (`generated_at >= ends_at + interval '4 hours'`). A later unsent draft never replaces a sent copy, because the filter is applied before the newest row is picked.
- **A cancelled event has none,** including a copy issued before the cancellation (§3.3, `e.cancelled_at is null`).

**2. Why end + 4 h, not "no booking still unsettled".** D2's automatic send already waits for both: never before end + 4 h, and held while any row is undetermined (`event_document_tally().undetermined`, ADR-0074). The view could have used the second rule too. It does not, because that rule is a fact about **now**, not about the copy: once a No check-out is resolved, every copy drawn while it was open — blank cell and all — would start being served. End + 4 h is a fact about the copy (when it was drawn relative to the last moment anyone could check out), so it cannot change after the event. The remaining case — a manager pressing Download after end + 4 h while a No check-out is still unresolved — is the office's choice, as pressing Send is; the D2 job never does it.

**3. The route says what happened.** `GET /client/events/:id/document?kind=allocation|signout`:

| Case | Answer |
| --- | --- |
| `kind` missing or not one of the two | 303 back to `/client/events/:id` (no notice) — never a guess at the allocation sheet |
| another customer's event, an unknown id, or an id that is not a UUID | the same plain 404 (no existence oracle, ADR-0004) |
| the caller's own event, no copy of that kind | 303 to `/client/events/:id?doc=missing` |
| the read or the signing failed | 303 to `/client/events/:id?doc=unavailable` |
| a copy | 302 to a one-minute signed link |

Every answer is `no-store`. The event page shows an amber note for `?doc=missing` ("hasn't been issued yet", or "was cancelled" on a cancelled event) and `?doc=unavailable`. When the page's own documents read fails, both pages say "Documents couldn't be loaded just now — refresh to try again." above the screen instead of letting every button read "not issued yet".

## Consequences

- The customer can never download a copy THC has not issued, and never a Completed Timesheet with a finish time still open.
- A Completed Timesheet drawn by hand between end and end + 4 h and not sent stays invisible to the customer. The office can send it, or download again after end + 4 h.
- No policy changes: the view keeps owner rights, `security_barrier`, `client_portal_visible()` in its body, named columns and SELECT-only to `authenticated`.
