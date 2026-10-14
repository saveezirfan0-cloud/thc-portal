# ADR-0137 · Editing safety: one rule for how a value is edited, a pay floor, length caps

**Status:** Accepted · **Release audit:** `docs/20-release-audit-2026-10-14.md` Part A, package D — E-M3, E-M4, D-M2, D-M3, D-M6, D-M7, m1, m2, m3, m8, m9, m16, L8, L10 · **§9.6, §9.7, §9.8, §9.11, §1.2**

## Context

The Back Office edited values five different ways — autosave on change (gender, languages), inline edit-in-row (the rate card), a modal (client, venue, role, pay rate), an edit mode over a whole page (the Shift Builder, /settings) and one-click removal with no undo (a role chip, a qualification, a rate-card role) — with nothing telling a manager which they were in. A filled-in Shift Builder or a dirty modal was thrown away by a sidebar link, Cancel, Escape or a backdrop click; a list edit said nothing when it worked; £0.00 pay, a £5.00 base rate, a charge below final pay, a phone "not a phone" and a 326-character client name were all accepted.

## Decision

### 1 · Which way a value is edited

| The value | How it is edited | What it says |
|---|---|---|
| One field whose change is safe and reversible on its own (gender, languages, a switch) | **Autosave** on change | a **"Saved"** receipt beside it (and a toast); a refusal stays next to the field |
| One row of a list (a rate-card role, a venue) | **Inline or a modal**, explicit **Save** / **Cancel** | the row or a toast confirms; errors sit **next to the field** and disable Save |
| A record with several fields (client, venue, role, pay rate, feedback, invite) | **Modal**, a real `<form>` — **Enter submits** | Escape / backdrop / × on a dirty form ask **"Discard your changes?"** (`Modal dirty`) |
| A long form (the Shift Builder, /settings) | **Edit mode** with a save bar | **`useUnsavedChanges`**: a link, Cancel or closing the tab asks **"Leave without saving?"**; after Save the next page opens at its top; a refused save scrolls to and focuses the field |
| A destructive one-click action (remove a role chip, a qualification, a rate-card role) | **A confirm** naming what goes and what stays | — (an Undo toast is the alternative where the remove can be replayed exactly; none of today's three can — a removed rate-card role loses its dress codes, a qualification its provenance) |
| A list edit that leaves the page where it was (mark as read, a venue saved, office feedback) | — | a **toast** receipt (`toast()`), never the only copy of an error |

Invitation copy says **queued** until the outbox has sent the email (`notification_outbox` is a queue, not a send).

### 2 · The pay floor

No base rate (`create_role`, a changed rate in `update_role`) and no personal rate (`set_staff_pay_rate`) below the **UK National Living Wage for 21 and over** — `settings.minimum_hourly_pay`, read by `minimum_pay_rate()`: **£12.71 from 1 April 2026** (GOV.UK, "National Minimum Wage and National Living Wage rates"; it was £12.21 for 2025/26, and £12.71 is the seed catalogue's rate). It is a setting so next April's figure needs no release. A role priced under an older floor can still be renamed. Above £1,000.00 an hour is refused as a typo. The forms read the same figure and say it under the field. A charge rate below final pay is not refused — a client may be priced at a loss on purpose — but Save asks first and states the loss as **"−£5.69/h"** (U+2212, never "£-5.69").

### 3 · Length caps

Venue name and client name ≤ 120, each dress code ≤ 200, the office's own feedback ≤ 2,000 (the Client Portal's figure). Held in the input function where there is one (a sentence) and by a CHECK on the table (every other path), validated in the migration when no existing row breaks it; the form has `maxLength` and shows "N of MAX characters" in the last fifth. Long unbroken text wraps where it is shown (`overflow-wrap: anywhere`), never widening the page.

## Consequences

- `packages/ui`: `useUnsavedChanges`, `Modal dirty` / `onSubmit`, `toast()` / `<Toaster />` (mounted once in `OfficeShell`).
- Migration `20261014160000_editing_safety_caps_and_pay_floor.sql`, pinned by `822_editing_safety_caps_and_pay_floor.sql`; fixtures that set a rate under £12.71 through the functions were moved to £12.71+.
- Each April: update `settings.minimum_hourly_pay`.
- The browser's Back button inside the app is not intercepted by the guard (the App Router answers it from its own history without a cancellable event).
- The client form's emails label says the real rule, "up to 10" (ADR-0087), not "2–3 people".
