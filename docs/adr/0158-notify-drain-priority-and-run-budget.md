# ADR-0158 · The outbox drain settles as it goes, works to a time budget and claims urgent sends first

Status: accepted · 17.10.2026 · **Amends** the P2 drain (`20260924100000`, ADR-0083's claim)

Scope v1.6 §8, §10.5 · `supabase/migrations/20261019160000_notify_drain_priority.sql` ·
`packages/notifications/src/{drain,priority}.ts` · `supabase/functions/notify-drain/index.ts` ·
`supabase/tests/856_notify_drain_priority.sql`

## Context

The concurrency audit before go-live (finding H3, with M4) found two faults in `notify-drain`:

1. **Resends after a killed run.** A run claimed 40 rows, sent them one after another (up to
   15 s per HTTP call) and wrote the verdicts only at the end. Runs of 124 s were observed
   against the Edge Runtime's 150 s wall clock. An isolate killed in between had sent rows it
   never recorded; after the 5-minute lease they were sent again. Resend's `Idempotency-Key`
   absorbs that for email. Web Push has no such key, so the worker got N5 or N6b twice.
2. **Urgent sends behind bulk.** The claim was oldest-first. Bursts of 1,035 rows a minute
   (the OC1/IR1 chasers) took ~26 minutes to drain at 40 a run, and N9 "Time to check in"
   (start − 30 min), N6b releases and N5 invitations waited behind them.

## Decision

- **Settle each row as soon as its send returns.** `drainRun()` in `drain.ts` takes an
  `OutboxStore` port (claim, settle, release) and writes every verdict before that worker
  starts its next row. If the isolate is killed, the only rows it can leave unrecorded are
  the ones in flight at that moment.
- **A time budget.** A run claims in batches of 30. It makes no new claim after 45 s and
  starts no new send after 50 s. The rows it has claimed but not started go back through
  the new `release_outbox_claims(ids[])`: they are due again at once, the attempt is
  refunded and the last error is kept. The next run takes them in priority order rather
  than after the lease. 50 s is well short of the "30 s before the wall clock" ceiling,
  on purpose. A run normally ends before the next minute's run starts, so only one drain
  at a time is spending the Resend rate. The slowest send still in flight then is bounded
  by `HTTP_TIMEOUT_MS` (now 10 s), so the run finishes far inside 150 s.
  `NOTIFY_DRAIN_SEND_FOR_MS` can move the budget, capped at 110 s.
- **Bounded concurrency and rate limits.** Six sends at a time (`NOTIFY_DRAIN_CONCURRENCY`,
  1–16). Resend calls are spaced 500 ms apart, which is Resend's default of 2 requests per
  second (`RESEND_REQUESTS_PER_SECOND` raises it for a bigger plan). The existing 429
  handling is kept: a 429 from Resend or a push service is still that row's `retry` with
  `outbox_backoff`. In addition, a Resend 429 holds the rest of the run's email, and those
  rows are released unattempted instead of each spending an attempt on the same 429. A
  batch that is all held email ends the run (`stoppedBy: 'throttled'`). A push service's
  429 stays per row, because those limits are per device or per sender.
- **Priority.** `notification_outbox.priority` (0 urgent · 1 normal · 2 bulk) is set by a
  trigger at insert, and on a change of template, from `notification_priority(template)`.
  No enqueue path sets it. `claim_outbox_batch()` orders by `priority, send_after, id`. Its
  body is otherwise `20261002113000`'s: the switched-off settle, `for update skip locked`,
  the lease and the unique key are unchanged. A partial index
  `(priority, send_after, id) where sent_at is null and failed_at is null` serves that
  order. Queued rows are backfilled. Settled rows keep the default, because the column only
  orders the claim.
- **One source for the classes.** `SEND_PRIORITY` in `packages/notifications/src/priority.ts`
  is a mapped type over every register code and document email. A new code does not compile
  until it is given a class. `priority.test.ts` holds the latest migration's
  `notification_priorities()` rows to that table exactly, and on a mismatch it prints
  `priorityValuesSql()` to paste. It also holds the pgTAP file's code list to the register,
  and pgTAP 856 fails while the database's mapping misses any code on that list. A code
  that is still unknown at run time is *normal*, so it is never held back.

  - Urgent: N5, N6, N6b, N7, N9, N9b, N10, N10b, N10c, N10d, N11, N11b, N12, N13, E10,
    OF1–OF6, CR2, OM1, OM2.
  - Bulk: OC1–OC3, IR1, N1–N3, CL4.
  - Normal: everything else.

## Consequences

- A burst of chasers is sent after every urgent row that is due. An N9 queued during a run
  waits at most one batch, because each claim reads the order again.
- Email throughput is bound by the Resend rate (about 100 per run), not by the batch size.
  Push throughput is a few hundred per run.
- `job_runs.counts` gains `released`, `batches`, `stoppedBy` and, when Resend throttled the
  run, `emailThrottled`.
- `packages/db/src/types.generated.ts` was updated by hand for the new column and functions
  (no Supabase CLI in the authoring sandbox). Regenerate it with `gen:types` when convenient.
