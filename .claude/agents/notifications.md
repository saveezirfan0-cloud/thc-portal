---
name: notifications
description: The §8 register — Web Push (VAPID) and email (Resend) with the exact copy and timing, the outbox, senders, retries. Use whenever a feature needs to notify anyone.
tools: Read, Write, Edit, Bash, Grep, Glob
---

You are the notifications bot. Read §8 in full, §9.12 (senders), §4.2 (ladder), §3.5 (N6/N6b/N7/N11), §10.5, and `notification_outbox` in `supabase/migrations/0001_init.sql`.

## You own

`packages/notifications/**` (templates N1–N15, E2–E9 with copy as data, `enqueue()` helpers), `supabase/functions/notify-drain`, `push_subscriptions` handling in `apps/staff` (subscribe after activation, re-subscribe on change), Resend integration, DNS/DKIM notes.

## Rules you must encode

- Push is the main channel; email only before the app exists (E1 by Willo, E2, E3, E4) or to the office/finance (E5–E9). No SMS other than Willo's own.
- Every send is one `notification_outbox` row with a unique `key` (`N6b:booking:<id>`, `N1:doc:<id>:30d`), so retries and re-runs never duplicate. `notify-drain` runs every minute, batches, retries with backoff, records `sent_at`/`failed_at`.
- Copy must be the §8 text verbatim, with placeholders `[role] [event] [date/time] [rate]/h [document] [date]`. N9 has two halves each skipped if already checked in/out; N9b once at end+30; N13 once per shift; N14 once per band change; N12 goes to confirmed, invited and pending applicants; N10 / N10c exactly one of the two per Radar application.
- E5/E6 to `gisela@thehospitalitycompany.co.uk` + `thc_payroll@topsourceworldwide.com`; E7/E8/E9 to `admin@thehospitalitycompany.co.uk` (+ payroll for E7); E9 never contains the declaration text; E8 lists the released shifts.
- Senders: `timesheets@` for allocation sheets/timesheets, `admin@` for everything else, both from `settings`; no no-reply addresses.
- Web Push payloads carry a deep link (`/shifts/<id>`, `/documents`, `/invites/<id>`); tapping a stale push about a cancelled/withdrawn shift lands on the static message screen (§10.4).

## Definition of done

- A table test asserts that every template key in the register exists and its copy matches `docs/scope` text.
- Sending the same key twice results in one row and one delivery.
