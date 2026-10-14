# ADR-0139 · A column chooser on the Back Office lists, remembered per person

**Status:** Accepted (owner approval 14.10.2026, release audit package F) · **Extends** the wireframes, which draw no chooser · **Builds on** ADR-0136 (the table frame), ADR-0137 (list state in the URL), ADR-0085 (where a per-person display preference lives), ADR-0061 (schedulers see no money), ADR-0109 (the layout never waits) · **§1.2, §1.6, §9**

## Context

The release audit of 14.10.2026 found that no Back Office list lets a manager choose its columns, and that neither the scope nor the wireframes ask for it ("sorting is a Sort: select"). It proposed package F — show/hide and reorder per list, remembered per user — as a new feature needing the owner's call. The owner approved it on 14.10.2026. This ADR is the record that the Back Office now goes beyond the wireframes here: every list keeps the wireframe's columns, in the wireframe's order, **by default**, and the chooser is an addition on top.

## Decision

### 1 · The control

- A **"Columns"** button in each list's toolbar (pill ghost, `btn ghost sm`) opens a **labelled modal dialog** ("Columns · Venues"): a popover under the button on a desktop, a frosted **sheet** from the bottom at ≤760 px.
- A **tick per column** shows or hides it. **Reorder three ways, never by drag alone**: a drag handle (mouse, pen, touch — pointer events, `touch-action: none`), **Move up / Move down** buttons, and **Alt+↑ / Alt+↓** on any control in the row; focus stays on the control that moved. **Reset to default** and **Done**.
- **Required columns** — the identifying first column (Name, Client, Venue, Event, Who…) and the row's actions — are ticked, disabled and **held first / last** ("Always shown · first"). A required column that is not at an end (Activity's What, Feedback's Worker) cannot be hidden but may move.
- **Accessibility:** focus moves in on open and is trapped; Escape, ×, Done or a click outside close it and focus returns to the button; every change is said in a polite live region ("Column Venue hidden", "Venue moved to position 3 of 6", "Columns reset to default"); every target is ≥44 px on a coarse pointer.
- Tokens only (`.colchooser*` in `packages/ui` components.css, the warm card shadow in warm.css, mirrored in `wireframes/assets/thc.css`; previewed in `wireframes/design-system.html` and the office `/design-system`).

### 2 · What a list declares

A screen declares its columns **once**, in their default order — `{ id, label, required, defaultVisible, width, rem, finance, className, blankHeader }` — and draws its header and each row's cells **from the resolved order** (`ColumnHeads`, `ColumnCells` with a `cells` record keyed by id). Server-rendered lists (Events list, Inbox, Financial, New Starter) use the list-keyed twins `ColumnHeadsFor`, `ColumnCellsFor`, `ColumnChooserFor`, `TableScrollFor`, which take the list key and the plain declaration and resolve the columns themselves, so the rows stay server-rendered.

**Money (ADR-0061):** a column flagged `finance` is neither drawn nor **offered** to a login without the finance permission — the chooser does not even name it. Today: /clients Avg margin (`ratesVisible`), and on the finance-only pages (/roles, /reports) the rates, payroll and bank columns are flagged too, so the rule holds if those pages ever open to another role. A stored choice can never bring one back: the screen's declaration, not the stored row, decides what may be shown.

### 3 · Lists and keys

A choice is kept **per list**, and **per view where the columns differ**:

| List | Key(s) |
|---|---|
| /staff directory · Inactive tab · Student visa | `staff.directory` · `staff.inactive` · `staff.student` |
| /clients · /venues · /roles | `clients` · `venues` · `roles` |
| /users (Back Office · Client Portal · Staff App) | `users.admin` · `users.client` · `users.staff` |
| /events list view | `events.list` |
| /compliance Needs review · Expiry radar | `compliance.review` · `compliance.radar` |
| /activity · /inbox | `activity` · `inbox` |
| /feedback client · office tabs (a grid: the tracks follow the order) | `feedback.client` · `feedback.office` |
| /reports Financial breakdown · Payroll by person · New Starter preview | `reports.financial` · `reports.payroll-people` · `reports.newstarter` |

Not included: the tables inside a record (client card, staff profile tabs), the check-in monitor and the dashboard panels — they are short, task-shaped and drawn exactly by their wireframes. Exports and PDFs always carry every column; the chooser changes the screen only.

### 4 · Where the choice lives

The ADR-0085 pattern: **`profiles.list_columns jsonb`** (`{"<list key>": {"order": [...], "hidden": [...]}}`, default `{}`, CHECK object ≤ 64 KB), read and written through two security-definer functions, own row only — `my_list_columns()` and `set_my_list_columns(p_list, p_columns)` (`NULL` = back to the default). Office logins only (a viewer included: a preference changes no data, so it is not audited); staff and client logins are refused (`not_office`); anon has no grant; `profiles` keeps its one policy, `profiles_self` (select, own row), and gains no write policy. Migration `20261014193000_list_columns.sql`, pgTAP `839_list_columns.sql`.

Only the **movable columns' order and the hidden ids** are stored. A column added to a screen later appears after its declared predecessor with its own default visibility; a removed one is skipped; a rename keeps its place.

### 5 · Loading and saving

- **First paint is right.** The root layout starts `listColumnPrefs()` (one `my_list_columns()` read, in parallel with the page's own — ADR-0109: the layout never waits) and hands the promise to `ColumnPrefsProvider`; a list resolves it with `use()`. No Suspense boundary is added, so ADR-0109's rule for query-navigated pages (/events) holds, and there is no flash of the default columns.
- **Saved debounced and optimistic.** A change shows at once; the provider saves each list 600 ms after the last change through the server action `saveListColumns`. A save that fails (offline, a lapsed session) stays queued and is sent again when the browser is back online, on the next change, or when the page is hidden. The provider lives in the root layout, so a choice survives navigation before any refresh.
- **Not in the URL.** The choice is a preference, not list state: ADR-0137's `useListQuery` keys are untouched and a shared link opens with the reader's own columns.

### 6 · With the table frame (ADR-0136)

The pinned first column(s) and the pinned `.cell-actions` stay pinned (they are required, so always first / last); the sticky header is unaffected. A table's minimum width (`--tbl-min`) follows the columns shown — the screen's figure for its default set, scaled by the width hints that are left (`scaledMinWidth`) — so hiding columns can end a sideways scroll, and fixed layouts take their widths from the remaining hints. Below 760 px a `.card-rows` table is a stack of cards, and the same choice decides which fields a card shows and in what order.

## Consequences

- `packages/ui`: `columns.ts` (pure, server-safe model), `ColumnChooser.tsx` (`useColumns`, `ColumnChooser`, `ColumnPrefsProvider`, `ColumnHeads` / `ColumnCells` and the `…For` twins); tests `columns.test.ts`, `column-chooser.test.tsx`, a snapshot in `components.test.tsx`.
- `apps/office`: `_lib/listColumns.ts`, `_lib/listColumnsActions.ts`, the provider in `app/layout.tsx`; each list above declares its columns; `/feedback`'s grid takes its tracks from `--fb-cols` / `--fb-cols-md`. Tests `_lib/__tests__/listColumns.test.ts`, `clients/__tests__/column-chooser.test.tsx`; browser `e2e/tests/office.columns.spec.ts`.
- `packages/db/src/types.generated.ts`: the column and both functions hand-added; regenerate after deploy.
- The wireframes still draw no chooser (`wireframes/design-system.html` shows the component); a screen matches its wireframe with the default columns.
