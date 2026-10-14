# ADR-0133 · The Client Portal list reads a recent window, and release hygiene for the portal

**Status:** Proposed · **Departs from:** `wireframes/client/events.html` (no "Show older events" line), `wireframes/client/event.html` (on-site contact "as given on your client card"; no contact button) · **Source:** desk review 14.10.2026

## Context
The event list read every event, role section and line-up row the customer had ever had, with no order and no limit. PostgREST stops every response at `max_rows` (1000, `supabase/config.toml` and the hosted default) without an error, so after a few months for a busy venue faces vanished, the feedback nudge undercounted, and then sections and whole events dropped out — silently. Every refresh (once a minute, `AutoRefresh`) also shipped every worker's name the customer ever had, and re-signed every photo, so each face got a new URL and was downloaded again.

## Decision
- **The list reads a window** (`apps/client/app/client/window.ts`): every event that has not ended, in full; past events that started in the last 90 UK days (`PAST_WINDOW_DAYS`). A "From" filter replaces the start, a "To" alone pages the window back to end there, and `?since=` — written by **"Show older events"** under the list — widens it 90 days at a time. A date filter that moves the window re-reads on the server; the tab, search and venue still filter in the browser. Sections, line-up and documents are read only for the events loaded (`.in('event_id', …)`), every query explicitly ordered.
- **A cap is never silent.** Every read asks for one row more than it keeps (sections and line-up page through in 500s); the extra row coming back means "too many", which is the amber load-failed-style notice, never a short list. A test pins every "+1" read under `max_rows`.
- **An empty list with older history says so** ("You have no past events since 16 Jul 2026" + "Show older events"), never "No events yet".
- **Photo links are reused** for half their 10-minute life (a bounded LRU per server instance), and the list signs only the faces it draws. A signed URL carries the Storage path, so the worker's `staff.id` reaches the browser inside it; ADR-0026 §4 accepts that, and the comments no longer claim otherwise.
- **Event page:** "Contact THC about this event" (a mail link to the office address, subject = title · UK date · PO). The on-site contact reads "for this event · usually the contact on your client card" — it is per event (§3.2), pre-filled from the card and editable.
- **Hygiene:** `noindex, nofollow` (metadata, `robots.txt`, `X-Robots-Tag`); a branded `global-error.tsx`; the event title in the tab (the not-found title for an id that is not the caller's, so nothing leaks); a login with no company is told so; a lapsed session while sending feedback says "You've been signed out — sign in again" and keeps the comment. The office address is written once (`account/copy.ts` `OFFICE_EMAIL`).

## Consequences
- The Past tab's count is the count inside the window. Reaching older history is one click, or a "From" date.
- No view, policy or migration changed: the portal still reads only the owner-rights `client_*` views (ADR-0004, ADR-0026).
