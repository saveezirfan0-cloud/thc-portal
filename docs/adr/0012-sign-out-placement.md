# ADR-0012 · Where sign out sits

**Status:** Accepted. Two of the three deviations are closed; one remains, with its removal condition · **Wireframes:** `wireframes/backoffice/*.html` `.foot`, `wireframes/client/events.html`, `wireframes/staff/profile.html` · **§1.4, §10.1, §10.6**

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
4. **Back Office** — sidebar foot as an `ml-auto xs` text link, plus a phone-only copy in the topbar.
5. **Role gate exemption.** All three middlewares let a POST to `/auth/signout` through before the Supabase client is built. A session the app refuses may still end itself. It authorises nothing new — `/auth` is already in `PUBLIC_PATHS` for sessionless requests — and skipping the client also avoids a cookie race: `getUser()` refreshes a near-expiry token and writes `sb-*-auth-token` on to the same response the handler then clears, and which `Set-Cookie` survived depended on Next.js's merge order.

## Deviations

| deviation | why | state |
|---|---|---|
| ~~the sidebar foot shows no name or role~~ | the shell is rendered from client components on seven screens as well as fourteen server pages, so it cannot read `next/headers` itself | **Closed.** Not by threading a prop through twenty-one call sites — the one someone forgot would be a screen that silently lost its name — but by reading the operator once in the root layout and providing it through `SignedInAsProvider`. The foot asks context, so every screen gets the same answer without being told. |
| ~~the foot renders a pill where the wireframes draw a text link~~ | `ButtonTone` had no link variant, and hard-coding a style outside the token system is worse drift than the pill was | **Closed.** `ButtonTone` gains `link`: text, no border, no height, inherited size, so `.xs` beside it wins and the foot matches `dashboard.html:38`. In the gallery, because a tone nobody can see is a tone the next person re-invents. |
| a second, phone-only copy in the topbar | below 760px `components.css` hides `.sidebar .foot` and the rail becomes a bottom bar, which would take the only sign-out with it | **Open.** Remove when the `data-toggle-sidebar` drawer (`dashboard.html:44`) is built and the foot is reachable on a phone again. |

## Consequences

- Every app has a working sign-out, and the wrong-app page stops being a dead end.
- §10.6 wants "Request my P45" *below* the sign-out in the staff sheet, which it now is, and which a duplicate copy elsewhere in that app would have made unsatisfiable. That is the reason there is no staff sign-out outside the sheet.
- `link` is not a quieter `ghost`. `ghost` is still a control and keeps a control's hit area; `link` is text. It is for the handful of places the wireframes draw an anchor where the action must be a button — which, given `/auth/signout` is POST-only, is every sign-out drawn as a link.
- `e2e/tests/signout.smoke.spec.ts` runs on all three projects and covers what only a browser can: that the POST reaches the handler *through* the middleware, and that the wrong-app page's one button is not intercepted by the gate it has to pass. The unit suites pin the markup; they cannot see the gate.
