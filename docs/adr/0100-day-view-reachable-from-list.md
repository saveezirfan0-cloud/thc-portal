# ADR-0100 · The Month / Week / Day switch shows in List too

**Status:** Accepted · **Requested:** by the repository owner (7 Oct 2026): "There is no day view on Scheduling — only 'Today'" · **Wireframe:** `backoffice/events.html` List state redrawn with the switch · **§3.1**

## Context

§3.1 gives the calendar a Month / Week / Day switch, and the Day view exists (`view=day`, the arrows step one day). But the switch only rendered once **Calendar** was selected. In List, the default view, the only date control besides the arrows was "Today", which re-anchors the month list and does not open a day, so a manager reasonably concluded there was no Day view.

## Decision

1. The Month / Week / Day switch renders in every view. In List none of the three is highlighted; each opens the calendar at that grain on the period being read (`date` is kept), so "Day" from List on 7 Oct opens Wed 7 Oct.
2. The List / Calendar toggle is unchanged and is still the only one (§3.1 "one toggle, no duplicate"): Month / Week / Day is the grain control, not a second List / Calendar toggle.
3. "Today" is unchanged: it moves the current view to today.

## Consequences

- `EventToolbar.tsx`; test `event-toolbar.test.tsx`; wireframe and `docs/08-screen-inventory.md` updated.
- The switch in List is a shortcut into the calendar; List itself still shows the month.
