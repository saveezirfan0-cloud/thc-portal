# ADR-0039 · Offer up a shift: the booking is released only when a confirmed replacement takes it

Status: proposed — awaiting THC · 25.09.2026

Addition to Scope v1.6: §3.6 (cause `handed_over`, source `offer`), RULE-04 §7 (a second
worker-initiated exit from `confirmed` under the same 72 h boundary), §10.4, §3.3, §3.4
(offer rounds), §8 (OF1–OF6), §9.12. Plan: `docs/18-staff-features-plan.md` §4. THC:
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
   N10c. Being marked unavailable (ADR-0036) does not refuse a take.
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

Bodies are in `docs/18` §4 and `packages/notifications`. A pool hand-over sends no office
email — no slot is lost (Q18); the event board shows it.

## Consequences

- **What never changes.** Fill counts only confirmed and is unchanged by an open offer;
  the buffer still displays `6 (+1)`; invitations are still never withdrawn by
  auto-assign; RULE-04's 72 h boundary and **Cancel shift** are unchanged. The client
  sees nothing new: the line-up changes only when the booking changes, exactly as for a
  Withdraw and re-fill; no client policy, no `client_*` view reads `shift_offers`
  (ADR-0004/0026). Issued PDFs and payroll exports are untouched.
- The worker sees the base rate only on an offer, never the holiday element.
- pgTAP 650, 651 (+ `490`/booking vectors with `handed_over`), 670 (offer / withdraw /
  lapse), 671 (take with every gate in one file), 672 (cover), 673 (lapse + additive
  rounds), 674 (every OF payload matches its template).
- **THC to confirm** (docs/15): Q15 — keep the event bar after a hand-over; Q16 — the
  72 h window; Q17 — peer-to-peer swaps; Q18 — office emails on hand-over / lapse; Q21 —
  the OF1–OF6 wording.
