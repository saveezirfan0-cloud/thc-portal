# ADR-0210 · Needs review: View on every document, newest first

**Status:** Accepted (tickets TK-12 and TK-13, Sam Barrington-Wells for THC, 24.10.2026). Departs from §4.1's order ("oldest first … the one that has waited longest is next") and adds a control the wireframe does not draw.

## Context

- TK-12: "To approve Natalie's passport, you have to click into her name and profile then go into Documents to approve / reject. Can the passport be viewable on this page to stop the additional clicks." The Needs review row carried Verify and Reject but no way to see the file, so every decision on an upload went through the profile's Documents tab.
- TK-13: "The newest cases should be at the top and the oldest cases at the bottom."

## Decision

- Every Needs review row for an uploaded document (`kind = 'document'` with a file) has **View**, before Retry AI scan, Verify and Reject. It opens the file in a new tab through `documentLink` — the same 60-second signed link the Documents tab uses; the path is read through the manager's session, never taken from the browser.
- The queue is listed **newest first** (`filterQueue`), ties broken by item id. The menu counter is unchanged. The wireframe's toolbar note now reads "Newest first".

## Consequences

- A passport, visa or letter is read and decided in one place.
- The item that has waited longest is now at the bottom of the list; the Uploaded column still shows how long each has waited.
