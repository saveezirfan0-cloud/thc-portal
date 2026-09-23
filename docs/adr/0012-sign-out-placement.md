# ADR-0012 · Where sign out sits, and the two places it is not yet the wireframe's

**Status:** Accepted; both deviations are temporary and carry removal conditions · **Wireframes:** `wireframes/backoffice/*.html` `.foot`, `wireframes/client/events.html`, `wireframes/staff/profile.html` · **§1.4, §10.1, §10.6**

## Context

`/auth/signout` answers POST only, deliberately: a GET sign-out is fired by anything that makes the browser issue one — a link prefetch, an `<img src>` on a page a worker is reading — and would end a session mid-shift. Two callers used links, so both returned 405:

- the Client Portal's top-bar button, so every click on Sign out there was broken;
- the wrong-app interstitial in `packages/db/src/roles.ts` — the only page a session holding another app's role can reach, whose sign-out is the only thing on it that can help.

The interstitial was stuck twice over: the role gate ran before `/auth/signout` was reached and answered the POST with the same page.

The Back Office had no sign-out control at all, on any screen.

The Staff App already had one in the right place. `#42`/`#43` built `/profile`, and `ProfileSheet` signs out by POST from the profile sheet behind the header avatar, exactly as §10.1 and `wireframes/staff/profile.html` require. `LockScreen` carried its own copy of the same form.

## Decision

1. **One `SignOut` in `packages/ui`.** A form POST, never a link, `display: contents` so it drops into the flex rows the wireframes put it in. Every caller uses it — including the Staff App's sheet and lock screens, whose hand-rolled forms (one of them a local `SignOut()` function in `LockScreen`) are replaced by it. Four hand-written copies of one form is how a fifth gets written as a link.
2. **Client** — top bar, unchanged in position, now a POST.
3. **Staff** — nothing moves. The sheet already had it right; this only consolidates the markup. `SignOut` keeps the wireframe's styling at each site (`btn block` in the sheet, `btn ghost block` on the lock screens) through `tone`/`size`/`block`.
4. **Back Office** — sidebar foot, with the identity line behind an optional `user` prop, plus a phone-only copy in the topbar.
5. **Role gate exemption.** All three middlewares let a POST to `/auth/signout` through before the Supabase client is built. A session the app refuses may still end itself. It authorises nothing new — `/auth` is already in `PUBLIC_PATHS` for sessionless requests — and skipping the client also avoids a cookie race: `getUser()` refreshes a near-expiry token and writes `sb-*-auth-token` on to the same response the handler then clears, and which `Set-Cookie` survived depended on Next.js's merge order.

## Deviations, both in the Back Office only

| deviation | why | removed when |
|---|---|---|
| the sidebar foot shows no name or role until a caller passes `user` | five screens render `OfficeShell` from a client component (`StaffScreen`, `RolesScreen`, `ClientsScreen`, `ClientCard`, `ProfileScreen`), and a `next/headers` read anywhere in the shell's import graph fails their build, so the shell cannot look the operator up | server pages pass `user` |
| a second, phone-only copy in the topbar | below 760px `components.css` hides `.sidebar .foot` and the rail becomes a bottom bar, which would take the only sign-out with it | the `data-toggle-sidebar` drawer (`dashboard.html:44`) is built |

## Consequences

- Every app has a working sign-out, and the wrong-app page stops being a dead end.
- The office foot renders `btn ghost sm`, a pill, where the wireframes render an `ml-auto xs` text link. `ButtonTone` has no link variant. Left as drift rather than hard-coding a style outside the token system — a `link` tone is the fix and belongs to the design system.
- §10.6 wants "Request my P45" *below* the sign-out in the staff sheet, which it now is, and which a duplicate copy elsewhere in that app would have made unsatisfiable. That is the reason there is no staff sign-out outside the sheet.
