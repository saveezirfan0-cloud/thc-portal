# ADR-0195 · The event board goes back to the Scheduling view it was opened from

**Status:** Accepted (owner request, 22.10.2026). Addition to `/events/:id` not drawn in `backoffice/event-board.html`; this ADR is the deviation record.

## Context

Every state of `/events` is a URL (`_lib/filters.ts`: view, period, search, client, status), but the event board only ever linked to plain `/events`. Opened from Week · 12–18 Oct, the board's only ways out were the sidebar's Scheduling and the "Scheduling" crumb, and both opened the default — List at today — so the manager had to switch back to Calendar → Week and step to the week again after every event they looked at.

## Decision

1. **`/events` remembers itself.** `RememberSchedulingView` (`events/_components/BackToScheduling.tsx`) writes the page's own URL (`eventsHref(query)`) and a label ("Week · Mon 12 Oct – Sun 18 Oct 2026") to `sessionStorage` (`thc.events.return.v1`) whenever the view, period or a filter changes. A period opened at today is kept without its date (`/events?view=week`), so a tab left on this week goes back to the current week tomorrow, as ADR-0167's "opens at today" expects, rather than to a stale one.
2. **The board reads it.** A **← Back to Week · Mon 12 Oct – Sun 18 Oct 2026** button sits at the top left of the board (beside the document hints, so no extra row), and the "Scheduling" crumb links to the same place. Both are on the read-failed screen too. With nothing stored — a new tab, a link from the Dashboard in a tab that never opened Scheduling — they read "← Back to Scheduling" and open `/events` as before.
3. **sessionStorage, not a `?from=` parameter.** The way back survives Edit, Duplicate's Back to the original, a refresh and the board's 60-second refresh without threading a parameter through every link to the board (calendar chips, the month popup, the list, the Dashboard, the client card, the staff profile). It is per tab, so two tabs on two weeks each go back to their own.
4. **Only `/events` or `/events?…` is followed.** A stored value that is not this app's Scheduling URL (hand-edited, an older build) is ignored, so the button can never link off-site. Storage is read after mount; the server render and a browser that throws on storage get plain `/events`.

## Consequences

- The sidebar's Scheduling still opens the default view: it is the menu, not a back button.
- Once a tab has opened Scheduling, a board reached from the Dashboard, a client card or a staff profile also offers "Back to Week · …" — the last Scheduling view in that tab, not the screen the manager came from. Accepted: the button names where it goes, and the browser's back button still returns to the screen before.
- The button is a link, so the browser's back button after using it returns to the board — ordinary link behaviour.

## Not done

- Scroll position and which week-column bands were folded are not restored; the view opens at the top, as any navigation to `/events` does.
- Other screens that link to a board (Dashboard, client card, staff profile) do not get their own "back to" — the browser's back button covers them.
