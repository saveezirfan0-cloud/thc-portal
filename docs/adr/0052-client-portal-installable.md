# ADR-0052 · The Client Portal is installable to a home screen, with no service worker

**Status:** Accepted · 25.09.2026
**Builds on:** ADR-0001 (the Staff App PWA: same brand source and icon recipe) · ADR-0004 / ADR-0026 (what the client sees, and why it must not linger) · ADR-0007 (one switch, two grounds)
**Scope:** §1.4, §1.6, §10 (Client Portal) · **Code:** `apps/client/app/manifest.ts`, `apps/client/app/layout.tsx` (`metadata`, `viewport`), `apps/client/public/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`, generator `apps/client/scripts/gen-icons.mjs`, test `apps/client/app/__tests__/installable.test.ts`

## Context

Clients check the portal from a phone on the day of an event. Opening it means finding a browser tab or a bookmark. They asked for it on the home screen like the Staff App: "Add to Home Screen" on iOS, and the install prompt in Chrome on Android and desktop.

The Staff App got there with a manifest, icons and a Serwist service worker (ADR-0001). The worker is there for push and for the offline check-in shell, not for installability. The portal needs neither. And the portal shows worker names and photos (ADR-0004), on devices that are sometimes shared: a venue manager's office tablet, or a colleague's phone. Anything a service worker caches outlives sign-out.

## Decision

1. **A manifest, served by Next from `app/manifest.ts`.**
   - `name` "THC Client Portal", `short_name` "THC Clients".
   - `id` and `start_url` are `/client`, the event list (`docs/08`). A signed-out launch is sent to `/login` by the middleware, like any other visit.
   - `scope` is `/`, so `/login`, `/forgot` and `/reset` stay inside the installed window.
   - `display` is `standalone`.

   The client middleware's matcher already excludes `/manifest.webmanifest` and every `.png`. The browser can therefore read the manifest and the icons before anyone signs in. The test pins that, because a manifest behind a login redirect makes the app silently uninstallable.

2. **No service worker, not even a pass-through one.** Chrome's install criteria no longer require one. The published criteria are HTTPS, a manifest with a `name` or `short_name`, 192 px and 512 px icons, a `start_url`, a `display` of `standalone`, `fullscreen`, `minimal-ui` or `window-controls-overlay`, no `prefer_related_applications: true`, and a user-engagement heuristic. A service worker with a fetch handler is not among them. Sources:
   - Chrome for Developers / web.dev, "What does it take to be installable?", https://web.dev/articles/install-criteria.
   - The Chrome team's note that the fetch-handler requirement was dropped (Chrome 108 on Android, Chrome 112 on desktop).

   **Not re-fetched while writing this.** The build sandbox could not reach either page, so the Chrome version numbers need checking against the live page before this ADR is quoted to THC. The behaviour does not depend on them: any current Chrome installs without a worker.

   iOS "Add to Home Screen" has never needed a service worker. Safari reads the manifest's `display` and `name` (iOS 11.3+) and the `apple-*` tags below.

   That removes the only reason to have one. Without a worker, the portal keeps nothing in Cache Storage. Its pages are dynamic and its API calls go straight to Supabase, so the HTTP cache is the ordinary browser one. That cache is governed by the responses' own headers, and the document route already sends `no-store`. A pass-through worker would still be a registered script on the device, and whoever adds caching to it later would be one line from persisting worker photos. So there is none, and the test fails if one appears:
   - `public/sw.js` or `sw.ts`;
   - a `serwist`, `workbox` or `next-pwa` dependency;
   - a `serviceWorker.register` call anywhere in the app.

   The consequences are no offline page and no push for clients. Neither is in the scope for the portal.

