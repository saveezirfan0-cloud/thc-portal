# 06 · PWA instead of Flutter — what changes, what does not, and the one gap

The scope (§1.3, §5.1) fixes Flutter because of **background GPS tracking**: "web and hybrid apps do not hold GPS in the background". Everything else in the Staff App is ordinary app UI that a PWA does perfectly well. This note is the honest assessment so THC can sign off on the change.

## What a PWA does fully (no compromise)

| Requirement | PWA support |
|---|---|
| Installable, icon on the home screen, full-screen, THC branding | Yes (manifest + service worker). iOS: Safari "Add to Home Screen". Android: install prompt. |
| Push notifications with the app closed (§8, §10.5) | Yes: Web Push. iOS 16.4+ requires the PWA to be installed; Android Chrome fine. Permission is asked on a user gesture (screen in `wireframes/staff/auth.html`). |
| Camera for selfie + documents (3/11, 4/11) | Yes (`getUserMedia`, file input with HEIC). |
| GPS check-in / check-out with geofence verification (§5.1) | Yes while the app is **open**: `watchPosition` + server-side `ST_DWithin`. |
| Map pin for home address (2/11), venue map | Yes (Mapbox GL). |
| Offline shell, queued check-in attempts on poor signal | Yes (service worker + Background Sync on Android; retry-on-open on iOS). |
| Frosted-glass chrome, collapsing header, zero radii (§10.1) | Yes (CSS `backdrop-filter`). |
| One codebase, instant updates, no App Store review | Yes, and better than native for a Gen-Z zero-hours workforce that must onboard in minutes. |

## The gap: background geofence tracking (BG-06, BG-07, "Off-site" live status, last-on-site time)

| Behaviour in the scope | PWA on iOS | PWA on Android |
|---|---|---|
| Track GPS for the whole shift with the phone in the pocket | **No.** Safari suspends the page; no background geolocation API. | **No** reliable API. Geolocation stops when the PWA is backgrounded/screen off. |
| Detect leaving the geofence mid-shift → Violation + "Off-site" (§9.5) | Only while the app is in the foreground | Same |
| Off-site check-out uses "last known on-site time" (§5.1) | Falls back to the last foreground fix, most often the check-in itself → raises the RULE-02 "No check-out" violation path already specified | Same |

## Options (pick one at kick-off; recorded as ADR-0001)

**Option A — PWA-only v1, degraded tracking (fastest).**
Track only while the app is open; keep the Screen Wake Lock on during an active shift and show a persistent "Keep this screen open during your shift" bar. Off-site departures are caught at check-out time (server compares the check-out fix with the geofence) and via the existing "No check-out" flow. Report to THC that BG-06/BG-07 are partially met.
*Cost:* nothing extra. *Risk:* THC treats BG-06 as a contractual core requirement (§5.1 says it is).

**Option B — PWA + Capacitor shell (recommended).**
Ship the same Next.js build inside a thin Capacitor iOS/Android shell (**no Flutter, no second codebase**). The shell adds `@capacitor-community/background-geolocation` (or Transistorsoft's `background-geolocation`, paid, more robust) and posts pings to `location_pings` through the same API. Web users (browser/PWA) keep Option A behaviour; store-installed users get full BG-06/BG-07. The PWA remains the primary distribution channel; the store build exists to satisfy the tracking requirement for workers who opt in.
*Cost:* ~2 sprint-weeks in Sprint 5 + Apple/Google developer accounts (THC dependency). *Benefit:* the contract requirement is met without abandoning the PWA decision.

**Option C — Native Flutter as originally scoped.** Rejected by THC's decision to go PWA.

## Recommendation

Build the PWA as the product (all 11-step onboarding, shifts, radar, invites, documents, check-in/out, breaks, P45, conviction declaration). Design the check-in data model so both foreground fixes and native background pings land in the same `location_pings` table (already in `0001_init.sql`). Add the Capacitor shell in Sprint 5 if THC confirms BG-06 is non-negotiable; otherwise ship Option A and record the accepted limitation in the SoW change note.

## Other behaviours that change slightly

| Scope wording | PWA behaviour |
|---|---|
| "CTA download the app" after activation (§2.7) | "Install the app" screen with Add-to-Home-Screen instructions + notification permission (`wireframes/public/activate.html`, `staff/auth.html`). |
| Push "reaches the worker even if the app is closed" (§3.5, N11) | True once installed and permission granted; the activation flow makes both mandatory before the wizard starts. |
| "Pull-to-refresh" on Documents (§10.4) | Implemented in the PWA; also refreshes on focus. |
| Device-level FCM/APNs | Replaced by Web Push (VAPID). The Capacitor shell can add FCM/APNs later through the same outbox. |
