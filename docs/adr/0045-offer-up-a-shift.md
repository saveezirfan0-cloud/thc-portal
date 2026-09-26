# ADR-0045 · Offer up a shift: the booking is released only when a confirmed replacement takes it

Status: proposed — awaiting THC · 25.09.2026

Addition to Scope v1.6: §3.6 (cause `handed_over`, source `offer`), RULE-04 §7 (a second
worker-initiated exit from `confirmed` under the same 72 h boundary), §10.4, §3.3, §3.4
(offer rounds), §8 (OF1–OF6), §9.12. Plan: `docs/19-staff-features-plan.md` §4. THC:
Q15–Q18, Q21 (`docs/15-open-questions.md`).

## Context

A worker who can no longer make a confirmed shift has one tool today: **Cancel shift**
(RULE-04), open until 72 h before the start. Cancelling frees the slot at once and
auto-assign refills it — or doesn't, and the client line-up is short. Inside 72 h the
worker can only email the office.

The product owner approved "offer up a shift": the worker releases the shift to other
workers, and it is only theirs once somebody else has it. The risk is a hand-over that
bypasses a rule a normal booking has to pass — the hard gates, RULE-17's wave order, the
self-cancel exclusion, the weekly cap — or that leaves the slot empty between two
steps.

## Decision

1. **Pool offers while more than 72 h remain** — exactly `canCancelShift()` — and only
   while auto-assign is ON for the event and role; if it is OFF, the worker can only ask
   the office. The offerer **stays confirmed**: fill, buffer (`6 (+1)`), `shift_fill`,
   `accept_invite` and the client line-up are unchanged. The offer lapses at start − 72 h
   (OF3; still booked).
2. **`take_offered_shift()` is one transaction** under the same `shift_requirements …
   for update` lock every slot path takes. The taker passes **every** hard gate from
   `auto_assign_candidates(shift)` — wrong role, do-not-return, blocked, self-cancelled,
   booked elsewhere (incl. the 2 h different-venue gap), right-to-work expired, weekly
   cap — plus `accept_invite`'s overlap and cap re-reads, and the rota-guard trigger
   fires. RULE-17 order holds: an unqualified taker gets `not_yet` until
   `offer_wave1_exhausted(offer)`. Then the taker's row → `confirmed`
   (`source = 'offer'`); the original → `cancelled`, `cancel_cause = 'handed_over'`,
   `self_cancelled = true`; the offer → `taken`; the taker's overlapping invitations are
   withdrawn as on Accept; OF2 + OF4 queued. The confirmed count is net zero, so no
   N10c. Being marked unavailable (ADR-0042) does not refuse a take.
3. **Inside 72 h, only through the office.** "Ask the office for cover" creates an
   `office` offer (not visible, not pushed); OF5 emails admin@ at once; the worker stays
   confirmed. The office **opens it to the pool** (mode `pool`, expiring at the section
   start; after the start the escalation job owns the section), **declines** it (OF6),
   or covers by hand with the existing **Withdraw**.
4. **A completed hand-over bars the offerer from the event** (`self_cancelled = true`,
   RULE-04). Otherwise offering would bypass the self-cancel exclusion (Q15).
5. **Peer-to-peer is designed, not built** (`settings.shift_offers_direct_enabled =
   false`, Q17): mode `direct` to a colleague named by Employee ID (no directory exposed,
   generic refusal), target qualified at client + role, the same `take_offered_shift`;
   a two-way swap is two `direct` offers sharing `swap_group_id`, accepted atomically,
   each leg checked against current state with no credit for the shift given away.
6. **Automatic lapse.** A trigger `after update of status on bookings` lapses the
   booking's open offer when it leaves `confirmed` by any other cause (Withdraw, 12:05
   cutoff, block, leave, GDPR, event cancelled, self-cancel).
7. **Surfaces.** Staff App (`scheduling`): on `/shifts/:id` **Offer this shift**, an
   "Offered · open until …" chip with **Withdraw offer**, and inside 72 h "Can't make it?
   **Ask the office for cover**"; **Cancel shift** is unchanged. `/radar` gains an **"Up
   for grabs"** group (RULE-17 visibility) and `/radar/offers/:id` with **Take this
   shift**. Radar lists offers through a definer RPC that **never returns the offerer**.
   Back Office: Confirmed-row chips "Offered up · until {UK}" / "Asked for cover:
   {note}" with **Open to pool** / **Decline** on `/events/:id`, and a per-section
   "Handed over: {from} → {to} · {date}" line.

