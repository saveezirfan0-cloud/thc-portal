# ADR-0011 · A term letter uploaded inside the ladder window runs to the following 31 December

**Status:** Accepted, 21.09.2026. A deliberate, narrow deviation from a literal reading of
§4.2, implemented in `doc_expires_on()` in
`supabase/migrations/20260921170411_compliance_daily.sql`. Recorded because CLAUDE.md says
the scope wins where it and the code disagree, and this is the one place in the compliance
sweep where the code does something §4.2 does not say in so many words.

## Context

§4.2 gives the University Term Dates Letter its own expiry rule, and it is emphatic about
what the expiry is *not*:

> The graduation date printed on the letter is NOT the expiry date — ignore it for
> reminder purposes.
> The letter itself expires 31 December (end of calendar year), regardless of what dates
> are printed on it.
> Reminders start from the beginning of December (one month out), then follow the same
> standard ladder as other documents (§4.2).

and it rejects the obvious alternative by name:

> Explicitly rejected: triggering the reminder one month before the last vacation date
> listed in the letter (too early — the student won't physically have next year's letter
> yet, and we'd block someone who did nothing wrong).

Both halves of that are clear and both are implemented: the letter's own contents are
never consulted, and the ladder opens on 1 December.

The problem is what the ladder is *for*. It opens on 1 December precisely so the student
goes and gets next year's letter. A student who does exactly that — reads N1 on the 1st,
uploads the new letter on the 5th — has, under the literal reading, uploaded a document
that expires twenty-six days later. On 1 January they are auto-blocked under §4.3 and lose
every future shift they hold, having done the one thing the reminder asked them to do.

§4.2 does contemplate blocking around the year boundary, but only for the student who is
late:

> If the student is late uploading a new letter (e.g. it arrives mid-January) — they get
> blocked until they upload it. This is treated the same as an expired passport: not a
> punishment, just "can't proceed until renewed."

"Late" is doing the work there. It does not describe the student who was early.

## Decision

A University Term Dates Letter expires on **31 December of the calendar year it was
uploaded**, except that a letter uploaded in **November or December** expires on the
**following** 31 December.

The window is the two months of the ladder itself, and nothing outside it is affected. The
letter's own printed dates are never read — not the graduation date, not the vacation
ranges, not anything. That is the part of §4.2 this preserves, and it is the part the
scope argues for.

## Alternatives

**The literal reading — always 31 December of the upload year.** Simplest to state, and it
is what the scope says on its face. Rejected because it makes §4.2's own ladder
self-defeating: the reminder exists to produce an upload, and the upload it produces is
worthless. The student is blocked for complying.

**Extend to the last year the letter's own ranges reach.** This was the first
implementation, and it is wrong in a way that is easy to miss: a real term letter almost
always prints a Christmas break crossing into January, so `max(year(range_end))` is next
year for nearly every letter ever uploaded. A letter uploaded in February would live
fifteen months and the student would never be chased at all. That is the "reminder derived
from the printed dates" §4.2 rejects, arrived at by a different route. Caught in review;
see `supabase/tests/200_compliance_daily.sql`, which now fixtures exactly that shape and
asserts it expires on 31 December all the same.

**Ask THC first and ship the literal reading meanwhile.** Rejected on timing, not on
principle — the question is open as `docs/14` Q5 and the answer changes one `case`
expression and one test vector. Shipping the literal reading in the meantime would mean
shipping a known January incident.

## Consequences

- A student who uploads in November or December is safe for the year the letter covers.
- A student who uploads in, say, March gets a letter that dies that 31 December, is
  reminded from 1 December, and is blocked in January if they ignore all three rungs —
  exactly §4.2's "late" case.
- `doc_expires_on()` is still a pure function of the document type, the upload date and
  two date columns. It does not read `term_dates`, so the rejected alternative cannot
  creep back in.
- If THC answers Q5 with "no, the literal reading", this reverses to deleting one
  `case when extract(month from d) >= 11` clause.
