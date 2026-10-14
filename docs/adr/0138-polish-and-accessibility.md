# ADR-0138 · Polish & accessibility: one date box, one buffer form, the wrong-app card, a typed address when the lookup fails

**Status:** Accepted (product owner, 14.10.2026 — release audit package G, `docs/20-release-audit-2026-10-14.md`) · **Builds on:** ADR-0007 (one appearance switch), ADR-0068 (the typed date of birth), ADR-0099 (no cancelled events on the Scheduling diary), ADR-0133 (the Client Portal's UK date filters), ADR-0136 (the table frame), ADR-0137 (editing safety) · **Departs from:** §9.11 "the address is reverse-geocoded and read-only" for the one case the lookup cannot answer (§4 below)

Package G is the release audit's minor and polish findings. Most are fixes with no decision in them (a landmark, a label, a gap, a sentence); this record keeps the four that choose something.

## 1 · Dates are typed dd/mm/yyyy everywhere in the Back Office

A native `<input type="date">` draws its value in the device's locale, so on a US-English browser the office's date fields read mm/dd/yyyy under "(UK date)" labels — the trap CLAUDE.md names for `<input type="time">`. The Client Portal's answer (ADR-0133: `UkDateField` + `ukdate.ts`) moves into `packages/ui` and is used by every office date field: the Reports range and New Starter date, the Clients and Venues "Added from / to" filters, the candidate's Right to work until, document expiry and term-date periods, the compliance review and evidence dialogs, the right-to-work branch change, the No-show / No check-out resolution, and the Shift Builder's event date. The box is text, typed day first; the calendar beside it is the browser's own picker laid invisibly over the icon and only ever writes into the box. In a plain GET form the field submits `yyyy-mm-dd` through a hidden input under the name the URL always carried. The Client Portal imports it from `@thc/ui`.

Written dates follow §1.8 by context: an event's date is "Thu 22 Oct 2026" (the board's Event panel and the Shift Builder's edit banner no longer print `2026-10-22`); an audit stamp stays `dd.mm.yyyy HH:mm` UK.

## 2 · The buffer always reads "6 (+1)" — including "2 (+0)"

The events list dropped a zero buffer ("2") while the dashboard beside it, the event board and the Shift Builder said "2 (+0)". Every wireframe draws "(+0)" (dashboard, events list, event board, client card) and CLAUDE.md names one display form, so `formatAllocation` now spells the zero out like `formatAllocationPair`. A negative buffer is refused by the builder, but while one is typed it reads "0 (−2)" with a real minus, never "0 (+-2)".

## 3 · The wrong-app page is each app's own sign-in card

An account opening an app its role has no business in (an admin on the Client Portal, a client on the Back Office) got `wrongAppBody()`: a self-contained inline page with no logo, the brand font only if the device had it installed, and light or dark by the operating system rather than the reader's own choice. It had to be self-contained because the middleware answered with it directly.

The middleware now **rewrites** the request to `/wrong-app` with status 403 and the refused role on a request header (`x-thc-wrong-app-role`). A rewrite is not a navigation, so it cannot loop — the property the inline page existed for — and each app renders the page with `WrongApp` from `@thc/ui`: the sign-in card's logo, Plus Jakarta Sans, the appearance switch, the stored theme, and Sign out as a POST. A visitor who sends the header themselves only chooses which sentence they read; an account of the app's own role opening `/wrong-app` is sent to its home. `@thc/db` keeps the words (`wrongAppCopy`); `wrongAppBody` is removed. `docs/08` names the three routes.

## 4 · A venue's address may be typed when the lookup cannot answer

§9.11 makes the address the reverse-geocoder's, read-only. Offline, or with the geocoder down, a dropped pin left the Address empty and red and Create disabled for good — the venue could not be made at all. When the lookup fails the field becomes typeable, says why, and keeps the pin where it was dropped; moving the pin looks the address up again. This is the only case in which an address is typed, and it is written as the manager typed it.

## Consequences

- `packages/ui`: `UkDateField` / `ukdate.ts`, `WrongApp`, `.sr-only`, `TileGrid compact`, the skip link and `<main>` landmark in `Shell` / `Content`, roving tabs, named chip removes, the switch's round focus ring, `.input.mono` on `--font-num`; the same classes in `wireframes/assets/thc.css`, stories on `/design-system`.
- Muted text: the light `--muted` moves `#7a6b5c` → `#736456` and the warm dark one gets its own `#929fab`, so small secondary text clears 4.5:1 on the 12% accent tints as well as on the grounds (it measured 4.36–4.48:1 on the PO number chip, the board's "your time" line and a week chip's client line). The scope's §1.6 `#8a97a3` is untouched; `contrast.test.ts` checks every tint.
- `packages/domain`: `formatAllocation` = `formatAllocationPair`; the "omits a zero buffer" tests now pin the opposite.
- The client card's blocks are numbered in page order (General 1, Rate card 2, Qualified staff 3, Shift requirements 4, Requests 5, Events 6, History 7). The wireframe numbers Events 4 because it does not draw the two ADR-0110 / ADR-0135 blocks.
- `/settings` lays its blocks out as masonry columns, with the radii table across the page.
- Seed only (no migration): verified seed documents carry `reviewed_at` / `reviewed_by`, and every seeded rating comes with the office feedback whose mean it is.
