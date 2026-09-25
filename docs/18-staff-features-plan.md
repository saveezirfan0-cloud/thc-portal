# 18 · Staff App additions — five features, planned

> **Status:** plan · 25.09.2026. The product owner approved all five. Each is an **addition to Scope v1.6**, so each gets its own ADR (0036–0040, **status: proposed — awaiting THC**) and questions in `docs/15-open-questions.md` → *Questions for THC* (Q9–Q21, §7). Every question has a working default, so the build does not wait on THC.
>
> Saved as `18-` because `16-owner-guide.md` and `17-inputs-from-thc.md` already exist. ADR-0041 (the Past shifts section on `/shifts`) is taken by the quick-wins round.

---

## 0 · Ground rules for all five features

None of these loosens an existing rule.

1. **The client sees none of this.** None of the seven new tables gets a client policy and no `client_*` view reads from them (ADR-0004/0026). `001_rls_guard` keeps its empty client-policy set; pgTAP `650` adds a `pg_depend` check that no `client_*` view depends on a new table.
2. **Workers read and write only through RPCs** (ADR-0031, the `staff_caller()` pattern in `20260922180000_staff_self_service.sql`). The new tables give the **staff role no policy at all**. Workers use `security definer` functions that name their columns, pin `search_path = public, extensions`, and `revoke execute … from public, anon` (pgTAP `190` 2e/2f). All seven tables go into `OWNED_BY_RPC` in `scripts/check-write-paths.mjs`.
3. **Admin reads; writes go through RPCs.** Each table gets one `admin_read` select policy. Office writes are definer RPCs that write `audit_log` with the actor (pgTAP 604's convention).
4. **State changes follow the repo rule.** One function in `packages/domain/src/state.ts`, one SQL transitions function, one `*_state_guard` trigger. A `*.vectors.json` file is the contract, compiled to psql by `packages/domain/scripts/gen-vectors-sql.mjs`. A vector and its SQL twin land in the **same PR** (`490` reads the generated psql; a vector merged alone turns `main` red).
5. **Notifications go through the outbox.** Every send is a `notification_outbox` row with a unique key, queued in the same transaction as the write. New codes use **family prefixes** (`RC`, `OF`, `RF`, following `CL`) so they never collide with an N/E number THC assigns later, and sit in a new `ADDITION_CODES` list beside `SCOPE_CODES`, `REQUIREMENT_CODES`, `EXTENSION_CODES`.
6. **Frozen in Phase 1:** nobody restates `staff_me`, `staff_profile_v`, `onboarding_candidates_v`, `auto_assign_candidates`, `accept_invite`, `accept_application`, `self_cancel_booking` or `remove_worker`. New data is read with separate queries/RPCs. Only two restatements are allowed — `invite_worker` (Agent A) and `submit_application_as_caller` (Agent D) — each byte-for-byte from the latest definition plus one clause, with a pgTAP that asserts every earlier gate *together* (docs/10 §3b).
7. **GDPR removal by trigger.** `staff_removed_purge_additions` fires `after update of removed_at on staff`, so `remove_worker()` is not restated. Not RPC-callable (the `20260927161000` pattern).
8. **Migration timestamps sort after `20260929160200`**, the newest on `main` (the session clock reads 25.09; a clock-stamped file would be refused by `deploy-database`, the #43/#57 failure). Use the reserved blocks below. An unmerged migration that ends up below `main`'s newest is re-stamped before merge; merged files are never renamed. Run `NODE_USE_ENV_PROXY=1 pnpm check:overlap` and `node scripts/check-file-numbering.mjs` before every PR.

### Reserved numbers

| Kind | Phase 0 (Agent 0) | Agent A (scheduling) | Agent B (staff-pwa) | Agent C (directory) | Agent D (onboarding) |
|---|---|---|---|---|---|
| Migrations | `20260930100000_booking_source_offer.sql`, `20260930100100_staff_additions_schema.sql` | `20260930110000_availability_in_auto_assign.sql`, `20260930110100_shift_offers.sql` | `20260930120000_staff_self_service_additions.sql` | `20260930130000_office_staff_additions.sql` | `20260930140000_apply_referral.sql` |
| pgTAP | `650_staff_additions_rls`, `651_staff_additions_state`, `652_staff_additions_gdpr` | `656_availability_engine`, `670_shift_offers`, `671_take_offer_every_gate`, `672_cover_requests`, `673_offer_rounds_and_lapse`, `674_offer_payloads` | `655_my_availability`, `660_my_emergency_contact`, `665_request_change`, `680_referral_code` | `661_office_emergency_contact`, `666_office_decide_change` | `681_apply_referral` |
| ADR | 0036–0040 (written in Phase 0; later amended only by owner) | 0036 (engine), 0039 | — | 0037, 0038 | 0040 |

`booking_source 'offer'` has its own migration: `alter type … add value` cannot be used in the transaction that adds it.

**As built:** Agent B split its block into one file per feature (`20260930120000`–`20260930120300`). The review round (qa-reviewer + security, 25.09) added `20260930150000_shift_offers_review_fixes.sql` (scheduling), `20260930150100_self_service_review_fixes.sql` (staff-pwa), `20260930150200_gdpr_purge_additions_payloads.sql` (platform) and `20260930150300_referral_new_candidates_only.sql` (onboarding).

---

## 1 · Availability calendar

**Scope impact:** §1.5 (new entity *StaffUnavailability*), §3.4 and §6 (a gate on automated invitations), §3.3 (Unavailable reason), §9.6 (profile tab), §10.1 (Profile row).
**ADR-0036 · Worker availability: a hard gate for automated invitations, advisory for people.**

**Hard gate, not a score.** §6's five weights are contractual; a sixth factor could be outscored and the worker would still be pushed invitations for days they said they cannot work. The gate applies only to what the machine does: hourly rounds, first round, cutoff refills, same-day escalation, offer pushes (F4). It does **not** apply to: a manager's manual invite (after a confirm dialog, in the spirit of RULE-17's override); the worker's own Accept, Radar apply or Take-offer; open invitations (never withdrawn, §3.4); a confirmed booking (never cancelled by a calendar entry — the worker is warned and pointed at Cancel/Offer).

**Data (Phase 0)** — `staff_unavailability`: `id uuid pk`, `staff_id → staff`, `period tstzrange not null` (half-open, finite, not empty, ≤ 31 days), `all_day bool`, `series_id uuid null` (one "repeat weekly"), `created_at`. GiST on `period`, btree on `staff_id`. **No reason column** (avoids health data, Q10). Builders: `unavailability_range(p_from_date, p_to_date, p_from time, p_to time) → tstzrange` (Europe/London; all-day = UK midnight→midnight; `to <= from` on one date = overnight) and `staff_unavailable(p_staff, p_starts, p_ends) → bool` (`&&` against the **role section** window, RULE-18). RLS: admin select only.

**pgTAP:** 650 matrix · 651 vectors through `unavailability_range` · 652 GDPR deletes rows · 655 (B) worker RPCs — refusals `in_past`, `too_far` (> 365 d), `too_long`, `bad_window`, `too_many` (> 26 repeats or > 200 future rows); cannot touch another worker's rows; leavers/removed refused · 656 (A) `invite_worker(…,'auto'|'escalation')` refuses `unavailable`, `'manual'` still invites, `accept_invite`/`apply_to_shift` by an unavailable worker succeed, every earlier `invite_worker` refusal re-asserted in one file.

**RPCs.** B: `my_unavailability(p_from, p_to)`, `add_my_unavailability(p_from_date, p_to_date, p_from_time, p_to_time, p_repeat_weeks int default 0) → {ok, ids[], conflicts[{bookingId, event, startsAt}]}` (conflicts = worker's confirmed bookings, for the warning), `remove_my_unavailability(p_id, p_whole_series default false)`. A: `auto_assign_unavailable(p_shift) → (staff_id, starts_at, ends_at)` (admin/service); `invite_worker` restated from `20260928110200` + `p_source in ('auto','escalation') and staff_unavailable(...)` → `{invited:false, reason:'unavailable'}`.

**Domain (Phase 0)** `packages/domain/src/availability.ts`: `unavailabilityRange()`, `expandWeekly()`, `overlapsSection()`, `validateUnavailability(input, now)`, `CALENDAR_GATE = 'unavailable'`, `withAvailability(rows, unavailableIds)` (overlays the gate on `CandidateRow`s whose SQL gate is null; `HARD_GATES` in `scoring.ts` unchanged, so no ripple into office code); `selectInvitees(rows, {…, unavailable})` in `autoAssign.ts`.

**Vectors `availability.vectors.json`** (Vitest + pgTAP 651): all-day 12.10.2026 (BST) → `[11T23:00Z, 12T23:00Z)`; all-day 29.03.2026 = 23 h; 25.10.2026 = 25 h; 09:00–13:00 in GMT → `[09:00Z, 13:00Z)`; overnight 22:00–02:00 crosses into next UK date; 7-day range = 7 days; `from == to` → `bad_window`; section 17:00–23:00 vs entry ending 17:00 → no overlap, ending 17:01 → overlap; section past midnight into all-day entry → overlap; weekly ×3 across 25 Oct keeps 18:00 UK; past → `in_past`; > 365 d → `too_far`; 27 repeats → `too_many`; 32 days → `too_long`.

**Notifications:** none. The screen warns when an entry overlaps a confirmed booking.

**Staff App (B):** new `/profile/availability` (only when `appLock() === 'none'`): upcoming entries by week; **Add** sheet — date or range, All day or from/to "(UK time)" with a "your time" line when `useViewerZone` differs (§1.8), "Repeat weekly for N weeks" (≤ 26); conflict warning listing confirmed shifts ("Marking yourself unavailable doesn't cancel this shift — use Cancel or Offer on the shift."); delete one or the series. `ProfileHub.tsx` gains "Availability — Days you can't work".

**Back Office:** C — `/staff/:id` **Availability** tab (read-only, next 8 weeks UK). A — `/events/:id` Unavailable section gains "Marked unavailable · {UK window}" with **Invite anyway** behind a confirm ("{name} marked themselves unavailable for this time. Invite anyway?") calling the existing `office_invite_worker`.

**Owners/files.** `scheduling` (ADR, engine, board) with `staff-pwa` and `directory`. Phase 0: `packages/domain/src/{availability.ts, autoAssign.ts, index.ts, availability.vectors.json, __tests__/*}`, `packages/domain/scripts/gen-vectors-sql.mjs`, `supabase/tests/_shared/availability_vectors.psql`. A: `supabase/migrations/20260930110000_…`, `supabase/functions/auto-staffing/index.ts`, `apps/office/app/events/[id]/{board-data.ts, board-model.ts, _components/RoleBoard.tsx, _components/PotentialPool.tsx, __tests__/*}`. B: `apps/staff/app/profile/availability/**`, `ProfileHub.tsx`. C: `apps/office/app/staff/[id]/{Availability.tsx, ProfileScreen.tsx, data.ts, types.ts}`. **THC:** Q9, Q10.

---

## 2 · Emergency contact

**Scope impact:** §1.5 (Staff entity), §9.6, §10.1 Profile details, §1.7 GDPR. **§11.3 unchanged:** the allocation sheet and timesheet are client documents, so worker personal data never goes on them.
**ADR-0037 · Emergency contact: office-only worker data, never on a client document.**

**Data (Phase 0)** `staff_emergency_contacts`: `staff_id uuid pk → staff`, `name` 1–100, `relationship` 1–40 (UI suggests Parent/Partner/Sibling/Friend/Other), `phone` `^\+[1-9][0-9]{6,14}$` (E.164, the `/apply` rule), `updated_at`, `updated_by` (auth uid). Separate table, not a `staff` column — avoids #44's column-grant regime and keeps it out of every `staff` view. RLS: admin select.

**pgTAP:** 650 matrix + no `client_*` dependency · 652 GDPR deletes · 660 (B) save → read → clear, bad phone refused, no cross-worker access, `inactive` reads but cannot write, `removed` refused · 661 (C) office save writes `audit_log`, non-admin refused.

**RPCs.** B: `my_emergency_contact()`, `save_my_emergency_contact(p_name, p_relationship, p_phone)`, `clear_my_emergency_contact()`. C: `office_save_emergency_contact(p_staff, …)`, `office_clear_emergency_contact(p_staff)`, admin only, audited.

**Domain (Phase 0)** `emergencyContact.ts`: `validateEmergencyContact()` reusing `isPhone` from `onboarding.ts` (grep first; `toE164` lives in `apps/staff/app/apply/form.ts`). `emergencyContact.vectors.json` phone cases, also run by 650 against the CHECK.

**Notifications:** none.

**Staff App (B):** `/profile/details` new "Emergency contact" section (name, relationship, phone with the same international picker, Save, Remove). `ProfileHub.tsx`: amber "Emergency contact not set" subline on Profile details while empty — optional, not a lock (Q11).

**Back Office (C):** `/staff/:id` Overview "Emergency contact" card with Edit/Clear; "Not provided" when empty. Phase 2 (`checkin`): on the `/checkin` worker detail, admin only. **Unchanged:** `packages/pdf`, `apps/client`, every `client_*` view; `qa-reviewer` checks the PDF loader in `apps/office/app/api/documents/**` never selects the table.

**Owners/files.** `directory` with `staff-pwa`. B: `20260930120000_…`, `apps/staff/app/profile/details/{DetailsForm.tsx, page.tsx}`, `apps/staff/app/profile/{actions.ts, data.ts, types.ts}`, `ProfileHub.tsx`. C: `20260930130000_…`, `apps/office/app/staff/[id]/{Overview.tsx, EmergencyContactCard.tsx, actions.ts, data.ts, types.ts}`. **THC:** Q11, Q12.

---

## 3 · Request a change — name and photo

**Scope impact:** §10.1 ("corrections go through the office" gains an in-app route), §9.6, §8 (RC1–RC4), §1.5 (ProfileChangeRequest).
**ADR-0038 · Request a change: the office's queue for what §10.1 locks.**

**Data (Phase 0)** `profile_change_requests`: `id`, `staff_id`, `kind 'name'|'photo'`, `status 'pending'|'approved'|'rejected'|'withdrawn'` default pending, `proposed_first_name`/`proposed_last_name` (required iff name, 1–100, trimmed), `proposed_photo_path` (required iff photo; must start with `staff_id || '/'`), `evidence_path` (documents bucket `<staff_id>/change-requests/<id>.<ext>`; required for name, Q13), `worker_note` ≤ 500, `previous_value jsonb` (snapshot at decision), `created_at`, `decided_at`, `decided_by`, `applied_at`, `decision_reason` ≤ 300 (**required on reject and shown to the worker** — the `compliance_docs.rejection_reason` precedent). Partial unique `(staff_id, kind) where status = 'pending'`. `profile_change_transitions()` + `profile_change_requests_state_guard`: `pending → approved|rejected|withdrawn` only; `decided_*` set on leaving pending; proposed values immutable. RLS: admin select.

**pgTAP:** 650 · 651 vectors · 652 GDPR anonymises proposed names, withdraws pending · 665 (B) second pending refused, withdraw, foreign photo path refused, non-existent object refused, name equal to current refused · 666 (C) approving a name updates `staff.first_name/last_name` and queues RC2+RC4; approving a photo sets `photo_path` despite `photo_locked`; reject without reason refused; reject queues RC3; already-decided refused; non-admin refused.

**RPCs.** B: `request_profile_change(p_kind, p_first, p_last, p_photo_path, p_evidence_path, p_note)` (queues RC1), `withdraw_profile_change(p_id)`, `my_profile_change_requests()` (never `decided_by`). C: `office_decide_profile_change(p_id, p_approve, p_reason)` — name: writes name + `audit_log`, queues RC4 to payroll, **no** automatic right-to-work re-check (Q13); photo: repoints `photo_path`, keeps the old object (purged with the prefix on GDPR removal). Issued PDFs and payroll exports are never touched (§1.7, never corrected retroactively).

**Domain (Phase 0):** `changeRequest.ts` (`CHANGE_KINDS`, `validateNameChange()`, `decisionNeedsReason()`); `state.ts` (`CHANGE_REQUEST_STATUSES`, `CHANGE_REQUEST_TRANSITIONS`, `canTransitionChangeRequest()`, `assertChangeRequestTransition()`; `IllegalTransitionError.machine` += `'change_request'`); `changeRequest.vectors.json`.

**Notifications (Phase 0):**

| Code | Channel · to | Title / subject | Body | Timing · key |
|---|---|---|---|---|
| RC1 | email · admin@ | `Profile change requested — {name}, Employee ID {employeeId}` | `{name} has asked the office to change their {change}.\n\nRequested: {requestedAt} (UK time)\nNow: {current}\nRequested: {proposed}\nNote: {note}\n\nReview it in Staff → Change requests.` | on request · `RC1:request:<id>` |
| RC2 | push · worker | `Profile updated` | `Your {change} has been updated.` → `/profile/details` | on approve · `RC2:request:<id>` |
| RC3 | push · worker | `Change not made` | `We couldn't update your {change}: {reason}` → `/profile/details` | on reject · `RC3:request:<id>` |
| RC4 | email · admin@ + thc_payroll@ (E7's recipients) | `Name changed — {name}, Employee ID {employeeId}` | `Previous name: {previousName}\nNew name: {name}\nApproved: {approvedAt} (UK time)` | on approving a name · `RC4:request:<id>` |

**Staff App (B):** `/profile/details` — the locked name row and `PhotoField.tsx`'s locked state gain **Request a change**; a status line ("Name change requested · with the office" / "Not changed: {reason}" + Request again). New `/profile/details/request?kind=name|photo`: name → first/last, evidence upload (signed upload into `documents`), optional note; photo → camera capture reusing the selfie capture, uploaded to a fresh name in `photos/<own id>/` (existing INSERT policy; no Storage policy change); withdraw while pending.

**Back Office (C):** new `/staff/requests` (pending, oldest first; now → requested side by side with signed photo URLs, evidence link, note; **Approve** — for a name with "I've checked the evidence matches the right-to-work document"; **Reject** — reason required, "shown to the worker"; Decided tab). `/staff` gets "Change requests (N)"; `/staff/:id` Overview gets a pending-request banner; optional count via `apps/office/app/_components/navCounts.ts` (C sole editor).

**Owners/files.** `directory` with `staff-pwa`, `notifications`. B: `apps/staff/app/profile/details/{DetailsForm.tsx, PhotoField.tsx}`, `apps/staff/app/profile/details/request/**`. C: `apps/office/app/staff/requests/**`, `apps/office/app/staff/StaffScreen.tsx`, `apps/office/app/staff/[id]/{Overview.tsx, data.ts}`. **THC:** Q13, Q14.

---

## 4 · Offer up a shift ("release to the pool")

**Scope impact:** §3.6 (cause `handed_over`, source `offer`), RULE-04 §7 (a second worker-initiated exit from `confirmed` under the same 72 h boundary), §10.4, §3.3, §3.4 (offer rounds), §8 (OF1–OF6), §9.12.
**ADR-0039 · Offer up a shift: the booking is released only when a confirmed replacement takes it.**

**The model (safest first):**
1. **Offer to the pool while > 72 h remain** (exactly `canCancelShift()`), only while auto-assign is ON for the event and role; if OFF, only "Ask the office". The offerer **stays confirmed** — fill, buffer (`6 (+1)`), `shift_fill`, `accept_invite`, the client line-up unchanged. The offer lapses at **start − 72 h** (OF3; still booked).
2. **`take_offered_shift()` in one transaction under the same `shift_requirements … for update` lock** every slot path takes. The taker passes **every** hard gate from `auto_assign_candidates(shift)` (wrong role, do-not-return, blocked, self-cancelled, booked elsewhere incl. the 2 h different-venue gap, right-to-work expired, weekly cap) plus `accept_invite`'s overlap and cap re-reads; the rota-guard trigger fires too. RULE-17 order: an unqualified taker gets `not_yet` until `offer_wave1_exhausted(offer)`. Then the taker's row → `confirmed` (`source='offer'`, legal path from `invited`/`applied`/`closed → applied`; a `cancelled` row → `already_had_booking`); the original → `cancelled`, `cancel_cause='handed_over'`, `self_cancelled=true`; offer → `taken`; the taker's overlapping invitations auto-withdrawn as on Accept; OF2+OF4 queued. Confirmed count net zero, so no N10c.
3. **Inside 72 h, only through the office.** "Ask the office for cover" creates an `office` offer (not visible, not pushed); OF5 emails admin@ at once; the worker stays confirmed. The office **opens it to the pool** (mode `pool`, expires at section start; after start the escalation job owns the section), **declines** (OF6), or covers by hand with the existing **Withdraw**.
4. **A completed hand-over bars the offerer from the event** (`self_cancelled = true`, RULE-04) — otherwise offering would bypass the self-cancel exclusion (Q15).
5. **Peer-to-peer designed, not built** (`settings.shift_offers_direct_enabled = false`, Q17): mode `direct`, colleague by Employee ID (no directory exposed, generic refusal), target qualified at client+role, same `take_offered_shift`; two-way swap = two `direct` offers sharing `swap_group_id`, accepted atomically, each leg checked against **current** state with no credit for the shift given away.
6. **Automatic lapse:** `after update of status on bookings` lapses the booking's open offer when it leaves `confirmed` by any other cause (Withdraw, 12:05 cutoff, block, leave, GDPR, event cancelled, self-cancel).

**Data (Phase 0)** `shift_offers`: `id`, `booking_id → bookings`, `shift_id` (denormalised), `offered_by_staff_id`, `mode 'pool'|'office'|'direct'`, `target_staff_id` (iff direct), `swap_group_id`, `status 'open'|'taken'|'withdrawn'|'lapsed'|'cancelled'`, `note` ≤ 300, `created_at`, `expires_at`, `closed_at`, `closed_reason`, `taken_by_booking_id`, `taken_by_staff_id`, `decided_by`. Partial unique `(booking_id) where status='open'`. `shift_offer_transitions()` + `shift_offers_state_guard`: `open → taken|withdrawn|lapsed|cancelled`, others terminal; mode only `office → pool` while open; booking and target immutable. `shift_offer_notices(offer_id, staff_id, notified_at, pk(offer_id, staff_id))` makes rounds additive. `bookings_cancel_cause_check += 'handed_over'`; `booking_source += 'offer'`. RLS: admin select on both; Radar lists offers through a definer RPC that **never returns the offerer**.

**pgTAP:** 650, 651 (+ `490`/booking vectors with `handed_over`) · 670 offer/withdraw (refusals `too_late` at exactly 72 h, `auto_assign_off`, `already_offered`, `not_confirmed`; lapse trigger per foreign cause) · 671 take with **every gate in one file**, confirmed count unchanged (refusals `own_offer`, `taken` race, `offer_expired`, each gate by name, `not_yet`; original → `cancelled/handed_over/self_cancelled`; offerer then gated `self_cancelled`) · 672 cover (request inside 72 h, OF5, open to pool, decline + OF6, Withdraw lapses) · 673 `lapse_shift_offers` + `notify_offer_candidates` (additive, wave 1 first, never after expiry, unavailable skipped) · 674 every OF payload's keys equal its template placeholders (the `592` pattern).

**RPCs (A, `20260930110100_shift_offers.sql`).** Worker: `offer_shift(p_booking)`, `withdraw_shift_offer(p_offer)`, `request_cover(p_booking, p_note)`, `take_offered_shift(p_offer)`, `staff_open_offers()` (role, event, venue, UK window, base rate, dress code, km; no offerer). Admin: `office_open_offer_to_pool(p_offer)`, `office_decline_cover(p_offer, p_note)`. Service: `lapse_shift_offers(p_now)`, `offer_candidates(p_offer)`, `notify_offer_candidates(p_offer, p_staff uuid[])`, `offer_wave1_exhausted(p_offer)`. Trigger: `bookings_offer_lapse`. `auto-staffing` hourly gains: lapse → open pool offers → candidates → `selectOfferRecipients` → notify.

**Domain (Phase 0):** `shiftOffer.ts` (`canOfferShift()` = `canCancelShift`, `offerExpiresAt()` = `cancelDeadline`, `takeOffer(input, now)`, `offerVisibleTo()`); `autoAssign.ts` `selectOfferRecipients(rows, {notified, allocation})`; `state.ts` `SHIFT_OFFER_STATUSES`, `SHIFT_OFFER_TRANSITIONS`, `CANCELLED_CAUSES += 'handed_over'`, `excludesFromEvent('handed_over') === true`. **Vectors `shiftOffer.vectors.json`:** transitions and mode edges; `canOffer` at 72 h + 1 ms true, at exactly 72 h false; take order `event_cancelled` › `offer_not_open` › `offer_expired` › `original_not_confirmed` › `own_offer` › `section_started` › gate by name (`booked_elsewhere` → `overlap`) › `not_yet` › ok; `unavailable` does **not** refuse. `bookingState.vectors.json` gains `handed_over → cancelled`.

**Notifications:**

| Code | Channel · to | Title / subject | Body | Timing · key |
|---|---|---|---|---|
| OF1 | push · candidate | `Shift up for grabs` | `{role} · {event} · {dateTime} · {rate}/h — tap to take it.` → `/radar/offers/{offerId}` | hourly, `allocation_per_hour` per round, wave 1 first, never after expiry · `OF1:offer:<offer>:<staff>` |
| OF2 | push · offerer | `Shift handed over` | `{event} · {dateTime} has been taken by another worker. You're no longer booked on it.` → `/shifts` | on take · `OF2:offer:<id>` |
| OF3 | push · offerer | `You're still booked` | `Nobody took your {event} shift on {date} — you're still booked. If you can't make it, contact the office.` → `/shifts/{bookingId}` | on lapse by expiry only · `OF3:offer:<id>` |
| OF4 | push · taker | `You're booked!` | `{event} on {date} is yours. Tap to view your shift details.` → `/shifts/{bookingId}` | on take · `OF4:offer:<id>` |
| OF5 | email · admin@ | `Cover requested — {event} · {role} · {date}` | worker, Employee ID, event, client, venue, role, UK window, note, `{confirmed} of {headcount} (+{buffer})`, auto-assign on/off, "They are still booked until you act." | immediately · `OF5:booking:<booking id>` (one per booking; review fix `20260930150000`) |
| OF6 | push · offerer | `Cover request closed` | `The office has closed your cover request for {event} on {date}. You're still booked — contact the office if you can't make it.` → `/shifts/{bookingId}` | on decline · `OF6:offer:<id>` |

A pool hand-over sends no office email — no slot is lost (Q18); the board shows it.

**Staff App (A):** `/shifts/:id` — **Offer this shift** (> 72 h, auto-assign on, no open offer; dialog: "We'll offer this shift to other workers. You stay booked until someone takes it — then it's theirs, and you can't be booked on this event again. Offers close {date} (UK time), 72 hours before the start."); while open an "Offered · open until …" chip + **Withdraw offer**; inside 72 h "Can't make it? **Ask the office for cover**" with optional note, then "Cover requested — the office will be in touch. You're still booked until they confirm."; **Cancel shift** unchanged. `StaticShiftScreen.tsx`/`messages.ts`: `handed_over` → "You handed this shift over — it's now someone else's." `/shifts` card "Offered" chip. `/radar` **"Up for grabs"** group (RULE-17 visibility); new `/radar/offers/:id` with **Take this shift** (refusals reuse Radar copy). Actions in `apps/staff/app/actions.ts`.

**Back Office (A):** `/events/:id` Confirmed row chips "Offered up · until {UK}" / "Asked for cover: {note}" with **Open to pool** / **Decline** in `BookingActions.tsx`; per-section "Handed over: {from} → {to} · {date}". C: `/staff/:id` Shifts tab label for `handed_over` (`profile.ts`).

**Owner/files.** `scheduling`. A: `20260930110100_…`, `supabase/functions/auto-staffing/index.ts`, `apps/staff/app/{actions.ts, shifts/**, radar/**}`, `apps/office/app/events/[id]/**` + tests. **THC:** Q15–Q18.

---

## 5 · Refer a friend

**Scope impact:** §2.1 (`/apply?ref=`), §2.3 (referrer on candidate), §9.6, §10.1, §1.7 (privacy notice), §1.5. No money: nothing reaches `packages/pdf`, reports or payroll.
**ADR-0040 · Refer a friend: a referral code on /apply, recorded, no reward.**

**Data (Phase 0):** `staff_referral_codes(staff_id pk → staff, code text unique ^[A-HJ-NP-Z2-9]{8}$, created_at, revoked_at)`; `application_referrals(application_id pk → applications, referrer_staff_id → staff, candidate_staff_id → staff, code, recorded_at, check referrer <> candidate)`. RLS: admin select on both.

**pgTAP:** 650 · 652 GDPR revokes the removed worker's code; referral rows kept, referrer reads "Deleted account #id" · 680 (B) minted once and stable, compliant only, summary is a count · 681 (D) valid code records a row for a `candidate_created` application only — a `returning_applicant` match records nothing (security review, `20260930150300`); bad/revoked/self code records nothing and **the application still succeeds**; throttles untouched; anon path records nothing; response identical with or without a code.

**RPCs.** B: `my_referral_code()` (lazy mint, compliant only), `my_referral_summary() → {code, applied}`. D: `submit_application_as_caller` restated from `20260926100200` with `p_referral_code text default null` (8th arg; drop the 7-arg function first); after `perform submit_application(…)` it calls owner-only `record_application_referral(p_email, p_code)` — finds the application just written (same email normalisation), finds the code's owner, skips revoked/self, inserts `on conflict do nothing`, never raises. Anon `submit_application` unchanged.

**Domain (Phase 0):** `referral.ts` — `isReferralCode()`, `referralLink(origin, code)`; unit tests only.

**Notifications:** RF1 proposed, not built (Q20) — "Your friend {firstName} has joined The Hospitality Company." Held back: it tells one person another's employment status.

**Staff App:** B — `/profile/refer` (compliant only): link `{origin}/apply?ref={code}`, **Share** (Web Share API), **Copy**, QR (existing activation QR component), "N people have applied with your link"; **no reward copy**; `ProfileHub.tsx` row "Refer a friend". D — `/apply`: `page.tsx` reads `searchParams.ref`, `ApplyForm.tsx` hidden field, `actions.ts` passes it on the service-role path only, `form.ts` validates; the applicant never sees the referrer's name; consent line and `/privacy` gain "If a friend referred you, we record who referred you." (THC legal text pending).

**Back Office:** D — `/onboarding/:id` "Referred by {name} ({employeeId})" → `/staff/:id`; kanban "Referred" chip; separate admin query on `application_referrals` (**`onboarding_candidates_v` not restated**). C — `/staff/:id` Overview "Referrals" card + "Referred by".

**Owners/files.** `onboarding` with `staff-pwa`, `directory`. B: `apps/staff/app/profile/refer/**`, `ProfileHub.tsx`. D: `20260930140000_…`, `apps/staff/app/apply/**`, `apps/staff/app/privacy/page.tsx` (one sentence), `apps/office/app/onboarding/{CandidateScreen.tsx, OnboardingBoard.tsx, data.ts, view-model.ts, __tests__/*}`. C: `apps/office/app/staff/[id]/{Overview.tsx, data.ts}`. **THC:** Q19, Q20.

---

## 6 · Register additions (Phase 0, `packages/notifications`)

RC1–RC4 and OF1–OF6 in `TEMPLATES`, each `trigger` naming its ADR; `ADDITION_CODES = ['RC1','RC2','RC3','RC4','OF1','OF2','OF3','OF4','OF5','OF6']`; `templates.test.ts`: union of the four lists = `TEMPLATES`, no worker push contains office wording, RC4 recipients = E7's, OF5 admin only; an "Additions (ADR-0036–0040)" table in `REGISTER-NOTES.md`, every row **confirm with THC**; RF1 documented as proposed, not registered.

---

## 7 · `docs/15-open-questions.md` → Questions for THC (after Q8)

Each is implemented with the default shown; changing it later is small.

- **Q9 · Availability — gate or preference?** Default: "unavailable" stops automated invitations and offer pushes only; a manager can still invite by hand after a warning; the worker can still accept or apply. *Ask:* should it also stop manual invitations?
- **Q10 · Availability — shape.** Default: single days, ranges ≤ 31 days, or a time window on a day; repeat weekly ≤ 26 weeks; up to 12 months ahead; **no reason field**. *Ask:* longer patterns? a reason?
- **Q11 · Emergency contact.** Default: optional, in Profile details, office-only (check-in monitor in Phase 2), **never on the allocation sheet or timesheet**, deleted on GDPR removal. *Ask:* mandatory? asked during onboarding?
- **Q12 · Emergency contact — leavers.** Default: kept while the record exists, deleted only on Remove. *Ask:* delete when a worker leaves (§10.6)?
- **Q13 · Name change.** Default: evidence upload; office ticks "matches the right-to-work document"; payroll emailed (RC4); no automatic right-to-work re-check; issued PDFs/exports untouched. *Ask:* must it trigger a fresh right-to-work check?
- **Q14 · Photo change.** Default: one pending at a time, no frequency limit, office approves. *Ask:* any limit?
- **Q15 · Offer up — exclusion.** Default: once taken, the offerer is barred from that event as after a self-cancel. *Ask:* keep the bar?
- **Q16 · Offer up — window.** Default: pool offers close 72 h before start; inside 72 h "Ask the office for cover", which the office may open to the pool until start. *Ask:* closer, e.g. 24 h?
- **Q17 · Peer-to-peer swaps.** Default: off. If wanted: colleague by Employee ID, qualified at client+role, every hard gate, no credit for the shift given away. *Ask:* do you want them?
- **Q18 · Offer up — office emails.** Default: only for cover requests inside 72 h (OF5). *Ask:* also on hand-over / lapse?
- **Q19 · Referral reward.** Default: recorded and shown to the office; no reward, no promise. *Ask:* what reward, earned by what?
- **Q20 · Referral privacy.** Default: referrer sees a count only; applicant never sees the referrer's name; `/apply` and `/privacy` say referrals are recorded. *Ask:* may a referrer be told their friend joined (RF1)? Please supply privacy wording.
- **Q21 · New message wording.** RC1–RC4, OF1–OF6 are drafts. *Ask:* confirm or rewrite, as for §8.

Carrying Q9–Q21 into `docs/17-inputs-from-thc.md` (generated by `packages/pdf/scripts/thc-inputs.mjs`) is a follow-up for `reports`.

---

## 8 · Build order

### Phase 0 — Agent 0 (`platform`, also briefed on notifications and domain). Merges before anything else.

- **0-A schema + domain** (one PR — vectors and SQL twins together): migrations `20260930100000_booking_source_offer.sql`, `20260930100100_staff_additions_schema.sql` (7 tables, CHECKs, `admin_read`, two state guards + transitions functions, `unavailability_range()`, `staff_unavailable()`, `bookings_cancel_cause_check += handed_over`, GDPR trigger); `packages/domain` (`availability.ts`, `emergencyContact.ts`, `changeRequest.ts`, `shiftOffer.ts`, `referral.ts`; edits to `state.ts`, `autoAssign.ts`, `staff.ts`, `index.ts`; 4 new + 1 changed vectors; `gen-vectors-sql.mjs`; generated `_shared/*.psql`; tests); pgTAP 650–652 and `001_rls_guard.sql` (the only edit to 001); `scripts/check-write-paths.mjs`; `docs/03-data-model.md`.
- **0-B notifications** (parallel with 0-A): `templates.ts`, `templates.test.ts`, `REGISTER-NOTES.md`.
- **0-C docs** (parallel): ADR-0036–0040 (proposed); docs/15 Q9–Q21; `docs/08-screen-inventory.md` rows for `/profile/availability`, `/profile/details/request`, `/profile/refer`, `/radar/offers/:id`, `/staff/requests` and the new tab/cards; wireframe stubs `wireframes/staff/{availability,request-change,refer,offer-shift}.html`, `wireframes/backoffice/change-requests.html` + `wireframes/index.html` links; a pointer in docs/14.
- **0-D types:** after 0-A is applied by `deploy-database`, `pnpm --filter @thc/db gen:types`.

### Phase 1 — four agents in parallel, disjoint files

| Agent | Bot | Features | May touch | Must not touch |
|---|---|---|---|---|
| **A** | `scheduling` | F1 engine + board, F4 | `supabase/functions/auto-staffing/**`, `apps/staff/app/{actions.ts, shifts/**, radar/**}`, `apps/office/app/events/**`, its migrations/tests, ADR-0036/0039 | `apps/staff/app/profile/**`, `apps/office/app/staff/**`, `packages/*` |
| **B** | `staff-pwa` | F1–F3 worker side, F5 `/profile/refer` | `apps/staff/app/profile/**` (sole owner of `ProfileHub.tsx`, `lock.ts`, `StaffShell`), its wireframes | `apps/staff/app/{shifts,radar,apply}/**`, `packages/*` |
| **C** | `directory` | F1–F3, F5 office side, `handed_over` label | `apps/office/app/staff/**`, `apps/office/app/_components/navCounts.ts`, its wireframes, ADR-0037/0038 | `apps/office/app/{events,onboarding}/**`, `packages/*` |
| **D** | `onboarding` | F5 `/apply` + candidate side | `apps/staff/app/{apply,privacy}/**`, `apps/office/app/onboarding/**`, ADR-0040 | `apps/staff/app/profile/**`, `packages/*` |

No Phase-1 agent edits `packages/*`. Until the type regen, new RPCs use narrow local casts (the `(supabase as unknown as XRpc).rpc(…)` pattern in `apps/office/app/staff/[id]/data.ts`). Phase-1 migrations reference only Phase 0 and existing objects, never each other's. C tests its office RPCs with owner-inserted fixtures. Every PR gets `qa-reviewer`; A2 and D also get `security`.

### Phase 2 — serial follow-ups

1. Final `gen:types` and removal of the local RPC casts. 2. `checkin`: emergency contact on the `/checkin` worker detail. 3. `scheduling`: direct offers/swaps if Q17 = yes. 4. `notifications`: RF1 if Q20 = yes. 5. `reports`: Q9–Q21 into `thc-inputs.mjs`, regenerate docs/17. 6. `security`: pass over the ~25 new definer functions.

### Hot spots

| Hot spot | Single writer |
|---|---|
| `packages/db/src/types.generated.ts` | Agent 0 (0-D, Phase 2.1 only) |
| `packages/notifications/**` | Agent 0 (0-B) |
| `packages/domain/**`, `*.vectors.json` | Agent 0 (0-A) |
| `supabase/tests/001_rls_guard.sql` | Agent 0 (0-A) |
| `StaffShell.tsx`, `ProfileHub.tsx`, `profile/lock.ts` | Agent B |
| `apps/office/app/staff/[id]/**` | Agent C |
| `apps/office/app/events/[id]/**` | Agent A (two sequential PRs) |
| `invite_worker` / `submit_application_as_caller` | A / D |
| `docs/08`, `docs/15`, `docs/adr/*`, `wireframes/index.html` | Agent 0 (0-C); then each agent only its own ADR/wireframe |

**Critical references:** `packages/domain/src/state.ts`; `supabase/migrations/20260928110400_accept_gate_block_withdraws_all_and_allocation_default.sql` (the `accept_invite` gates every take path mirrors); latest `invite_worker` in `20260928110200_get_back_first_round_and_additive_target.sql`; `packages/notifications/src/templates.ts`; `supabase/tests/001_rls_guard.sql`; `apps/staff/app/profile/_components/ProfileHub.tsx`; `apps/office/app/staff/[id]/ProfileScreen.tsx`.