3. **Colours come from the grounds the portal renders.** Both modes render `data-style="warm"` (ADR-0007), so the grounds are:
   - dark: `--bg` on `[data-style='warm'][data-theme='dark']`, navy `#0A0E18`;
   - light: `--bg` on `[data-theme='light']`, cream `#FAF7F4`.

   `theme_color` is the navy and `background_color` (the splash) is the cream, the same pairing the Staff App makes. `viewport.themeColor` is media-based: cream for `prefers-color-scheme: light`, navy for dark. The dark entry equals `theme_color`, so the title bar and the splash agree.

   The test reads `packages/ui/src/styles/tokens.css` and fails if either ground moves without the literals following. A manifest can only carry literals.

   The media query follows the OS setting, not the in-app Appearance switch. Someone on a light OS who picks dark in the portal gets a cream title bar over a navy page until `AppearanceScript` also rewrites `<meta name="theme-color">`. That lives in `packages/ui` and is left as a follow-up.

   The Staff App's `theme_color` is `#04080F`, the §1.6 scope-style navy rather than the warm one it actually renders. That is not changed here, because the Staff App is not this slice's to edit.

4. **iOS tags.** `appleWebApp` is `{ capable: true, title: "THC Clients", statusBarStyle: "default" }`, and `icons.apple` points at a 180×180 touch icon.

   The status bar style is `default` rather than `black-translucent` because the portal's sticky top bar (`.ctop` in `apps/client/app/client/client-portal.css`) does not pad for `env(safe-area-inset-top)`. A translucent status bar would draw the clock over the brand and the account menu. `viewportFit: 'cover'` is left off for the same reason.

   Switching to `black-translucent` needs two changes together:
   - `.ctop { padding-top: env(safe-area-inset-top); min-height: calc(56px + env(safe-area-inset-top)); }`
   - `viewportFit: 'cover'` in the viewport.

   The side gutters would also want `max(var(--gutter), env(safe-area-inset-left/right))` for landscape.

   Next 15 renders `capable` as `mobile-web-app-capable`. Current Safari takes standalone from the manifest either way.

5. **Icons generated from `brand/thc-mark.svg`**, never hand-placed (brand/README.md, docs/12). Run `node apps/client/scripts/gen-icons.mjs`. It rasterises with the sharp that Next already carries, as the Staff App's badge script does, so no dependency is added.

   The recipe is the Staff App's launcher icons, measured off the shipped files:
   - ground: navy mark `#04080F` on `--cyan` `#3EDCEC`;
   - mark height: ~60% of the tile for `any` and Apple, ~42% for `maskable`, inside the 80% safe circle Android crops to.

   Every tile is opaque RGB, because iOS paints a transparent touch icon black.

   | File | Size | Purpose |
   |---|---|---|
   | `icon-192.png` | 192×192 | manifest `any`, and a `<link rel="icon">` |
   | `icon-512.png` | 512×512 | manifest `any` (splash, install dialog) |
   | `icon-maskable-512.png` | 512×512 | manifest `maskable` (Android adaptive icon) |
   | `apple-touch-icon.png` | 180×180 | iOS home screen |

   The portal and the Staff App share one mark on one ground. On a phone that has both, the label ("THC Clients" / "THC Staff") tells them apart. If THC wants them visually distinct, change the ground in the generator and re-run it.

   The existing `favicon.ico` is unchanged.

## Consequences

- Chrome on Android and desktop offers installation after the usual engagement heuristic. iOS users add the portal from the Share sheet. It opens standalone at `/client`, or at `/login` when the session has lapsed.
- Nothing about workers is cached by the app itself. Sign-out on a shared device leaves no copy in Cache Storage.
- No offline fallback: opening the installed app with no signal shows the browser's own offline page. That is acceptable for a read-only portal whose data is only useful live.
- Follow-ups outside this slice:
  - `AppearanceScript` syncs `theme-color` with the in-app switch (`packages/ui`);
  - `.ctop` safe-area padding, if `black-translucent` is ever wanted;
  - the Staff App's `theme_color` could move to the warm navy.
