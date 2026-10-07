# ADR-0104 · The period label on Scheduling is a date picker

**Status:** Accepted · **Requested:** by the repository owner (7 Oct 2026): "we should be able to select a day from calendar dropdown" · **Wireframe:** `backoffice/events.html` List state: label drawn with a ▾ and annotated · **§3.1**

## Context

§3.1 gives the toolbar back and forward arrows around the period label. They step one day, week or month, so reaching "Thu 15 Oct" from today meant clicking there, or editing the URL. The Day view (ADR-0100) made that more visible: a day is the one grain where a manager nearly always knows the date they want.

## Decision

1. **The label opens a date picker.** It stays a button reading the period it names, with a ▾ and a "Choose a date" tooltip; pressing it (click, Enter or Space) opens the browser's own `<input type="date">` picker, the same control the Shift Builder uses for an event's date.
2. **The chosen day becomes the period's anchor,** so one control serves every view: Day opens that day; Week opens the week it falls in (Mon–Sun); Month and List open its month. The view, the search and both filters are kept.
3. **It is an ordinary navigation:** `router.push` to the same `eventsHref` as every other control, so the result is a bookmarkable link and the back button undoes it. A cleared field or the day already showing does nothing.
4. **The input is only the picker's anchor:** laid over the label, invisible, out of the tab order and hidden from assistive technology, because the button is the control. `color-scheme` follows the theme so the picker matches light and dark.

## Consequences

- The arrows and "Today" are unchanged; the date picker is additional.
- The date format shown inside the native picker follows the viewer's device locale, as every `<input type="date">` does. Dates in the label and URL are unchanged.
- `apps/office/app/events/_components/PeriodPicker.tsx`, `EventToolbar.tsx`, `events.css`; tests `__tests__/period-picker.test.tsx` and an `office.events.spec.ts` journey.
