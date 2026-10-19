# ADR-0159 · The pool judges pairs; Radar and open offers read it once per call

**Status:** Accepted · **Refines:** ADR-0156 (its "Not fixed: Radar is still one pool read per candidate section"), ADR-0117 (the pool is the one place gates are decided) · **Date:** 20.10.2026

`supabase/migrations/20261020100000_auto_assign_pool_pairs.sql` · `20261020100100_radar_one_pool_pass.sql` · `20261020100200_wave1_exhausted_stops_at_first.sql` · pgTAP `880` (and `859`, whose fixture moved to `_shared/pool_radar_fixture.psql` unchanged) · `scripts/bench/radar_and_pool_at_scale.sql`

## Context
After ADR-0156 Radar (`staff_open_shifts`) still asked the pool once per candidate section for the worker's own row (~190 calls for a two-role worker at go-live size) and at least once more per section the worker is not qualified at, for RULE-17's "is a qualified worker still reachable?" (~170): 0.5–1.7 s a load, against a 300 ms target. `staff_open_offers` asked `auto_assign_worker_gate()` once per open offer and `offer_wave1_exhausted()` for every pool offer the viewer is not qualified for; that read `auto_assign_candidates()` — the whole agency, series days included — to find one qualified worker still to be told: ~0.13 s an offer (go-live audit §4). `radar_wave1_exhausted()` had the same shape.

A second, many-section pool would be a second place where gates are decided, which ADR-0117 rules out.

## Decision
Every gate, its order and code, the wave and the five score inputs are unchanged; pgTAP 880 compares every reader with its body from before (see Consequences).

1. **One pool body, over pairs.** `auto_assign_candidates_pool_pairs(p_shifts, p_staff, p_escalation)` is the pool: the row for each `(p_shifts[i], p_staff[i])`, or with `p_staff` null every section in `p_shifts` against the agency. It is 20261019140000's body with each fact joined to the row's section rather than "the" section; the CASE, its order and codes are the same text. `auto_assign_candidates_pool(p_shift, p_escalation, p_only)` keeps its signature, columns and staff_id order and reads it for one section; the new `auto_assign_worker_pool(p_staff, p_shifts)` reads it for one worker against many sections (same columns plus the section id, section order). **A new pool gate now goes in `auto_assign_candidates_pool_pairs()`**; both readers carry it without change.
2. **Planned for any number of pairs.** A generic plan cannot know how many sections or pairs a call names and guessed ten: the agency branches fell back to scanning every booking, and one worker × 600 sections nested bookings × pairs × sections (1.6 s). So: the agency branches are `LATERAL … OFFSET 0` per section (planned as one section, as before); the named workers' bookings are read once through `bookings(staff_id)` (`wb`) and every named fact comes from that set; each named pair carries its section's times (`psec`), and the week-hours and booked-elsewhere rows carry the section values they are judged against, so nothing joins back to the sections; wrong role, do-not-return, self-cancelled, booked elsewhere and qualified are hashed `IN` lists keyed on (worker, section) — every key column is NOT NULL, so `IN` is never null and reads exactly as the old one-section `IN`.
3. **Radar: own rows in one pass, RULE-17 in rounds.** `staff_open_shifts` takes the worker's rows from one `auto_assign_worker_pool()` call over its prefiltered candidates, and RULE-17 from `auto_assign_wave1_reachable(sections)`: for every section where the answer can matter (own row ungated or hours_limit, not qualified, not started), the qualified workers who could be reachable (qualified, compliant, holding the role, no booking there — without any of these the pool's row could not be reachable) are asked about in rounds of 1, 4, 16 … per section, all sections' workers in one pool call a round, a section dropping out at its first reachable worker. Same answer as the per-section EXISTS it replaces.
4. **Wave 1 of an offer, once per call.** `offers_wave1_exhausted(offers)` does the same for offers, with the old body's own tests first (not the offerer, no booking that rules them out, not away, not yet told) and each round's workers judged as `auto_assign_worker_gate()` judges one: the section's pool gate, then `series_gate_for()`. `offer_wave1_exhausted(offer)` is it for one offer (its code is fingerprinted and replaced whole, since every test moved); `radar_wave1_exhausted(section)` is `auto_assign_wave1_reachable(…, p_series => true)`. `staff_open_offers` reads the viewer's gate on every open offer from one `auto_assign_worker_pool()` pass and the wave-1 answers from one `offers_wave1_exhausted()` call.
5. **How it is applied.** The pool's code (comments dropped, whitespace collapsed) is fingerprinted against 20261019140000 and `offer_wave1_exhausted()`'s against 20260930205000; `staff_open_shifts`, `staff_open_offers` and `radar_wave1_exhausted` are re-created from their live bodies with patterns on code only, each required to match once (docs/10 §3b). Security, search_path, jit, grants and comments are carried over; the new functions are SECURITY INVOKER like the pool (`offers_wave1_exhausted` is DEFINER and service_role-only, like `offer_wave1_exhausted`), none executable by anon.

