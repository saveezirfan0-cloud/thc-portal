# ADR-0187 · The office can push a worker to check in or out from the Check In / Out monitor

**Status:** Accepted · 23.10.2026 · **Adds to:** §9.5 (the live monitor), §8 N9 / N9b · **Builds on:**
ADR-0083 (notification switches), ADR-0158 (send priority), ADR-0184 (the monitor's red flags) · **Asked
by:** the office, 23.10.2026 — "can we push notify staff on Check In / Out"

`supabase/migrations/20261023130000_nudge_check_in_out.sql` · pgTAP `924`, `892` ·
`apps/office/app/checkin/` (`status.ts` `nudgeKind`, `MonitorTable.tsx`, `MonitorScreen.tsx`,
`actions.ts`, `useNow.ts`) · `wireframes/backoffice/checkin.html`

## Context

The monitor shows who has not checked in and who has not signed out. The only pushes that ever reach
those workers are the clock's: N9 thirty minutes before a start and before an end, and N9b thirty minutes
after an end — each sent once (BG-01, BG-02, BG-02b). A manager looking at a red pill had to ring the
worker, or wait.

## Decision

1. **A Remind button under the status pill**, on the rows where a push can help, sends the register's own
   words — nothing new is written:

   | Row says | Offered | Sends |
   | --- | --- | --- |
   | Due · Not confirmed today · Not checked in | from start − 30 min (when the worker's own check-in opens) until the end | N9 "Time to check in" |
   | On shift · Off-site | the last 30 min of the shift | N9 "Don't forget to check out" |
   | On shift | after the end (until end + 4 h, where No check-out takes over) | N9b "You haven't checked out of {event} yet" |
   | Checked out · No check-out | never | — a No check-out's button is locked; the office resolves it below (§9.5) |

2. **One database function holds every rule** (`nudge_check_in_out(booking)`, the monitor's own status
   from `checkin_monitor_v`, so the screen and the door cannot disagree). Owners, managers and schedulers
   (`office_can('write')`); a viewer sees the button and is refused in words, as with Verify. It goes through
   `notification_outbox` — the table stays `admin_read` (`001_rls_guard` assertion 8) — in a manual key
   family `<code>:manual:booking:<id>[:<half>]:<µs>`, so a nudge neither uses up nor is blocked by the
   once-only automatic send, and its push replaces the automatic one on the device (same deep-link tag).
   `payload` is the VALUES map the drain renders the copy with, as every other row.

3. **It refuses, with a reason shown on the row, rather than queue a push that cannot arrive:**
   `no_push_device` (the drain would fail the row — the manager needs to ring instead), `switched_off`
   (N9 / N9b off in Settings → Notifications), `sent_recently` (one per booking per 5 minutes — a double
   press, two managers on one screen), and the timing refusals above.

4. **Audited** as `booking.check_in_out_nudged` (who, which code, the status the manager saw).

5. **Nothing automatic changes.** The clock's N9 / N9b still go exactly when they did. This does not
   gate check-in or check-out, change any state, or count against the worker — it is a message.

## Consequences

- The button is hydration-safe: it needs the reader's clock, which does not exist on the server render, so
  it appears once mounted and re-evaluates every 30 s (`useNow`).
- N9 is `urgent` in `SEND_PRIORITY` already, so a nudge is not queued behind a bulk sweep.
- §9.5 does not list this control; it is a deliberate addition, noted on the wireframe.
- **Open:** whether the office also wants a free-text push to a worker or a whole event from this screen.
  That would need a new register code and copy approved by THC (§8 is the register for every push), so it
  is not here.
- Counts: `authenticated`-callable definers 218 → 219 (`892`, docs/14 §4).
