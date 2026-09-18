# ADR-0001 · Staff App as a PWA instead of native Flutter

**Status:** Accepted (THC decision, 18.09.2026) · **Supersedes:** SoW v1.6 §1.3 "Staffing App: Flutter"

## Context
The scope fixes Flutter because of background GPS tracking for the whole shift (§5.1, BG-06/07). THC has decided to build the Staff App as a PWA on the same Next.js/Vercel/Supabase stack as the web apps.

## Decision
- Build the Staff App as an installable PWA (Next.js + Serwist), Web Push for §8, foreground geolocation for check-in/out and on-site verification.
- Background geofence tracking is delivered by **Option B** in `docs/06-pwa-vs-native.md` (Capacitor shell around the same build) **if THC confirms BG-06/07 as non-negotiable at kick-off**; otherwise Option A (foreground-only tracking) ships and the SoW change note records the reduced behaviour of BG-06/07, "Off-site" live status and the "last known on-site time" fallback.

## Consequences
- One codebase for phone, tablet and browser; instant updates; no store review for the PWA.
- iOS push requires Home-Screen install; the activation flow enforces install + permission.
- The check-in data model accepts pings from either source (`location_pings`), so choosing Option B later needs no schema change.
- Contract wording: §1.3, §5.1 "Background GPS tracking…", BG-06, BG-07 and §10 heading "(Flutter, native)" are read as "PWA (+ optional native shell)".