### Data model (Phase 0)

`shift_offers`: `id`, `booking_id → bookings`, `shift_id` (denormalised),
`offered_by_staff_id`, `mode 'pool'|'office'|'direct'`, `target_staff_id` (iff direct),
`swap_group_id`, `status 'open'|'taken'|'withdrawn'|'lapsed'|'cancelled'`, `note` ≤ 300,
`created_at`, `expires_at`, `closed_at`, `closed_reason`, `taken_by_booking_id`,
`taken_by_staff_id`, `decided_by`. Partial unique `(booking_id) where status = 'open'`.
`shift_offer_transitions()` + `shift_offers_state_guard`: `open → taken | withdrawn |
lapsed | cancelled`, the rest terminal; mode may change only `office → pool` while open;
booking and target immutable. `shift_offer_notices(offer_id, staff_id, notified_at)`
makes rounds additive. `bookings_cancel_cause_check += 'handed_over'`; `booking_source +=
'offer'` (its own migration — `alter type … add value` cannot share a transaction with
its use). RLS: one `admin_read` select policy on both tables; no staff or client policy.
TS twin: `packages/domain/src/shiftOffer.ts` and `state.ts` (`SHIFT_OFFER_TRANSITIONS`,
`CANCELLED_CAUSES += 'handed_over'`), held to `shiftOffer.vectors.json` (take refusal
order `event_cancelled` › `offer_not_open` › `offer_expired` › `original_not_confirmed`
› `own_offer` › `section_started` › gate by name › `not_yet` › ok).

### Notifications (drafts, `ADDITION_CODES`)

| Code | Channel · to | Title / subject | Timing · key |
|---|---|---|---|
| OF1 | push · candidate | Shift up for grabs | hourly, `allocation_per_hour` per round, wave 1 first, never after expiry · `OF1:offer:<offer>:<staff>` |
| OF2 | push · offerer | Shift handed over | on take · `OF2:offer:<id>` |
| OF3 | push · offerer | You're still booked | on lapse by expiry only · `OF3:offer:<id>` |
| OF4 | push · taker | You're booked! | on take · `OF4:offer:<id>` |
| OF5 | email · admin@ | Cover requested — {event} · {role} · {date} | immediately · `OF5:offer:<id>` |
| OF6 | push · offerer | Cover request closed | on decline · `OF6:offer:<id>` |

Bodies are in `docs/19` §4 and `packages/notifications`. A pool hand-over sends no office
email — no slot is lost (Q18); the event board shows it.

## Consequences

- **What never changes.** Fill counts only confirmed and is unchanged by an open offer;
  the buffer still displays `6 (+1)`; invitations are still never withdrawn by
  auto-assign; RULE-04's 72 h boundary and **Cancel shift** are unchanged. The client
  sees nothing new: the line-up changes only when the booking changes, exactly as for a
  Withdraw and re-fill; no client policy, no `client_*` view reads `shift_offers`
  (ADR-0004/0026). Issued PDFs and payroll exports are untouched.
- The worker sees the base rate only on an offer, never the holiday element.
- pgTAP 700, 701 (+ `490`/booking vectors with `handed_over`), 720 (offer / withdraw /
  lapse), 721 (take with every gate in one file), 722 (cover), 723 (lapse + additive
  rounds), 724 (every OF payload matches its template).
- **THC to confirm** (docs/15): Q15 — keep the event bar after a hand-over; Q16 — the
  72 h window; Q17 — peer-to-peer swaps; Q18 — office emails on hand-over / lapse; Q21 —
  the OF1–OF6 wording.

## Amendment · as built (Phase 1, Agent A — `20260930201100_shift_offers.sql`)

The decision above stands. Where the build had to choose, it chose this:

1. **Three functions beyond docs/19's list.** `staff_booking_offers()` (worker: their
   live confirmed bookings with the auto-assign switch and the open offer — what
   `/shifts` and `/shifts/:id` need without restating `staff_bookings()`),
   `offer_rounds_due()` (service: the open pool offers an hourly round serves) and
   `queue_offer_notice()` (internal, not an RPC: the one writer of OF1–OF6).
2. **OF1 pushes follow the auto-assign switches.** Pushing is something the machine does,
   so, like every other round (§3.4), no OF1 goes out unless the event AND the role
   switch are on — including for a cover request the office opened to the pool. Radar
   still shows an open pool offer either way.
3. **OF3 only for an offer that went to other workers.** A cover request the office never
   opened lapses at the section start silently: nobody was asked, and the office already
   had OF5.
