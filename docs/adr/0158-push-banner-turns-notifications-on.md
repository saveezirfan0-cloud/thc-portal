# ADR-0158 · The notifications banner turns them on in one tap, and stays until the worker answers

**Status:** Accepted · Scope §10.5, §8 · **Owner request:** 18.10.2026 ("users also need to be pushed to switch notifications on")

## Context

Every time-critical message a worker gets is a push: the invitation (N5), the 12:00 "I'm ready" deadline (N6/N6b), check-in and check-out (N9), and the document expiry ladder (N1–N4). A worker with no subscription misses shifts. On 18.10.2026, 15 of the 38 active workers had none, and the rest of the roster is activating by 25 October.

The Staff App already shows a push-health banner above every tab (`PushStatus`, `push-banner.ts`). Two things let workers get past it:

- **It took two steps.** The banner linked to `/notifications`, where a second button asks for permission. The permission prompt has to come from a tap, so the first screen could not do it.
- **A worker who had never been asked could hide it for seven days.** `push-banner.ts` made every state that had never worked dismissible ("advice", as opposed to a "fault"), "not yet asked" included. That is right for an iPhone in a Safari tab or a browser with no Push API, where there is nothing the worker can do. "Not yet asked" is different: the worker has simply not answered. Hiding it for a week is a week of missed invitations.

## Decision

- **The banner's button asks in the same tap** for the two states a tap can fix: _not yet asked_ ("Turn on notifications so you don't miss shifts.") and _stopped_ (push worked here and no longer does). It runs the same `enablePush()` as `/notifications`, inside the click, then records the subscription with `savePushSubscription`. On success the banner goes; nothing else changes.
- **A worker who has never been asked cannot hide the banner.** It stays until they answer. Once they have answered no, or if their browser cannot do push, the banner is the existing advice and can still be put away for seven days.
- **If they press Block at the system prompt**, the banner becomes the existing "Notifications are off — you'll miss shifts" with its Fix link, which is dismissible as before: they have answered.
- **If it does not take** (the browser subscribed and the record did not, or the browser returned something unreadable), the banner says "That didn't work — open Notifications for help." and links to `/notifications`, which explains each case. It never reports success it did not get.
- `/notifications` is unchanged and remains the long explanation and the way back for a worker who has switched them off.

## Not done, on purpose

- **No full-screen block and no gate on using the app.** A worker who cannot turn them on (an iPhone in a Safari tab, a desktop browser) must still be able to see and accept shifts; the banner points them at install or the right browser instead.
- **No email or push-from-the-office campaign.** Emailing the workers without notifications is a separate decision: it sends to real people, so it goes through the §8 register and the outbox in its own change, when THC wants it. The office can already see who has notifications off (the Send push dialog names them, ADR-0082).
- **No change to when the prompt may appear.** The browser's own prompt still comes only from a tap, never on load.

## Consequences

- The banner is permanent for a never-asked worker. That is deliberate; the cost is one line of chrome until they tap once.
- On the Staff App, `PushBanner` gains `action: 'enable' | null`; `PushBannerView` takes `onEnable`, `enabling` and `failed`.
- `push-banner.test.tsx` no longer expects `default` to be dismissible; `push-status-enable.test.tsx` holds the tap.
