# ADR-0012 · Completion letter: retention over removal, and what the rota guard may relax

**Status:** Accepted, 23.09.2026, pending THC's confirmation of point 1. Implemented in
`supabase/migrations/20260923100100_completion_letter.sql` and
`supabase/migrations/20260923100200_rota_guard.sql`; tested in
`supabase/tests/361_completion_letter.sql` and `362_rota_guard.sql`.

The University Completion Letter requirement
(`docs/scope/university-completion-letter-requirement.pdf`) is a later THC document than
scope v1.6. In three places it meets the scope and the two do not say the same thing. The
B6b brief says the cautious reading wins, because the exposure is civil penalties for
illegal working. These are the three readings taken.

## 1 · A GDPR removal holds an employed worker's completion letter for two years

**The conflict.** §1.7 of the scope: removal wipes "contacts / documents / photo". The
requirement §4: completion evidence is "retained for the duration of employment plus two
years after it ends (in line with right-to-work evidence retention)". A worker who was
employed and asks to be removed six months after leaving sits inside both.

**The decision.** The legal retention obligation wins (UK GDPR Art. 17(3)(b): erasure does
not apply where processing is needed to comply with a legal obligation). `remove_worker()`
still anonymises the person and deletes every other document; the completion letter row and
its Storage object are *held* with `retain_until` = end of employment + 2 years, and
`rtw_daily()` purges both when that date passes, writing `completion_letter.purged` to the
audit trail.

- Employment ends at `left_at`, or at the removal itself if they never left.
- Someone never employed (no contract signature, no Employee ID) has no employment to
  retain against: their letter is wiped exactly as before.
- Only the completion letter. The requirement asks for it by name; whether the same
  argument should hold passports, visas and share-code reports is a wider decision about
  §1.7 and is **not** made here.

**Confirm with THC:** that the retention obligation should override a removal request for
this document, and whether it should for other right-to-work evidence too.

## 2 · The rota guard's "warn" relaxes the Working Time 48 only

**The requirement.** §4: "Rota/scheduling engine must warn (or block, configurable) when a
shift assignment would breach the worker's current cap." But §2.3 also says "for
scheduling/alerting purposes, treat 48 hours/week as the hard cap unless an opt-out is on
file", acceptance criterion 1 says a student "cannot be rostered" past 20 hours, and
criterion 6 says "no worker can be rostered beyond their recorded visa expiry".

**The decision.** One setting, `settings.rota_guard_mode`, default `block`, and it governs
exactly one limit:

| Limit | block (default) | warn |
| --- | --- | --- |
| Past the right-to-work expiry (per shift, by its end) | refused | refused |
| Student visa 20 h (10 h below degree) in term | refused | refused |
| Working Time 48 h, no opt-out in force | refused | allowed, recorded as `rota_guard.warned` |

The immigration limits are never configurable, whatever the screen says; `/settings` says
so next to the control. The decision is one pure function held to shared vectors
(`packages/domain/src/rotaGuard.vectors.json`) in TypeScript and SQL.

It is enforced twice: `weekly_cap_would_breach()` (the gate auto-assign, invite and accept
already call) asks the guard, and a `BEFORE` trigger on `bookings` refuses any move into
`confirmed` that the guard blocks — so a direct write by the office, or a confirm path not
built yet, cannot get round it.

## 3 · A completion letter is only ever verified with both confirmations

**The requirement.** §2.2: "On approval, the reviewer confirms/enters: the course
completion date, and the visa expiry date."

**Why it needs a rule on the row.** RULE-20 (`20260922093100`) reads a verified letter with
no completion date as "the flag alone releases" — the pre-requirement behaviour. Any
generic Verify that flips a completion letter to `verified` without writing a date (the
onboarding screen's `verify_document()` in `20260923110000` is one) would therefore release
48 hours from the moment of the click, which is the failure §7 names.

**The decision.** A `BEFORE UPDATE` trigger refuses the transition of a completion letter
to `verified` unless `completion_date` and `confirmed_visa_expiry` are set in the same
write. `approve_completion_letter()` does that; nothing does it by accident. Rows inserted
already verified (seed history) are not transitions and are untouched.

## Consequences

- Any screen that verifies documents must route a completion letter to
  `approve_completion_letter(doc, completion_date, visa_expiry)`.
- The Radar's warnings panel is empty unless THC chooses warn.
- A removed worker's profile can still show a held completion letter until the purge; it is
  the one document §1.7's "documents wiped" does not reach, for the reason above.
