# ADR-0116 · Same staff on all days (slice 1: the requirement and who may be invited)

**Status:** Accepted for slice 1 · **Decisions marked PROVISIONAL await the client's answers** · Deliberately changes §3.2 · Builds on ADR-0043, ADR-0079, RULE-18, RULE-20 · **Request:** Sam Barrington-Wells (client's director), 12.10.2026

## Context

A client sometimes wants the SAME staff on every day of a multi-day job. The example in the request: Fri 20, Sat 21 and Sun 22 Nov, each "Bar Staff at Tobacco Dock (need to be available all 3 days)". Sam asked: "Is there a way to set this in the event build as a requirement?"

Today (§3.2): "Multi-day = separate events created via Duplicate (the clone copies the roles, NOT the staff)." Each day is its own event with its own date, its own `shift_requirements` rows and its own pool, filled independently. A worker can accept Friday and decline Saturday, and nothing in the build says the client cares.

## Decision (slice 1)

**§3.2 is changed deliberately.** "The clone copies the roles, NOT the staff" still holds: no booking, invitation or application ever travels with a Duplicate. What is new is a **requirement** on a role section that restricts who may be **invited**.

1. **Linking the days.** `events.series_id uuid null` groups the events that are days of one job. Duplicate sets it on **both** the source and the clone (`link_event_series()`): the source's own `series_id` when it has one, else a new random uuid. It is written after the clone's event row and before its sections and first auto-assign round, so that round already sees the series. Duplicating into a different client is only a copy of the roles and is not linked (the function refuses a different client; `createEvent` carries on unlinked). A clone already in another series is not moved.
2. **The switch.** `shift_requirements.same_staff_all_days boolean not null default false`, **per role**, in the role section: "Same staff on all days" (a plain switch; violet stays Auto-Assign's). Off by default. Duplicate keeps it on the clone: it is the client's ask, not the day's. It is a **silent** edit (nobody booked is re-asked or removed) and, like `required_gender`, not under the §3.2 edit lock.
3. **The gate.** A worker is a candidate for a flagged section only if, for **every sibling section**, they pass what they would have to pass to be invited there. A sibling is a section in another event of the **same series and client**, the **same role**, with the flag **also on**, in an event that is **not cancelled** and a day that has **not yet ended**. The failures are one gate, **`not_available_all_days`**, reached by any of:
   - **a hard gate on that day** — the sibling's own pool gate (`auto_assign_candidates_pool`): wrong role, blocked, booked elsewhere (confirmed or worked, with the 2 h different-venue gap and same-venue back-to-back fine), hours limit, right to work, self-cancelled off that event, do-not-return, staff gender and event language;
   - **the availability calendar** — a `staff_unavailability` entry over the sibling's window (ADR-0043);
   - **the projected hours** — see 4.

   The section's **own** gate always wins (the truer reason). `not_available_all_days` is the last. It joins `HARD_GATES`, shows under **Unavailable → Not available all days** on the event board (no "Invite anyway"), and has office copy for a refused manual invite and a refused application.
4. **Projected hours.** The section being judged and every sibling are grouped by the Mon–Sun cap week each **starts** in (Europe/London, `weekly_booked_hours`'s bucket) and their hours summed. The worker's other commitments in that week are counted **without** any of the series' own sections, so a day they already hold is counted once, as projected. Each week then goes through `rota_guard_decide()` — the decision `weekly_cap_would_breach()` already uses — so a Student visa band (20 h in term, 10 h below degree level), a work visa's own limit and a right-to-work stop always block, and a Working Time 48 blocks unless `rota_guard_mode` is `warn`. Three 8 h days in one student-visa term week (24 h against 20 h) are refused although each day alone fits; two are not; the same three days either side of a Monday are judged a week at a time. **This reuses the existing cap function with projected hours; nothing is gated "per day only".** Pure twin: `projectSeriesWeeks()` + `seriesHoursBlocked()` in `packages/domain/src/series.ts`, held to `series.vectors.json`.
5. **Where it is enforced.** `auto_assign_candidates()` becomes a thin wrapper over `auto_assign_candidates_pool()` (the renamed 20261008120000 body, untouched) that adds the gate. Every consumer of the pool inherits it without being restated: the hourly, first-round and escalation rounds (`auto-staffing`), `invite_worker` (its `{invited:false, reason:'not_available_all_days'}` is the pool's gate, for `auto`, `escalation` **and** `manual`), the event board, Radar listing (`staff_open_shifts`), `apply_to_shift`, `accept_invite` / `accept_application` and the offer take. The split is also what makes the sibling check possible: asking the same question of another section through the wrapper would recurse.
6. **The event board** says "Day N of M" (live, by date, not counting cancelled days) next to the status in the Event panel, and a "Same staff on all days" pill on the role.

### PROVISIONAL — awaiting the client's answers (not built; designed so they can be added)

Recommended answers in brackets.

- **One acceptance booking all days.** Today Accept books one day. [Yes: accepting one flagged day offers all of them, as one action that confirms every sibling or none.] Needs a series-aware accept.
- **Cancel or remove from one day cascading to the others.** [Yes on a worker's self-cancel or an office withdrawal of a flagged day, with the office able to release one day deliberately.] Nothing cascades yet; the office withdraws each day by hand.
- **Telling the worker "all 3 days".** [Yes: Invites, Shifts and Radar show the requirement, and a refused Accept says why.] The Staff App has no copy for it: a refused Accept, apply or take for this gate shows the generic "That didn’t go through — please try again" message (`UNKNOWN` in `apps/staff/app/actions.ts`).
- **Per event rather than per role.** [Per role, as built.] A per-event switch would be a convenience that sets the flag on every section.
- **Declining a sibling day.** A worker who **declined** Saturday is not gated off Sunday (only a self-cancel is, via `self_cancelled`). [Treat a decline of a flagged day as a refusal of the job.]
- **Fixing a clash.** Turning the flag on for one day's role does not turn it on for the other days' roles; the office switches each day. A prompt that offers it is a small follow-up.

## Consequences

- **Limitation: manual invites are gated too.** The brief asked for the manual path to refuse like auto-assign, so `invite_worker(..., 'manual')` is refused with `not_available_all_days`. This is **stricter than a worker's own availability calendar on the section itself**, where the office can "Invite anyway" (ADR-0043). The office's way round is to switch the requirement off for that day.
- **Limitation: a calendar entry on a sibling day** is a hard stop for every source, for the same reason. The calendar entry on the section's own day is unchanged.
- **Existing invitations are not withdrawn** (§3.4), but an Accept on one is refused if a sibling day has since gone wrong, and the invitation is left live.
- **A day that has ended is not a sibling.** A worker who did not work Friday can still be invited to Sunday once Friday is over; slice 1 does not know who "was on" Friday.
- **Sibling pools cost time.** For a flagged section the wrapper runs the whole pool once per sibling (not once per worker) and the projected-hours check once per otherwise-eligible worker. Measured on a local PostgreSQL 16 with 1,038 workers: the pool alone 1.4–1.8 s, the wrapper on a section that is not flagged the same, and a 3-day flagged section about 5.8 s (own pool + two sibling pools + the hours projection). `invite_worker` reads the whole pool each time, so a flagged section's invitations cost about three times as much as an ordinary one's. The sibling pools compute the five §6 factor inputs they do not need; the follow-up is to split the gate out of the pool so a sibling check skips them, if a real job shows it matters. Sections without the flag pay nothing measurable.
- **Redefining `auto_assign_candidates()` drops the gate.** The next migration that wants a new pool gate edits `auto_assign_candidates_pool()`. pgTAP 804 fails if the wrapper is replaced.
- `series_id` and `same_staff_all_days` reach no `client_*` view and no client policy (ADR-0004, ADR-0026); pgTAP 804 asserts it.
- **Not changed:** §3.4's waves, scoring and weights; check-in; pay; the Staff App's screens.