4. **RULE-17 is re-checked in SQL.** `notify_offer_candidates()` takes wave 1 first
   whatever order it is given, and refuses a wave-2 push while a wave-1 worker is still
   untold. `offer_wave1_exhausted()` leaves out wave-1 workers marked unavailable
   (ADR-0042): the calendar keeps the pushes from them, so waiting for them to be told
   would wait for ever.
5. **Ask the office for cover** is offered inside 72 h, and also further out when
   auto-assign is off (the wireframe's (a) note). More than 72 h out with auto-assign on,
   `request_cover()` refuses `use_offer`.
6. **The decline note is the office's record** (`closed_reason`), never sent: OF6 has no
   note placeholder, and the worker is told only that the request is closed.
7. **An unknown offer id reads `offer_not_open`**, so an id tells a caller nothing.
8. **Take refusals reuse Radar's copy** (wireframe (j)): an offer taken, withdrawn,
   lapsed or not yet visible to the worker reads as "Sorry, this shift is now full";
   `overlap` as Radar's booked-elsewhere line; the gates by their Radar names.

## Amendment · review fixes (`20260930205000_shift_offers_review_fixes.sql`)

QA and the security review of the as-built slice. The decision stands; these change how
it is held:

1. **Auto-assign off releases wave 1 at once (QA S1).** OF1 follows the switches (as
   built, 2), so with the event's or the role's auto-assign off nobody was ever told an
   offer and `offer_wave1_exhausted()` never became true — a cover request the office
   opened to the pool was invisible and untakeable for every unqualified worker.
   `offer_wave1_exhausted()` is now true whenever `not (event.auto_assign and
   section.auto_assign)`: on a hand-picked section the office opening it to the pool
   is the release. With both switches on, RULE-17's order is unchanged. The TS twin is
   `offerWave1Exhausted(autoAssign, allWave1Told)`, used by `takeOffer()` and
   `offerVisibleTo()`.
2. **Lock order (QA S2).** `take_offered_shift()` locks section → the offerer's booking
   → the offer, the order every other exit from confirmed takes (it holds the booking,
   then `bookings_offer_lapse` updates the offer). It reads the offer's booking id
   unlocked first — safe, the state guard keeps it immutable — and re-checks the offer
   under its own lock.
3. **The caller (security #4).** `offer_shift`, `withdraw_shift_offer`, `request_cover`
   and `take_offered_shift` resolve the caller with `staff_caller()` and refuse as
   `20260930202000` does, all `P0001`: `unknown_staff` (no staff row — the office too;
   this replaces `42501 not_a_worker`), `account_closed` (removed), `not_editable`
   (inactive, rejected).
4. **OF5 is keyed on the booking (security #1).** `OF5:booking:<booking>`, so asking,
   withdrawing and asking again emails admin@ once per booking; and `request_cover()`
   refuses `recently_requested` while a withdrawn cover request on the booking closed in
   the last 24 hours. The register row's key changes with it; the copy does not.
5. **The decline note is not audited (QA S4, part).** `office_decline_cover()` writes
   `has_note` to `audit_log`, never the office's free text, whose one home stays
   `shift_offers.closed_reason`. Scrubbing rows written before this is the platform's
   GDPR job, not this migration's.
6. **No OF3 after the start.** `lapse_shift_offers()` sends OF3 only while the section
   has not started; after it "you're still booked" tells nobody anything.
7. **Close times are scheduled times (QA S3, §1.8).** The "Offered · open until …"
   chip, the `/shifts` card line and Radar's "open until …" say "(UK time)" and add a
   "your time" line when the phone's zone differs (`yourTimeAt()`, `YourTimeAt`); so do
   `/radar/offers/:id` and the `/shifts` "check out before …" line.
8. **`/shifts/:id/calendar.ics` follows the app lock (security #2).** 404 unless
   `loadProfile()` returns a profile and `appLock(profile) === 'none'`.
9. **Domain twin.** `takeOffer()` takes the offer's `mode` (an unopened `office`
   request, or a `direct` offer to someone else or while disabled, is
   `offer_not_open`; `not_yet` applies to pool offers only) and `autoAssign`;
   `offerVisibleTo()` takes the viewer's own booking status on the section — only none,
   `invited`, `applied` or `closed` may see an offer, as `staff_open_offers()` filters.
   Vectors in `shiftOffer.vectors.json`; pgTAP 720–724 hold the SQL side.
