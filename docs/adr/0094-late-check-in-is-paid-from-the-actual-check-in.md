# ADR-0094 · A late check-in is paid from the actual check-in, not the scheduled start

Status: accepted · 05.10.2026 · changes RULE-01 / §5.1 / §5.2 (scope wins elsewhere); raise with THC

## Context

- Scope v1.6 §5.1/§5.2 (RULE-01) paid a check-in inside the 30-minute grace from the
  **scheduled start**, and only a check-in past it from the actual time. A worker who
  walked in 25 minutes late was marked Late and paid for the 25 minutes they missed.
- THC's decision: staff may check in on site up to 30 minutes early, billing and pay start
  at the scheduled start, and a worker who arrives late is paid only from when they check in.

## Decision

- The paid clock starts at the **later** of the scheduled start and the actual check-in:
  `effectiveStart()` in `packages/domain/pay.ts` and `payable_minutes()` (migration
  `20261006180000`). Early arrival is still not paid.
- The 30-minute grace is unchanged for **status**: a press inside it is Late, at start+30
  with no check-in the worker is an automatic No-show and the button locks (§5.1, RULE-15's
  turn-away window).
- RULE-14's four-hour floor, the 15-minute check-out grace and the Left-early rule are
  unchanged: a late worker who works a short shift is still floored to four hours unless a
  Left-early violation applies.
- Scope §5.2 wording updated; `pay.vectors.json` (both halves), the staff shift screen copy,
  the Back Office payroll line note and the pgTAP payroll fixture follow.

## Consequences

- Payroll, the Financial report and client invoicing (payable hours at the charge rate)
  all fall for late arrivals: they read `payable_minutes()`. The late minutes are dropped
  from the §9.9 invoicing forecast too; that is intended (the client is not billed for time
  nobody worked).
- Exports already issued are never corrected retroactively (RULE-01 notes); only rows
  computed after the migration use the new rule.
