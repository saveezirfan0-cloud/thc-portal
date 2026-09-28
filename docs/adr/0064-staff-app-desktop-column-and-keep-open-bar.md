# ADR-0064 · Staff App: a phone column on wide screens, and the "keep this screen open" bar

Status: accepted · 28.09.2026 (product owner)

Scope v1.6 §1.2, §5.1, §10.4 · ADR-0001 · `docs/06-pwa-vs-native.md` Option A · `wireframes/staff/shift-detail.html`

## Context

1. §1.2 makes the Staff App a phone app. The wireframes draw it only inside a phone
   frame. Opened in a desktop browser, the PWA stretched edge to edge: a 2,000px
   "Edit profile" button, and four bottom tabs 500px apart.
2. ADR-0001 chose the PWA and accepted foreground-only location. `docs/06` Option A
   says what makes up for it: a Screen Wake Lock during an active shift and a
   persistent "Keep this screen open during your shift" bar. The audit of 28.09
   found neither built. Pings came every 2 minutes, and only while the shift screen
   was open, so an off-site check-out (§5.1) fell back to the check-in fix more often
   than it had to.

## Decision

1. **Phone column.** From 600px up, `.app-frame` is a `--app-col` (480px) column,
   centred, with a hairline `--line` border on each side. The fixed bottom nav and
   the onboarding footer take the same column. Below 600px nothing changes. There is
   no desktop layout, because the scope asks for none.
2. **Keep this screen open.** From check-in to check-out, the shift screen:
   - holds a wake lock (`wakeLock.ts`), asking again whenever the page is visible;
   - shows `KeepOpenBar`, a `.note.cyan` above the chargeable-time timer;
   - sends a ping as soon as the worker comes back to the page, as well as every
     2 minutes.

   The bar's second line depends on whether the lock is held: "Your screen will stay
   on…" or "Your phone may lock the screen…". A browser with no wake lock (iOS before
   16.4) still shows the bar.

## Consequences

- The wireframe's on-shift state (`shift-detail.html`) has no bar yet. This ADR is the
  record until the wireframe is redrawn.
- BG-06/BG-07 are still only partly met, as ADR-0001 says: a locked phone or a
  closed app still sends nothing.
- The N10b and N12 pushes now open `/shifts/{bookingId}`, the booking's own §10.4
  static screen, not the `/shifts` list, which drops a cancelled booking.
