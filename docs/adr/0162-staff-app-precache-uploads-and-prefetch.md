# ADR-0162 · Staff App go-live, second wave: a small precache, plain uploads, fewer prefetches

Status: accepted · 19.10.2026

Scope v1.6 §10.5 (PWA), §10.3–§10.4, §2.1 · ADR-0001 (docs/06) · ADR-0152 (the first wave) ·
`apps/staff/{sw.ts,next.config.ts}` · `apps/staff/lib/{sw-precache,sw-cache}.ts` ·
`apps/staff/app/_lib/{stale-deploy,signed-upload}.ts` · `apps/staff/app/error.tsx` ·
`apps/staff/app/_components/{ServiceWorkerRegistrar,preloadShell}.ts(x)` ·
`apps/staff/app/onboarding/{page,[step]/page,data,own-staff-facts}.ts(x)` ·
`apps/staff/app/{shifts,invites,radar}/page.tsx`

## Context

The go-live audit's remaining Staff App items, after ADR-0152:

- **M4.** The service worker precached every file the client build emitted:
  115 entries, ~2,022 KiB raw (~839 KiB gzipped). That is every route's chunks,
  the Pages Router's framework and polyfills (an App Router page loads
  neither), and all twelve font files. Every phone fetched it in the
  background on its first visit, and again for whatever changed after each
  deploy, on venue signal, while the worker was checking in.
  `skipWaiting` + `clientsClaim` then hand open tabs to the new worker and
  drop the old precache. A tab still running the previous build asks for
  chunks the server no longer has, and its next screen fails with a
  `ChunkLoadError`.
- **L1.** The upload screens loaded the whole Supabase browser client
  (~54 KB gzipped: auth, realtime, PostgREST) to make one
  `uploadToSignedUrl` request.
- **M5.** Documents and the onboarding steps read one thing after another.
  `/onboarding/[step]` ran up to five serial stages, three of them one-row
  selects of the same `staff` row.
- **L4.** Every card on /shifts, /invites and /radar prefetched its own URL.

## Decision

1. **Precache the working tabs only.** A manifest transform
   (`lib/sw-precache.ts`) keeps the scripts and stylesheets of the App Router
   runtime (`main-app`), the root layout and its error and not-found
   boundaries, `/`, `/shifts`, `/shifts/[id]`, `/invites`, `/radar`,
   `/documents` (with their loading skeletons) and `/offline`. That is
   32 entries, ~625 KiB raw / ~188 KiB gzipped. No fonts: the browser fetches
   only the subsets a page draws, and offline a missing face falls back
   (`font-display: swap`). A named entry the build does not have **fails the
   build**, so a renamed route can never leave the precache silently empty.
   Everything else under `/_next/static/` loads on first use and is kept
   **cache-first** in one cache, `next-static` (256 entries, 30 days from last
   use). The files are content-hashed, so a hit cannot be stale. The three
   `defaultCache` caches this replaces are deleted on activate. Nothing
   about personal data changes: pages, RSC payloads and Supabase stay
   network-only, and `cacheOnNavigation` stays off.
2. **A tab older than the deploy reloads once.** `isStaleChunk()` recognises
   webpack's `ChunkLoadError` and CSS chunk failures, and the browsers'
   failed-`import()` messages. The error boundary, and a window listener for
   rejections no boundary catches, reload through ADR-0152's
   once-a-minute guard. The guard is shared with stale server actions, so
   the two cannot reload in turn. They never reload while the phone is
   offline, because then the chunk is missing for want of a network.
   `skipWaiting` stays: a worker must not be left on a stale build of the
   check-in screen.
3. **An upload is one PUT.** The start actions return Storage's signed upload
   URL, and the browser sends the file with `fetch`
   (`app/_lib/signed-upload.ts`), using the headers the library sent. The
   object name is still built on the server from the session. The checks on
   the phone, in the start action, and in the finish action's read-back of
   what Storage recorded are unchanged. The selfie's URL is signed by the
   worker's **own session**, so Storage checks `photos_worker_insert_own`
   before it signs, and there is still no service key. Onboarding step 4 now
   sends the server-derived content type. The library had replaced it with
   the picker's own. First Load JS on the upload routes drops by ~69 kB
   (e.g. `/documents/upload/[docType]` 217 → 148 kB,
   `/onboarding/[step]` 227 → 158 kB).
4. **Read in waves.** `preloadShell()` starts the header photo's signature as
   soon as `staff_me()` names it. Documents is now `staff_me` →
   (documents, right-to-work checks, signature). The documents still wait
   for the gate: a held, quiz-failed, leaver or removed worker's documents
   are never read, not even speculatively. `/onboarding/[step]` is now
   `onboarding_state` → (signature, one own-row select of the four
   columns, step 6's questions). `/onboarding` decides from its first
   wave where the worker goes, so passing through costs nothing more.
5. **Cards do not prefetch.** Per-card links take `prefetch={false}`. Today's
   card keeps prefetching (the tap at the venue door), and so do the segment
   links and the bottom tabs. Distinct prefetching URLs, on the same fixture:
   /shifts 17 → 4, /shifts?tab=open 14 → 2, /radar 12 → 0, /invites 6 → 0.

## Consequences

- A screen first opened offline that is not a working tab (an onboarding
  step, a profile sub-page) shows `/offline`, as any uncached page always
  did. Once opened online, its chunks are kept for 30 days.
- `/profile/details` and its change requests still load the browser client
  (218 / 214 kB). They are a separate change, and `putSignedUpload` is there
  for them.
- The Staff App's Content-Security-Policy, when it lands, must keep the
  Supabase origin in `connect-src`: the PUT goes there directly, as the
  library's request did.
- Vercel Skew Protection would let an old tab keep loading its own chunks
  instead of reloading. It is a project setting and is left to the operator,
  as in ADR-0152.
