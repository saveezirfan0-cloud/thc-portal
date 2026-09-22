# ADR-0012 · Where sign out sits until the screens that own it exist

**Status:** Accepted, and both deviations are temporary · **Wireframes:** `wireframes/backoffice/*.html` `.foot`, `wireframes/staff/profile.html`, `wireframes/client/events.html` · **§1.4, §10.1, §10.6**

## Context

`/auth/signout` answers POST only, deliberately: a GET sign-out is fired by anything that makes the browser issue one — a link prefetch, an `<img src>` on a page a worker is reading — and would end a session mid-shift. Both call sites in the product were links, so every Sign out in the Client Portal returned 405, and the wrong-app interstitial in `packages/db/src/roles.ts` — the only page a session with another app's role can reach — had no working way out at all. The Back Office and Staff App had no sign-out control of any kind, though every one of their wireframes carries one.

Putting the control where the wireframes put it is not available in two of the three apps yet:

- **Staff.** §10.1 and `wireframes/staff/profile.html:67` place it in the profile sheet behind the header avatar, above the help line. That sheet is `staff-pwa`'s (`docs/08-screen-inventory.md`) and does not exist; `/profile` is not a route.
- **Back Office.** `wireframes/backoffice/dashboard.html:38` puts avatar + name + role + Sign out in the sidebar foot. Five screens render `OfficeShell` from a client component (`StaffScreen`, `RolesScreen`, `ClientsScreen`, `ClientCard`, `ProfileScreen`), so a `next/headers` read anywhere in the shell's import graph fails their build — the shell cannot look the operator up.

## Decision

Ship the working control now, in the nearest place that exists, and record what has to change.

1. **Staff — header `actions` slot, interim.** This is the slot §10.1 reserves for the worker avatar, which is also the thing that opens the sheet. When `/profile` lands, the sign-out **moves** into the sheet and is **removed** from the header — not duplicated: §10.6 requires "Request my P45" to sit *below* the sign-out, which is unsatisfiable while a second copy lives in the header. Target styling there is `btn block` (default tone, full width), not the `ghost sm` default.
2. **Back Office — sidebar foot, with the identity line driven by an optional `user` prop.** The button renders unconditionally; the avatar/name/role block appears once callers pass `user`. Server pages can do that today.
3. **Back Office — a second, phone-only copy in the topbar.** Below 760px the sidebar becomes a bottom bar and `components.css` hides `.sidebar .foot`, which would take the only sign-out with it. `.only-phone` carries a copy at that breakpoint. The wireframes' own answer is the `data-toggle-sidebar` hamburger (`dashboard.html:44`), which is not built; when it is, this copy goes.
4. **Role gate exemption.** All three middlewares let a POST to `/auth/signout` through before the Supabase client is built. A session the app refuses may still end itself — otherwise the interstitial's button re-renders the interstitial. It authorises nothing new, since `/auth` is already in `PUBLIC_PATHS` for sessionless requests.

## Consequences

- Every app has a sign-out that works, and the wrong-app page stops being a dead end.
- Three deviations from the visual contract, each with a removal condition: staff header (drop when `/profile` ships), office identity line (drop when callers pass `user`), office phone copy (drop when the sidebar drawer ships).
- The office foot renders `btn ghost sm`, a pill; the wireframes render an `ml-auto xs` text link. `ButtonTone` has no link variant. Left as drift rather than hard-coding a style outside the token system — a `link` tone is the fix, and belongs to the design system, not here.
- Skipping the Supabase client on the sign-out path also removes a cookie race: `getUser()` refreshes a near-expiry token and writes `sb-*-auth-token` on to the same response the handler then clears, and which Set-Cookie survived depended on Next.js's merge order.
