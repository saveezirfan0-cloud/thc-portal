# ADR-0144 · Each email count on the invite list opens the records behind it

**Status:** Accepted · **Refines:** ADR-0141 (Emails staff receive) · **Owner request:** 15.10.2026

## Context
"Emails staff receive" on `/staff/roster` shows, for each email, sent today, sent in all, people, not delivered and waiting. The owner asked: "when we click, we should be able to see records". A number alone does not say who the 49 "not delivered" were, or why.

## Decision
- **Every count above zero is a link.** It opens a dialog titled with the email and the count, e.g. "Interview reminder · every day after · Not delivered (49)". A zero, or a count the page could not read, is plain text.
- **The dialog lists the records**, 100 at a time with the shared Pager:
  - **Name:** their staff record, linked to the profile, when the email names one or somebody holds the address; otherwise the name on the invite list, or the name the email greeted them by;
  - **Email address**;
  - **When**, in UK time: sent, last sent (People), stopped (Not delivered), or due (Waiting);
  - **Times** (People): how many of this email the address has had;
  - **Why** (Not delivered): the commonest causes in plain words ("The email address is not valid", "Cancelled: the email was switched off before it went", a bounce, a suppressed address), with the provider's own words under them.
- **`staff_email_records(p_id, p_kind, p_limit, p_offset)`**:
  - office logins only, the viewer included; it reads, it changes nothing;
  - takes the page's own ids and kinds and refuses anything else;
  - sorts latest first, except Waiting (soonest first);
  - caps a page at 500 rows and gives the total.
- The records are read when the dialog opens, through a server action with the office's session, so the page itself carries no addresses until somebody asks.

## Consequences
- pgTAP 843; vitest `emails.test.tsx` and `actions.test.ts`.
