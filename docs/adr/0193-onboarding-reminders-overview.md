# ADR-0193 · An overview of the daily onboarding reminders, with their numbers

**Status:** Accepted (owner request, 22.10.2026). Extends ADR-0141 ("Emails staff receive", /staff/roster) from THC's own staff to every candidate in the pipeline. No wireframe: a deviation, like ADR-0141's.

## Context

ADR-0186 made every candidate stuck on a move of their own get a daily email telling them what to do (OC1 the interview, OC2 the account set-up, OC4 the wizard step), until they progress. The owner asked to be able to see those emails, and how many have gone, somewhere in the Back Office. Until now the only numbers were the outbox itself, and `/staff/roster`'s panel, which counts the emails to THC's own staff and nothing else.

## Decision

1. **A page, `/onboarding/reminders`**, linked from the Onboarding screen's top bar ("Reminder emails"). A separate route, not a panel on the board: the board is the heaviest read on the screen (ADR-0161) and stays untouched.
2. **"Where they are stuck"** (with a line when nobody is being reminded; a loading skeleton while the numbers are read): per track (waiting on their interview, accepted but not set up, in the app) the candidates being reminded now, reminded today (UK), **Stalled** (`stalled_after` reminders, no progress; linked to the board's Stalled filter), and with a latest reminder that could not be delivered. The app track adds how many have a device with notifications on, and the candidates by wizard step.
3. **"The reminders":** the fifteen daily reminders in three groups (OC1 first / second / every day after, for new applicants and for existing staff; OC2; OC3 push and OC4 email), each with sent today, sent in all, people reached, not delivered, waiting (and when the next is due) and the last sent. An **Off** pill where the code is switched off in Settings or the job is disabled. A note counts the OC4 emails that went beside a push (ADR-0186) apart from those in place of one (ADR-0169).
4. **View** shows each exactly as it is sent, as ADR-0141 does (the app email twice, with a Notifications off / on toggle, because it reads differently beside a push, ADR-0186): rendered on the server from the register with `messageFor`, a sample name and step, the HTML in a sandboxed frame or as plain text; a push shows its title and words. OC2's button is a sample link, never a live one.
5. **The numbers** come from `onboarding_email_report()` (20261023160000): office logins only, the viewer included, **counts only** (no address, link or payload leaves it; OC2's rows carry a live activation link, ADR-0060, and the function reads none of it). If it fails the page still lists and previews every reminder and says why the numbers are missing.

## Consequences

- +1 `SECURITY DEFINER` function callable by `authenticated` (220: 219 on main, with `archive_client`, `restore_client` and `nudge_check_in_out`, and this one), pinned by pgTAP 892 and 926; docs/14 §4 updated.
- Adding a reminder here means one entry in `REMINDER_EMAILS` (`apps/office/app/onboarding/reminders/reminders.ts`) and one id in the report, in the same order; the vitest suite reads the SQL and holds the two to it.
- No new switch and no change to who is reminded or when.

## Not done

- **Counts fall after the 180-day purge.** `notification_outbox_purge` (ADR-0164) strips a finished row's recipient and every payload field but `rung`, `at` and `variant`. "Sent in all" keeps counting such a row; "People" and the beside-a-push note lose it (no recipient, no `pushOn`). The beside-a-push emails only date from 21.10.2026, so this bites from about April 2027. A running tally would fix it if the history matters.
- **No browser (Playwright) spec** for the page. The unit, render and database tests hold its numbers, its list and its words; a smoke test of the top-bar link and the View dialog is a follow-up.
- **"Stalled" link** opens the board's attention filter, which lists Stalled candidates and those whose last reminder failed, so it can show more cards than the tile counts. It says so.
- **The records behind each count** (who it went to, and why one failed), as ADR-0144 gives the roster. `staff_email_records()` is fenced to the roster's emails. The candidate's own card on `/onboarding` still shows their latest reminder and whether it arrived (ADR-0071).
- **A bounce of the extra email beside a push** is counted in "Not delivered" here and under the OC4 note, but not on the candidate's card (ADR-0186).
- **Sent per day over time**, as the invite list's report draws for IR1.
