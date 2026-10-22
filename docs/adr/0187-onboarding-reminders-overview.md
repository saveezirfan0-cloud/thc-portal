# ADR-0187 · An overview of the daily onboarding reminders, with their numbers

**Status:** Accepted (owner request, 22.10.2026). Extends ADR-0141 ("Emails staff receive", /staff/roster) from THC's own staff to every candidate in the pipeline. No wireframe: a deviation, like ADR-0141's.

## Context

ADR-0186 made every candidate stuck on a move of their own get a daily email telling them what to do (OC1 the interview, OC2 the account set-up, OC4 the wizard step), until they progress. The owner asked to be able to see those emails, and how many have gone, somewhere in the Back Office. Until now the only numbers were the outbox itself, and `/staff/roster`'s panel, which counts the emails to THC's own staff and nothing else.

## Decision

1. **A page, `/onboarding/reminders`**, linked from the Onboarding screen's top bar ("Reminder emails"). A separate route, not a panel on the board: the board is the heaviest read on the screen (ADR-0161) and stays untouched.
2. **"Where they are stuck":** per track (waiting on their interview, accepted but not set up, in the app) the candidates being reminded now, reminded today (UK), **Stalled** (`stalled_after` reminders, no progress; linked to the board's Stalled filter), and with a latest reminder that could not be delivered. The app track adds how many have a device with notifications on, and the candidates by wizard step.
3. **"The reminders":** the fifteen daily reminders in three groups (OC1 first / second / every day after, for new applicants and for existing staff; OC2; OC3 push and OC4 email), each with sent today, sent in all, people reached, not delivered, waiting (and when the next is due) and the last sent. An **Off** pill where the code is switched off in Settings or the job is disabled. A note counts the OC4 emails that went beside a push (ADR-0186) apart from those in place of one (ADR-0169).
4. **View** shows each exactly as it is sent, as ADR-0141 does: rendered on the server from the register with `messageFor`, a sample name and step, the HTML in a sandboxed frame or as plain text; a push shows its title and words. OC2's button is a sample link, never a live one.
5. **The numbers** come from `onboarding_email_report()` (20261023130000): office logins only, the viewer included, **counts only** (no address, link or payload leaves it; OC2's rows carry a live activation link, ADR-0060, and the function reads none of it). If it fails the page still lists and previews every reminder and says why the numbers are missing.

## Consequences

- +1 `SECURITY DEFINER` function callable by `authenticated` (217), pinned by pgTAP 892 and 924; docs/14 §4 updated.
- Adding a reminder here means one entry in `REMINDER_EMAILS` (`apps/office/app/onboarding/reminders/reminders.ts`) and one id in the report, in the same order; the vitest suite reads the SQL and holds the two to it.
- No new switch and no change to who is reminded or when.

## Not done

- **The records behind each count** (who it went to, and why one failed), as ADR-0144 gives the roster. `staff_email_records()` is fenced to the roster's emails. The candidate's own card on `/onboarding` still shows their latest reminder and whether it arrived (ADR-0071).
- **A bounce of the extra email beside a push** is counted in "Not delivered" here and under the OC4 note, but not on the candidate's card (ADR-0186).
- **Sent per day over time**, as the invite list's report draws for IR1.
