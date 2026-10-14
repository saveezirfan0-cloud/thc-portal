# ADR-0132 · On the Scheduling screen, a shift that is not 100% filled flashes red

**Status:** Accepted · **Departs from:** `wireframes/backoffice/events.html` (a short event's chip edge and fill pill are amber and still) · **Owner request:** 13.10.2026 — "On the Scheduler, any shifts which are not 100% filled, should flash red - alert"

## Context

`/events` drew a short event in amber: the chip's edge, the "N open" tag and the "13 of 17" fill pill. Amber is also the colour of a dozen routine states elsewhere, so on a busy month a short shift did not stand out from a full one at a glance. The office asked for an alert.

## Decision

1. **Which events.** An event is short when any role section has fewer confirmed than its headcount — the fill is counted per section (§3.2: only confirmed count; buffer seats are not required, and one role over-confirmed never covers another). It raises the alert while it is **upcoming or ongoing**. A cancelled event never does. A short event that has **ended** reads amber and stays still: nobody can fill it any more, and a month of red history would drown the shifts that still can be.
2. **What flashes.** Coral (the palette's danger tone) replaces amber, and pulses, on every view: the List and Day fill pill (tinted ↔ solid coral), the Week card and the day-popup row, and the Month chip (its edge and "N open" turn coral and the chip pulses; on a phone the dot pulses). A collapsed Month chip ("Breakfast ×4") flashes when any event in it is short. An **ongoing** short event shows coral instead of its usual cyan — running short is the most urgent case.
3. **Accessibility.** One pulse every 1.6 s, a fade rather than a hard blink — far below WCAG 2.3.1's three flashes a second. With `prefers-reduced-motion: reduce` nothing moves; the shift stays red, with a coral ring on the chip. The pill's title reads "Short-staffed: N open", so the alert is not carried by colour alone (the fill "3 of 6" already says it in words).
4. The day and band counters ("N ev · M open") are unchanged.

## Consequences

- `apps/office/app/events/view-model.ts` — `fillTone` returns `coral` for a live short event (`amber` only once ended); `isShortStaffed`; `MonthChipModel.alert`.
- `_components/EventViews.tsx` (`FillPill`, Week card), `_components/MonthCellEvents.tsx`, `events.css` (`.alert`, `.pill.fill-alert`, the reduced-motion fallback). Tests: `short-staffed-alert.test.tsx`, `view-model.test.ts`.
- The wireframe still draws amber; this ADR is the deviation record.
