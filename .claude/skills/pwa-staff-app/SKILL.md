---
name: pwa-staff-app
description: Build and test the Staff App as an installable Next.js PWA (Serwist service worker, Web Push, geolocation, camera, offline queue, app-lock routing) and know the limits versus native. Use when working in apps/staff or on push/geolocation.
---

# Staff App as a PWA

## Stack

Next.js App Router + `@serwist/next` (service worker at `apps/staff/sw.ts`), `manifest.webmanifest` (name "The Hospitality Company", short_name "THC", `display: standalone`, `theme_color #04080F`, `background_color #04080F`, maskable icons from THC's logo (B4)).

## Push

- Generate VAPID keys once (`npx web-push generate-vapid-keys`); public key in `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, private in Supabase secrets.
- Subscribe right after activation on a user gesture (`/notifications` screen); POST the subscription to `push_subscriptions`; handle `pushsubscriptionchange` in the SW.
- iOS: only for PWAs added to the Home Screen (iOS 16.4+); show the install screen first.
- The SW `push` handler shows the notification and `notificationclick` deep-links (`/shifts/<id>`, `/documents`, `/invites/<id>`).

## Geolocation

- `navigator.geolocation.watchPosition` with `enableHighAccuracy` during an active shift; keep `navigator.wakeLock.request('screen')` while checked in; compute distance on device (`packages/domain/geo.ts` haversine) for the UI and let the server verify with `ST_DWithin` on check-in/out.
- Post fixes to `location_pings` every 60 s while the app is open. Background tracking is NOT possible in a PWA; the Capacitor shell (`docs/06-pwa-vs-native.md`) uses the same endpoint.

## Camera / files

`<input type="file" accept="image/*,.pdf,.heic" capture="user">` for selfie (front camera) and documents; client-side resize to ≤ 10 MB; upload to Storage via signed upload URL.

## Offline

Precache the app shell and the last-loaded Shifts/Documents data; queue check-in attempts (`attempted_at` from the device clock, corrected with server offset) with Background Sync where available and replay on reopen elsewhere.

## App-lock routing

`(app)/layout.tsx` reads `staff.status` + `block_kind` and renders: normal · documents-only · manual-hold screen · quiz-failed screen · leaver screen (Payment info only). Never expose the manual block reason.

## Testing

Lighthouse PWA audit in CI; Playwright with geolocation context (`context.setGeolocation`) for in/out of radius; a real-device checklist for iOS install + push before each release.
