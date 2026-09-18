---
name: thc-domain-rules
description: Look up and apply the numbered rules (RULE-01…RULE-21), background jobs (BG-01…BG-10), notification register (N1–N15, E1–E9) and state machines from the THC Scope of Work before implementing any business logic. Use whenever code touches bookings, check-in, pay, compliance, caps, notifications or status transitions.
---

# THC domain rules — quick index

Full text: `docs/scope/scope-of-work-v1.6.txt`. Grep hints: `grep -n "RULE-0" docs/scope/scope-of-work-v1.6.txt`, `grep -n "^BG-" …`, `grep -n "^N[0-9]" …`.

## Rules
| Rule | One line | § |
|---|---|---|
| RULE-01 | payable = [check-in, check-out] ∩ [role start, role end]; 30-min check-in grace paid from start; 15-min check-out grace paid to end | 5.2 |
| RULE-02 | no check-out by end+4 h (or off-site with no on-site fix) → "No check-out" violation; manager enters actual finish (UK time); never a silent default | 5.2, 9.5 |
| RULE-03 | first to confirm takes the slot; loser sees "Sorry, this shift has been taken" and invite closes | 3.4 |
| RULE-04 | self-cancel only > 72 h before start; no show-rate impact; permanent exclusion from that event | 3.6 |
| RULE-06 | payroll week Mon–Sun, paid Friday | 7 |
| RULE-07 | buffer is an absolute number per role | 3.2 |
| RULE-08 | same-day shifts get auto-assign like any other; self-apply is additional | 7 |
| RULE-09 | quiz 80%, 3 attempts, third fail → rejected | 2.9 |
| RULE-10 | quiz locked until every document (and a Yes declaration) verified | 2.3 |
| RULE-12 | blocked / non-compliant is a hard gate before scoring | 4.4 |
| RULE-14 | 4-hour floor for workers who worked; blocked by Left-early or unresolved No check-out | 5.2 |
| RULE-15 | strict buffer turn-away: 4 h fixed if attempt inside grace, nothing if late | 5.2 |
| RULE-16 | invites/applications vanish once the event ended (live filter, no job) | 7 |
| RULE-17 | qualified at client+role invited first, fully, then everyone else; ordering not gate | 3.4 |
| RULE-18 | per-role start/end; every timing rule uses the role window | 3.2 |
| RULE-19 | Request my P45 → inactive; release future bookings; E8 | 10.6 |
| RULE-20 | weekly cap calculated (20 term / 48 holiday / 48 graduated / none with opt-out and no visa limit); straddling week takes the lower | 4.4 |
| RULE-21 | conviction declared in employment → blocked like an expired doc; E9 without details; verify → N15 | 10.7 |

## Background jobs (§7)
BG-01 check-in reminder −30 min · BG-02 check-out reminder −30 min · BG-02b +30 min after end · BG-03 manager red alert −30 min → auto No-show at +30 · BG-04 expiry ladder · BG-05 auto-block on expiry · BG-06/07 geofence tracking + violation · BG-08 Monday 09:00 finance CSVs · BG-09 No check-out at end+4 h · BG-10 6-hour break alert. Crons: `auto_staffing` hourly :17 · `--cutoff` 12:05 · `--escalation` every 10 min · `compliance_daily` 05:00 · Willo webhook.

## Notifications (§8)
Push N1–N4 expiry ladder · N5 invite · N6 day-before · N6b removed at cutoff · N7 on-the-day · N8 rejected doc · N9/N9b check-in/out reminders · N10 application accepted · N10b withdrawn by office · N10c role filled · N11 time changed · N12 event cancelled · N13 6-hour break · N14 cap changed · N15 shifts open again. Email E1 Willo invite · E2 interview rejection · E3 activation · E4 quiz failed · E5 bank change · E6 NI entered · E7 email/address change · E8 P45 · E9 conviction declared. Copy lives in `packages/notifications/templates.ts` and must match §8 verbatim.

## State machines
Staff (§2.12): interview_requested → interview_completed → documents → quiz → additional_info → contract → compliant; → rejected; compliant ⇄ blocked; compliant/blocked → inactive (worker only); compliant → removed (GDPR); blocked/rejected/inactive → interview_requested via Reset to candidate.
Booking (§3.6): invited → confirmed → worked; invited/confirmed → cancelled (withdraw / cutoff / GDPR / block / leave / event cancelled / self-cancel); invited → closed (lost first-to-confirm); applied (Radar) → confirmed or closed; No check-out is a flag on worked, not a state.

## When implementing
1. Quote the rule in a code comment with its § number.
2. Add a test vector named after the rule (`RULE-14 floor blocked by left-early`).
3. If the DB must enforce it (atomic, cross-user), implement in a Postgres function and mirror the maths in `packages/domain` for display.
