# ADR-0202 · The Willo webhook follows every interview, and strangers are answered quietly

Status: accepted · 23.10.2026 · **Amends** ADR-0066 §5 (follow our interview only) and ADR-0148 (refusals)

Scope v1.6 §2.4 · `supabase/migrations/20261026100000_willo_strangers_are_quiet.sql` ·
`supabase/functions/willo-webhook/index.ts` · `scripts/willo-webhooks.mjs`

## Context

Sam accepts a candidate in Willo and the card stays at "Interview requested". Their
requirement: **anyone accepted must go to Documents.**

Read from the database on 23.10.2026 (all counts from `audit_log`, `notification_outbox` and
`job_runs`; nothing is inferred from Willo, which we cannot see without its key):

- Every Accept we **received** was applied: 96 `accepted` deliveries since 02.10 (90 moved a
  candidate from the interview to Documents, 6 arrived for someone already past it). No delivery failed after 13.10 (four 500s that day, a
  provisioning fault, retried by Willo). No refusal since 18.10.
- 18 candidates were moved by hand with "Mark interview complete"; 17 of the reasons are some form
  of *"accepted / applied via an old interview link"*, one is "Fast tracked". **None of the 18 has a delivery of any kind** — no
  Received, no New Response, no Accepted, no refusal, no relink. Not "refused": never sent.
- 12 of the 18 (67%) were sent the *existing staff* reminder wording, against 29% of everyone
  invited since 30.09 (158 of 547). They are the people most likely to hold an **old Willo
  invitation from the previous system** — and OC1 tells them to "search your inbox for Willo".
- Reminders themselves do not discriminate: 82% of everyone invited (448 of 547) was reminded;
  16 of the 18 were. What separates the 18 is the *other interview*, not the reminder.
- Six of the 18 had also applied a second time (`duplicate_candidate`, matched on email and date
  of birth). That outcome files no new record and creates no new Willo invitation, which is why
  a person "with two applications, one expired" is one row for us and two participants in Willo.

ADR-0066 §5 registered our webhooks for our interview only (`follow_all_interviews: false`),
because THC has thousands of Willo assessments and a refusal audit row per stranger would bury
the real ones. So a participant on any other interview is accepted in Willo and Willo never
calls us. ADR-0148's relink-by-email already finds a second participant **on our interview**;
it cannot help for an interview our webhooks do not follow.

Not verified, and needs the Willo key: that the 18 really did record on another interview.
`node scripts/willo-webhooks.mjs list` shows what our webhooks follow; Willo's own Developer
tools delivery log shows whether anything was sent for them.

## Decision

1. **Follow every interview.** Our two webhooks (`stage_change`, `new_response`) are switched to
   `follow_all_interviews: true` with `scripts/willo-webhooks.mjs follow-all --apply` (dry run
   by default; touches only webhooks whose address is this project's function; never prints the
   token; `follow-interview --apply` puts it back). THC's two own webhooks are not touched.
2. **Strangers are answered, not audited.** `willo_stranger(email)` is true for a well-formed
   email that no staff row holds, in any status. The receiver, after the key lookup and the
   relink-by-email both fail, asks it: a stranger is answered `200 {"outcome":"stranger"}` and
   writes no `willo_event_refused` row (the delivery still leaves its `job_runs` row, now with
   outcome `stranger`). A delivery with **no readable email**, or an email we do hold, is
   refused and audited exactly as before — those are the ones the office must see.
3. Everything else is unchanged: an Accept needs a candidate still at `interview_requested` or
   `interview_completed` with exactly one live row for that email (ADR-0148), and the login is
   minted the way the office Accept mints it.

## Consequences

- A candidate who records, or is accepted, on any interview THC runs in Willo moves to
  Documents if their email is the one they applied with. **Risk, accepted:** the same person
  accepted on an *unrelated* THC interview (a different job) while waiting on ours would also
  move. They applied to us and are waiting on a decision; the office can Reset to candidate.
- Volume rises to every event on every interview. Each delivery is two or three indexed lookups
  and one `job_runs` row (kept by `860_job_history_retention`); strangers write nothing else.
- Candidates accepted **before** the switch are not replayed (Willo does not re-send a 200).
  Find who is still stuck from Willo's side: participants in the Accepted stage on any
  interview whose email is in `staff` at `interview_requested`/`interview_completed`; the SQL
  half is in docs/23. Until then, **Mark interview complete** then **Accept** as today.
- OC1 still says "search your inbox for Willo". With the interview's public link in the email
  (ADR-0149) the old invitations are no longer needed; the copy is the owner's to change
  (§8 register) and is left alone here.
- Needs the owner to run the script once with `WILLO_API_KEY`; nothing in the apps reads the key.
- pgTAP `932_willo_stranger.sql` (11 assertions).
