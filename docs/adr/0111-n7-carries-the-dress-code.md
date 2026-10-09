# ADR-0111 · The morning-of push carries the role's dress code

**Status:** Accepted · Scope §3.2, §3.5 stage 3, §8 N7, §9.7 · **Owner request:** 09.10.2026 · `20261009100000_n7_carries_the_dress_code.sql`

## Context

The product owner asked that anyone booked on to a United Grand Lodge shift be
notified on the morning of the shift, and told to confirm, not to forget to
arrive in their plain black waistcoat and plain black tie.

§3.5 stage 3 already sends that push: N7, "Confirm today's shift", from 09:00
UK on the day (or two hours before an earlier start — ADR-0029, ADR-0034). §8
gives it one line of copy and nothing about dress. The dress code itself is
already in the data: it is set per client and role on the rate card (§9.7),
copied on to each role section when an event is built (§3.2,
`shift_requirements.dress_code`), shown on the shift card and in the
invitation, and a change to it re-confirms everyone booked (§3.5).

## Decision

1. **N7 gains a `dress-code` variant** in the §8 register
   (`packages/notifications/src/templates.ts`):

   > Confirm today's shift — and don't forget to arrive in your {dressCode}

   §8's own line stays as the code's `body`, and is what goes out when the row
   names no variant.

2. **`booking_tick()` names the variant only when the section has a dress
   code.** The N7 payload gains `variant: 'dress-code'` and `dressCode` (the
   section's `dress_code`, trimmed) when it is non-blank, and nothing
   otherwise. The code is read when the reminder is queued; a later change to
   it re-confirms everyone anyway.

3. **Nothing names a client.** The reminder is driven by the section's dress
   code, not by who the client is, so it is the same mechanism for every
   client. For United Grand Lodge the office sets *Plain black waistcoat and
   plain black tie* as the dress code on each of their rate cards
   (Clients → United Grand Lodge → Roles & rates, §9.7); every event built for
   them then defaults to it, and every worker confirmed on one of those
   sections is told so on the morning of the shift.

4. **A register code may have a body and variants.** Until now a code had
   one or the other (N9, N14, CL2 and the chasers have variants only). `body()`
   and `messageFor()` now send the body when such a code's row names no
   variant, so an N7 row queued before this change still goes out, and an
   unknown variant is still refused.

5. **N6 is unchanged.** The day-before push asks for "I'm ready" by noon and
   says nothing about dress; the morning-of push is the one that reads "don't
   forget".

## Consequences

- The copy is one more sentence on the §8 line, so the worker-facing wording
  deviates from §8 only by the appended clause, and only where a dress code
  exists. Recorded in `packages/notifications/REGISTER-NOTES.md`.
- A dress code typed on the rate card is sent to workers verbatim after
  "arrive in your …", so it should be written as a thing one arrives in
  ("Plain black waistcoat and plain black tie", "Black & whites"), not as an
  instruction.
- pgTAP `784_n7_carries_the_dress_code.sql` holds what the job writes; the
  Vitest register suite holds the copy and the fallback.
- The push gallery in `wireframes/staff/locks.html` shows both forms of N7.
