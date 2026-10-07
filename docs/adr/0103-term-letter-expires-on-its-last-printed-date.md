# ADR-0103 · A term letter expires on the last day printed on it

**Status:** Accepted, 07.10.2026, at the product owner's instruction. **Supersedes
ADR-0011** and reverses two sentences of §4.2 on purpose, so it is also listed under
"Deliberate changes from the scope" in `CLAUDE.md` (the scope normally wins). Implemented
in `supabase/migrations/20261007130000_term_letter_expires_with_its_own_dates.sql`;
mirrored in `termLetterExpiresOn` in `packages/domain/src/documents.ts`.

## Context

§4.2 gave the University Term Dates Letter one expiry for everybody, 31 December,
"regardless of what dates are printed on it", and rejected by name the alternative of
reminding from the last vacation date on the letter ("too early — the student won't
physically have next year's letter yet"). ADR-0011 then moved a November/December upload
to the following 31 December so the ladder would not eat its own tail.

In use, the calendar rule asks the wrong question. A letter that runs to September 2027 is
still a perfectly good letter in December 2026, yet the worker is chased for a new one and,
if they do not upload, blocked on 1 January. And the rule says nothing about the letter that
*is* about to run out — one that stops at Christmas is "valid" until 31 December anyway. The
requirement is the one the office states plainly: **we always need to have a valid letter.**
A letter is valid for as long as the dates on it cover, and the system should read that from
the letter.

## Decision

A University Term Dates Letter expires on **the last day printed on it** — the latest end
of the date ranges on the letter (the extractor's, or the reviewer's "+ Add period"),
inclusive. Everything that follows from an expiry then follows, unchanged and automatic:

- **N1** one month before that day, **N2** two weeks, **N3** one week, **N4** on the day
  (§4.2 standard ladder);
- the **automatic block** on the expiry day, with the §4.3 cascade, exactly as for a
  passport; a late upload is "blocked until renewed";
- the Radar, the Documents tabs (office and worker) and the N-copy date.

`doc_expires_on()` gains a sixth argument, the letter's ranges, and every caller that holds
a document row passes them. The sweep, the block and the Radar needed no change of their
own: they all read `current_verified_docs()`.

**Fallback.** A letter with no readable dates (the extractor found none and the reviewer has
not added any) keeps ADR-0011's calendar rule — 31 December of the upload year, the
following one if uploaded in November or December — so there is always an expiry to enforce.
It is the exception, and the reviewer sees which case they are in: the Needs review line
reads "Letter expires 19.09.2027" from the ranges, and the candidate's Documents list says
"(last date on the letter)" or "(no dates read — calendar-year fallback)".

## Unchanged on purpose

- The printed **graduation / course-end date** is still not the expiry, and is still
  informational (`ai_term_letter`).
- An **already-expired letter is not accepted** (`term_letter_expired()`, 20260928110300).
- A verified **completion letter stops the ladder** and the block for that worker (§4.5,
  `term_letter_applies()`).
- The weekly cap is still calculated from the verified holiday ranges, never stored (RULE-20).

## Consequences

- A student is reminded a month before their letter genuinely stops covering them, and not
  before. A letter covering the whole academic year (summer vacation ending in late
  September) is chased from late August.
- The point ADR-0011 fixed disappears with its cause: a new letter uploaded early carries
  later dates, so it is never "dead on the 31st".
- The risk §4.2 named — the student will not have next year's letter a month before the old
  one ends — is accepted by the office. The ladder still runs a month, two weeks and a week,
  and the block is the same "can't proceed until renewed" as an expired passport.
- A letter that lists only the autumn term and the Christmas break expires in January. That
  is correct (it covers nothing after), and the reviewer can add the missing periods before
  verifying.
- The stored `expiry_date` on a term letter is still the calendar stamp written at upload;
  it is not a finding and is not shown as one. Nothing reads it for a term letter.

## Alternatives

**Keep 31 December and only remind earlier.** Does not fix the letter that is valid past
December, which is the complaint.

**Expire on the printed course-end date.** That is the graduation date §4.2 says is not the
expiry, and it is typically years away.
