# ADR-0036 · Staff App: failed reads, the shift screen's whole-screen states, and check-out's GPS reading

Status: accepted · 30.09.2026 (fix round WP-D, ported onto main after #65/#67/#68)

The 25.09 audit (D14, D16, D18 and the `/shifts/:id` screen review) left
some choices the scope does not make word for word. This records them so the
next reader does not re-derive them. Every one is the literal scope reading
with a default THC can change.

The §3.2 turn-away (D19) is not decided here: main shipped it independently
(`staff_shift_detail()`'s `turned_away_at` and `turned_away_pay_min` in
20260928120000, `TurnedAwayScreen.tsx`, the copy in `@thc/domain`), and this
round builds on it rather than restating it.

## 1 · A failed read is never an empty answer (D16, D18)

- The list loaders return `{ rows, problem }`; `findBooking()`,
  `findOpenShift()` and the Radar week meter (`loadWeekMeter()`) return
  `{ row, problem }`; and `loadShift()` returns `{ shift, problem }`. A screen
  checks `problem` before it shows an empty state or calls `notFound()`, and
  shows `<LoadProblem>` instead: "We couldn't load your shifts — pull to
  refresh or try again", a retry button, and the office's address. The pull
  gesture and the button both re-run the server read. A badge the failed
  read cannot vouch for is left off rather than shown as 0.
- `readProfile()` answers `unconfigured`, `ok` or `problem`. `StaffShell`
  **fails closed** on `problem`: no tabs, no avatar, no content, only the
  retry. The one exception is a screen that renders its content whatever the
  lock says (`ignoreLock`: /install, /notifications). It keeps its content and
  still loses the tabs. Only an environment with no Supabase project runs
  unlocked, as before. main's signed header selfie (`signOwnPhoto`) is kept.
- Where a screen cannot go on without a read (onboarding state, earnings, a
  profile page other than /profile), the loader throws `StaffLoadError` into
  `app/error.tsx`. That boundary is also fail-closed: phone chrome, no tabs,
  the worker's words and the digest. It never shows the exception text.
  `app/not-found.tsx` is the same chrome. The Client Portal gains its own
  `error.tsx` / `not-found.tsx` on the sign-in card.
- The "no Supabase project … docs/04" developer message now appears only when
  the project really is not configured.

## 2 · Check-out takes its own GPS reading (D14)

The press asks for a **new** reading (`maximumAge: 0`) and waits **8 seconds**
at most (`CHECK_OUT_FIX`, `apps/staff/lib/geo.ts`). If no reading arrives in
time, the press goes with **no coordinates**, so `check_out()` records the
last on-site fix from the ping trail, or raises RULE-02's No check-out. The
reading the screen was holding is never sent: `pressCheckOut()` has no
parameter it could arrive through. Check-in also reads at the press, but a
reading up to 5 s old is accepted there, because the phone is in the worker's
hand at the door. main's rule that check-out opens only at the role
section's start is kept.

## 3 · The shift screen against `wireframes/staff/shift-detail.html`

- **Map.** ADR-0005's approach: the onboarding pin map's Web Mercator maths,
  the design system's map ground, and Mapbox raster tiles only when a token is
  set. Nothing pans or zooms. The frame fits the geofence and the worker at
  the largest whole zoom down to 10. A worker who would need a wider view is
  drawn at the frame's edge, on the bearing towards them ("you — off the
  map"), so the map is never zoomed out to a county.
- **Whole-screen states** replace the live screen, as in the wireframe
  (`FullScreens.tsx`):
  - (i) off-site check-out, with "Continue to summary";
  - (j) no on-site fix, with "OK, I understand";
  - (k) "Shift complete — thank you, [first name]", with Done;
  - (l) "Not attended" / "Check-in closed".
  - (m), the turn-away, stays main's `TurnedAwayScreen`.
- **A booking confirmed after the start** (§3.4) is told that check-in stays
  open until the end of the shift. It is never told the start+30 lock. The
  "not attended" copy names the end as the lock. `checkInWindow()` carries
  `confirmedAfterStart`, so the phase, the screen and the today card read the
  same lock.
- **Times** in running text carry "(UK)", plus "· HH:MM your time" when the
  phone is in another zone (§1.8, `UkTime`).
- **Cancel shift** appears on the detail screen before the check-in window,
  while more than 72 h remain. The list and the detail screen use one
  component (`CancelShift`). After a successful cancel the worker goes back
  to /shifts.

## 4 · Today's card carries the check-in (§10.4)

The card's primary button, "Check in — verify GPS", opens
`/shifts/:id?checkin=1`. That screen starts the GPS reading on arrival and
presses check-in by itself, once, when the worker is inside the geofence.
There is still exactly one implementation of the map, the distance line and
the turn-away. The on-day confirm is a reminder that never blocks check-in:
while it is outstanding the card shows "Not confirmed today" and the confirm
button, and the check-in button is still there. The check-in button becomes
the primary one once the window opens.

## 5 · Smaller copy decisions

- The Invites pill shows relative time on the UK calendar: "just now",
  "N min ago", "N h ago" (same UK day), "yesterday", "N days ago", then the
  date as "12 Sep".
- /notifications labels its four rows "Invitations", "Deadline",
  "Check-in" and "Documents". The register codes (N5, N6, N9, N1) are not
  shown to workers, and neither are E3 / E7 in the activation, onboarding
  address and profile details copy.