## Measured
`scripts/bench/radar_and_pool_at_scale.sql`, same seed, local PostgreSQL 16, p50. The sandbox was shared with other sessions (load average ~20 on 4 cores during both runs), so absolute times are inflated; old and new were also timed alternately in one session (below the table), which removes the load difference.

| | before | after |
|---|---|---|
| Radar, worker holding all six roles, qualified everywhere (512 cards) | 2,883 ms | 257 ms |
| Radar, two roles, qualified at one client (13 cards) | 1,632 ms | 123 ms |
| Radar, new starter, one role, qualified nowhere (0 cards) | 790 ms | 46 ms |
| Open offers (60 open), the three workers | 391 / 1,521 / 777 ms | 64 / 117 / 109 ms |
| `offer_wave1_exhausted`, per offer | 60 ms | 4.1 ms |
| `radar_wave1_exhausted`, per section | 62 ms | 6.2 ms |
| One worker, all 600 open sections (`auto_assign_worker_pool`) | — | 23 ms |
| Board, per section (admin) | 278 ms | 188 ms |
| Rounds, `auto_assign_candidates` per section (service_role) | 63 ms | 59 ms |
| One worker's gate (`auto_assign_worker_gate`) | 6.4 ms | 3.0 ms |

Alternating in one session: admin board 272 → 258 ms, admin pool 278 → 234 ms, service-role list 46–51 → 48–49 ms, one-worker read 2.4–2.8 → 2.0–2.1 ms.

## Consequences
- **Equivalence.** pgTAP 880 re-creates the bodies from before 20261020100000 under `_old_` names (`_shared/pool_radar_before_20261020100000.psql`, each old reader calling the old pool) and compares, over 859's fixture plus eight open offers (switch off, everyone told, the offerer, the calendar, the series days, a direct offer, an expired one, an unknown id): list reads both modes; every section × worker one at a time; named lists with duplicates; **`auto_assign_worker_pool()` against `auto_assign_candidates_pool(section, false, array[worker])` for every (worker, section) pair, every column** — the assertion that fails if the two ever disagree — and against the old pool; every pair in one shuffled pairs call; every section against the agency in one call; `auto_assign_candidates()` and `auto_assign_worker_gate()`; RULE-17 with and without the series days; nine workers' Radar and open offers (every column, same order). Mutations caught: worker-pool drift (5 assertions fail), the 2 h gap dropped (9), RULE-17 giving up after one round (5), notices ignored (4). On the bench data: 38 list reads, 28 workers × 1,400 sections, 4,399 shuffled pairs, 40 workers' Radar (2,188 cards, every column and order), 60 offers, 131 sections' `radar_wave1_exhausted` and three workers' open offers matched the old bodies.
- `CLAUDE.md` still says a new pool gate goes in `auto_assign_candidates_pool()`; since this ADR it goes in `auto_assign_candidates_pool_pairs()`, which that function reads. The pool's own comment says so.
- `packages/db/src/types.generated.ts` lacks the new functions until types are regenerated after deploy; nothing in the apps calls them directly.
