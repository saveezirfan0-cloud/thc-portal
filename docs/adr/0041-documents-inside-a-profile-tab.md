# ADR-0041 · Documents moves inside a Profile tab; the profile sheet becomes a screen

Status: accepted · 25.09.2026 · Staff App only; amends §10.1 "Bottom navigation" and the profile sheet's presentation

## Context

§10.1 fixes the bottom navigation as **Documents · Shifts · Invites · Radar**
and opens the profile as a sheet from the header avatar. Using the app on a
phone, THC asked for Documents to move into the profile / a menu area and for
profile editing to be easy to find:

- Documents is opened a handful of times a year; Shifts, Invites and Radar are
  opened daily. It held the first slot in the nav anyway.
- Profile details was already editable (mobile, email with a code, home
  address, a missing NI number), but it sat behind the avatar and then behind
  one of three plain links. Workers did not find it.

## Decision

1. **Tabs are Shifts · Invites · Radar · Profile** — `STAFF_TABS` in
   `apps/staff/app/profile/lock.ts`, the one list both chromes render.
2. **`/profile` is a screen, not a modal sheet.** Same content in §10.1's
   order: identity, links, sign-out, the help line as text, Request my P45
   below a dashed rule (§10.6). Added: an **Edit profile** button under the
   name (→ `/profile/details`), and one-line descriptions under each link.
3. **Documents is the first row on Profile**, with a status badge computed
   from the same `compliance_blockers()` output `appLock()` reads: *Action
   needed* (coral) when lock case 1 is waiting on a document, *In review*
   (amber) for a declaration or a replacement awaiting the office, *Up to
   date* (green) otherwise. Notifications also gets a row.
4. **`/documents` keeps its URL.** Every §8 deep link (N8, N4, N15, …) still
   lands on it. It carries "‹ Profile" above its title and lights the Profile
   tab.
5. **Lock case 1 keeps Profile instead of Documents.** `reachableTabs
   ('documents')` is `['/profile']`. The worker still has exactly one open
   tab, and Documents is its first row, marked Action needed. The lock screen
   on Shifts / Invites / Radar still links straight to `/documents`.
   Cases 2–4 are unchanged: no nav for a hold or a rejection; the leaver keeps
   the bar with all four closed and reaches Payment information from the
   leaver screen.
6. The header avatar stays and still links to `/profile`.

## Consequences

- The wireframes' staff navs are updated to the new order (`wireframes/staff/*.html`).
- `e2e/tests/staff.shell.spec.ts` asserts the new order, the Profile → Documents
  path and the case-1 nav.
- No database change: `appLock()`, the RLS and every RPC are untouched.
