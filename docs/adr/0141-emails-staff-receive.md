# ADR-0141 · The invite list shows every email staff receive, with its numbers

**Status:** Accepted · **Refines:** ADR-0123 (the invite list's report) · **Owner request:** 15.10.2026

## Context
On 14.10.2026 the owner made the daily chasers to THC's own staff firmer and sent a one-off interview notice. Then they asked: "how can I see the content of emails being sent out — can we have something on /staff/roster, along with email numbers". Until now the only way to read an email was the register's source (`packages/notifications`) or a developer's preview run, and the page counted only IR1.

## Decision
- **A new panel, "Emails staff receive"**, on `/staff/roster`, below the daily reminder. It lists the five emails THC staff get while moving onto the new app, one row each:
  - **Daily reminder to register:** IR1, to THC rows on the list not yet applied (ADR-0122);
  - **Interview reminder · first, · second, · every day after:** OC1's `existing_*` rungs, to existing staff who registered but have not done the Willo interview (20261012123000);
  - **One-off interview notice:** OC1 `existing_notice` (20261014190000).

  New applicants' OC1 wording is not listed: they are not on the invite list.
- **Each row** shows the subject, who gets it and when, then sent today (UK), sent in all (and when the last one went), people reached, not delivered, and waiting. An "Off" pill appears when the email's switch, or its job's, is off. Above the table:
  - registered, interview not done;
  - the one-off notice sent, or waiting and from when;
  - all of them sent today.
- **View** opens the email itself in a dialog, **As sent** (the HTML in a sandboxed frame: no scripts, no same origin) or as **Plain text**:
  - The page renders it on the server with `messageFor`, the drain's own function, from the register, so what the office reads is what staff get, and a copy can never drift. The register does not reach the browser bundle.
  - It uses a sample first name, Amara. The THC Light logo is a `cid:` attachment only a mail app resolves, so the preview inlines the same PNG as a data URL; `@thc/notifications` gains the `./email-logo` subpath for that.
  - IR1's Register button points at `NEXT_PUBLIC_STAFF_URL` + `/apply`, the live address when that variable is unset.
- **The numbers** come from `staff_email_report()`, office logins only (the viewer included), read beside `invite_roster_report()`. If it fails, the panel still lists and shows every email, the numbers read "—" and the panel says why; the list and its export do not depend on it.
- There is still no wireframe. This extends the deviation recorded in ADR-0107, ADR-0123 and ADR-0138.

## Consequences
- Adding an email to this panel means one entry in `STAFF_EMAILS` (`apps/office/app/staff/roster/emails.ts`) and one id in `staff_email_report()`; the tests hold the two to the same order.
- pgTAP 840; vitest `apps/office/app/staff/roster/__tests__/emails.test.tsx`.
