# ADR-0034 · Client Portal event list: presentation-only additions

**Status:** Accepted · agreed with the client on 25.09.2026 · **Wireframe:** `wireframes/client/events.html` · **§11.1, §11.2, §11.3, §1.2, §1.7, §1.8**
**Code:** `apps/client/app/client/EventsScreen.tsx`, `apps/client/app/client/rules.ts`, `apps/client/app/client/client-portal.css` · **Tests:** `apps/client/app/client/__tests__/list-rules.test.ts`, `apps/client/app/client/__tests__/events-screen.test.tsx`

## Context

§11.1 lists the event list's contents: name · venue · date/time · "N of M confirmed" · photos of the confirmed workers · a download button (Allocation sheet / Signed timesheet) · a link into the details. The wireframe draws exactly that, as a table on desktop and a card per event on a phone. In use, several gaps showed:

- **The phone card had less than the table.** It said "13 of 17 confirmed" with no bar, and nothing said which role was short.
- **The download looked unavailable.** The live download was a plain bordered `btn`, the same as "Details →" beside it and close to the faded disabled stub. It read as greyed out even when the PDF was there.
- **"Upcoming & ongoing" did not fit a phone.** With "Past" and "All" beside it, the segmented control ran off a 390px screen and scrolled inside itself.
- **Nothing pointed at today's event.** A customer opening the portal on the day had to find the running event in the list.
- **Nothing said feedback was waiting.** §11.2's "Leave feedback" is on the event page only, so a customer could not see from the list which events still needed it.
- **A past event did not say whether its timesheet was out.** A disabled "↓ Signed timesheet" was the only hint that the final copy had not been issued.
- **A customer with many events at several venues had only a text search.**
- **The empty list said "No events to show here yet."** It said the same whether the customer had no events or their own search had hidden them all.

The client asked for these on 25.09.2026. None needs new data, editing or money.

## Decision

Every addition is drawn from the rows the list already loads: `client_events_v`, `client_role_sections_v`, `client_lineup_v` and `client_event_documents_v`, under the caller's own session (ADR-0004, ADR-0026). No view, column, policy or RPC changes. The rules are pure functions in `rules.ts`, pinned by tests.

1. **Fill bar and role split on the phone card.** The card draws the same `Progress` bar the table does. Under it, when the event has two or more roles, a line such as "Chef 2/2 · Waiting Staff 8/10 · Bar 5/7" (`roleBreakdown`). A short role is drawn in the amber the bar uses. The counts are confirmed only, against the booked headcount, never the buffer (§3.2). Two shifts of the same role add into one entry. Roles are ordered by their own start (RULE-18), as the event page groups them. The desktop Confirmed cell shows the same line under its bar. With a single role the line would only repeat "N of M confirmed", so it is not drawn.
2. **The download is the primary action.** A live download is `btn sm primary`, filled. On the card, "Details →" is a bordered `btn sm`, and the two share the card's foot in equal halves. A copy not yet issued keeps the plain, disabled button (faded, `not-allowed`), so it still looks unavailable. The desktop Details stays the wireframe's text link. The download is still a real `<a href>` to the PDF (§11.4).
3. **The first tab reads "Upcoming".** Its value (`upcoming`) and its rule are unchanged: every event whose window has not ended, so upcoming AND ongoing (`filterByTab`).
4. **A "Next up" strip above the list** (`nextUp`). A running event wins: "Happening now · Gala Dinner · until 23:30 UK time · 13 of 17 confirmed". Otherwise the soonest upcoming event: "Next · Gala Dinner · today 07:00 UK time · …". The strip links to the event page and is not drawn when nothing is upcoming or ongoing. Cancelled and completed events never appear in it. The time is a scheduled time, so it is dual-zone as §1.8 requires: the UK time is always written (and rendered on the server), and once the page has mounted a reader whose zone differs also gets their own, e.g. "today 07:00 UK time (11:00 your time)", the same hydration rule as `EventWindow`. "Today" and "tomorrow" are judged on each line's own calendar (`momentIn`). The strip ignores the tab and the filters: it answers "what is next for me", not "what is in this view".
5. **A feedback nudge on started events** (`feedbackToGo`): "Leave feedback · 5 of 13 to go", linking to the event page, where the per-worker buttons are. It appears only on an ongoing or completed event, and only once `feedbackOpen` says the event has started, the same test the event page's buttons use (§11.2). It never appears on an upcoming or cancelled event. A removed worker (§1.7) cannot be rated, so they count on neither side. The nudge disappears once every rateable worker has feedback. The list still writes nothing; `submit_client_feedback()` remains the only write, from the event page.
6. **The signed timesheet's status on a completed event** (`timesheetStatus`): "✓ Signed timesheet ready" or "Timesheet not issued yet". It is read from `documentOffer`, so the words and the button cannot disagree. "Ready" means the view holds a final copy (§11.3).
7. **Venue and date filters** (`applyFilters`), combined with the tab and the search. The venue select lists each venue once, A to Z, and is hidden when the customer has only one. "From (UK date)" and "To (UK date)" are UK calendar days, labelled as such so a reader abroad does not pick a day on their own calendar, and both are inclusive. An event is filed under the UK day it starts on, the day the Date column prints, not the UTC date of its timestamp. So an event at 23:30 UK on the "To" day is included, and one at 00:30 UK the next day is not. A "From" after the "To" matches nothing rather than being silently swapped. On a phone the filters use the shared `.toolbar` rules (ADR-0030): the search takes a line, the venue the next, From and To share a third.
8. **An empty list says why** (`emptyReason`):
   - no events at all: "No events yet";
   - none in this tab: the tab's own sentence, with "Show all events";
   - the search and filters hid every row of the tab: "No events match your filters", how many they hide, and "Clear filters".

   A toolbar "Clear filters" appears whenever a filter is set.

## Consequences

- **§11.1's rules hold.** The list is read-only, shows no money, and reads only through the `client_*` views. Nothing here adds a column to any view, and `rules.ts` still computes no money.
- **`e2e/tests/client.portal.spec.ts` was updated** for the "Upcoming" label, and gained a filter → no match → Clear filters test.
- **`docs/08-screen-inventory.md` lists the new `/client` states:** Next up (live / next / none), the three empty states, and the filtered list.
- **The wireframe (`wireframes/client/events.html`) predates these additions.** Where it and the screen differ on these eight points, this ADR is the record.
- **Date input format.** The From / To inputs show dates in the browser's own format (dd/mm/yyyy for a UK browser). The filter's meaning does not depend on that format.
