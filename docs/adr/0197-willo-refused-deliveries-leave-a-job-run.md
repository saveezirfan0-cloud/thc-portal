# ADR-0197 · A Willo delivery that is verified but not applied leaves a job run

Status: accepted · 23.10.2026 · **Amends** ADR-0021 (one `job_runs` row per verified delivery)

Scope v1.6 §2.4 · `supabase/functions/willo-webhook/index.ts`

## Context

Candidates whose card did not move after an Accept in Willo (Kaif, 23.10.2026, and 18 others
moved by hand with "Mark interview complete") have no `willo_event`, no `willo_deliveries` row
and no refusal. Two outcomes left no trace at all: a delivery with the right token whose body
could not be read (400 `no_event_type` and the like), and one older than the replay window
(200 `stale`, ADR-0164). From the database the office could not tell "Willo never sent it"
from "Willo sent it and we turned it away".

## Decision

Both now write a `willo-webhook` row in `job_runs` through `recordRun`, with `status` and a
`code` (the parser's reason, or `stale`). The write happens only after the token check, so an
unverified call still writes nothing. A failure of the bookkeeping is logged and never changes
the answer Willo gets. Answers are unchanged: 400 for unreadable, 200 for stale.

## Consequences

- `select started_at, counts from job_runs where job = 'willo-webhook' and counts->>'code' is not null`
  now lists every verified delivery that was not applied, with why.
- A call refused on the token (401) is still not recorded; the edge function log has it.
- Nothing here finds a participant on another interview: Willo only calls us for the interviews
  our webhooks follow (ADR-0066 §5).
