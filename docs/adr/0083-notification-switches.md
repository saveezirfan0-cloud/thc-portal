# ADR-0083 · Notification switches in /settings

**Status:** Accepted (owner request, 02.10.2026, after the first live weekly payroll email reached the payroll provider: "please pause these for now, set up a tab in settings for these notifications so we can turn on and off the notifications going out"). An addition to scope v1.6; §8's register and its copy are unchanged.

## Context

Every notification the platform sends (pushes, emails and the three document emails) is a `notification_outbox` row, and every row reaches the drain through `claim_outbox_batch()`. Until now nothing could stop one code from going out except a deploy. The BG-08 payroll email went to `thc_payroll@topsourceworldwide.com` while the platform was not yet carrying real shifts ("0 shifts"), and the owner wants it paused, and wants to control the others too.

## Decision

**The switch lives in the database.** `settings.notification_switches` holds the codes that are OFF, as `{"BG08": false}`. A code that is absent is on, and only a JSON `false` turns a code off, so a malformed value can never silence the activation email. `notification_switched_on(code)` reads it (20261002113000).

**Off means not sent, not held.** `claim_outbox_batch()` first settles every due row whose code is off: `failed_at = now()`, `error = 'Not sent: switched off in Settings'`, and no attempt spent. Holding them instead would send them all at once on the day the switch comes back on: yesterday's "Confirm tomorrow's shift", a withdrawn invitation, a stale expiry reminder. A row queued for later is judged when it falls due, so switching back on before then lets it go. Because the switch sits at the claim, it holds for every path (jobs, buttons, the drain) without an Edge Function deploy.

**BG08 is stopped at the job, not only at the outbox.** The finance job stamps the week into `payroll_export_lines` and `events.payroll_exported_at` before it queues the email. Off only at the outbox, shifts would read "already included in a payroll export" (§3.3) when finance was never told. So `finance_reports_due()` returns false while BG08 is off: nothing is stamped. Switched back on, it catches up last week, as it already does for a missed Monday. The weeks in between are not sent by the job; /reports exports them.

**BG08 ships OFF.** That is the pause the owner asked for. Every other code ships on.

**The screen.** `/settings` gains two tabs, **General** (the existing blocks) and **Notifications** (`?tab=notifications` opens it directly). The tab badge counts the notifications that are off. Notifications has one panel per audience: finance & payroll, office, clients, candidate & login emails, and Staff App pushes. Each panel has a row per notification showing its name, code and when it goes, plus an On/Off switch that saves the moment it is flicked. The few whose absence breaks something say so while off: E3 (no activation link), E11 (no login set-up link), OM1/OM2 (office messages not delivered), BG08 (weeks not exported). The list is `NOTIFICATION_SWITCH_GROUPS` in `packages/notifications/src/switches.ts`. Its test holds it to exactly the codes the drain can send: every `TEMPLATES` code except E1, which Willo sends, plus `DOCUMENT_EMAILS`. Owners only, through the existing settings policies (ADR-0056). Every change is an audit row like any other settings write.

**The Inbox.** A switched-off office email is listed with its reason. It is not counted in the "N office emails failed" warning, because it was not sent on purpose.

## Consequences

- Turning a code off is immediate (the next minute's drain). Nothing switched off is ever sent later. To send it, a manager does the action again once the switch is on.
- A switched-off row is `failed_at` with the reason above. /inbox and /reports read it as not sent, which is the truth.
- `supabase/tests/771_notification_switches.sql` holds the claim, the BG-08 gate, the "only false is off" rule and the grants. `410_reports_payroll.sql` switches BG08 on for its own run.
