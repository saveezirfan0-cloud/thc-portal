# 23 · Launch-week notes and plan (call with Sam, 23.10.2026)

Read this before `docs/14-handover.md`: it is newer. It records what was agreed, what the database
shows about the Willo bug, and the order of work to launch. Commercial terms are **not** kept in
the repo.

## 1 · Launch

- THC goes live **next week (w/c 26.10)**. It is UK half-term, so volume is low. The week after
  (**w/c 02.11**) is very busy: everything must be working and proven by then. AXLR8 stops on
  Sunday 25.10 (PR #252).
- So the order is: anything a worker or Sam hits on day one first (Willo → Documents, the feedback
  inbox so problems reach us), then everything else. The quiet week is the test window.

## 2 · Decisions from the call

| # | Decision | Where it lands |
|---|---|---|
| 1 | A **feedback button on every page**, capturing the page link automatically | §4 |
| 2 | Fields: **type, summary, details**. Optional **voice dictation**. Optional **screenshot, video or screen recording** | §4 |
| 3 | **Sam sees each item's status and resolution** | §4 |
| 4 | The same feedback system is **reused on Floe** — so it is built as a package, not as THC screens | §4 |
| 5 | **Time is tracked through the feedback system** (a time tracker linked to items) | §4 |
| 6 | **Anyone Sam accepts in Willo must go to Documents** — no exceptions | §3, ADR-0203 |
| 7 | Out-of-scope work to date is **logged and sent to Sam to review**, in-scope fixes separated from new updates | §5 |

Sam thinks onboarding is about 90% done and does not expect much more out-of-scope work.

## 3 · Willo → Documents (diagnosis, 23.10.2026)

Symptom: candidates Sam accepts in Willo stay at "Interview requested". Some webhooks arrive, some
do not; it looked tied to candidates who were sent reminders. The candidate "Carif" (Kaif in the
ADRs) has two applications, one expired.

**What the database says** (queries in §3.2; Willo itself could not be read without its key):

1. Everything we **received** worked. 96 Accepts since 02.10: 90 moved their candidate from the
   interview to Documents, 6 arrived for someone already there. No refusal since 18.10; the only failures were four provisioning 500s on 13.10, which
   Willo retried.
2. The stuck ones were **never sent to us**. 18 candidates were moved by hand with "Mark interview
   complete"; 17 of the 18 reasons read *accepted / applied via an old interview link* (the other is
   "Fast tracked"). **None has a delivery of any
   kind** — not Received, not New Response, not Accepted, not even a refusal.
3. The reminder is a bystander, not the cause. 82% of everyone invited was reminded (448 of 547); so
   were 16 of the 18. What stands out is the **existing-staff wording: 12 of the 18 (67%) against 29%
   of all invitees**. Those people moved over from the previous system and hold *old* Willo
   invitations; OC1 tells them to "search your inbox for Willo".
4. Our webhooks follow **one interview only** (ADR-0066 §5). A candidate who records on an older
   interview is accepted in Willo and Willo never calls us.
5. Carif is one `staff` row (created 08.10, 13 reminders). He applied twice more (18.10, both
   `duplicate_candidate`, which files no new record and creates no new Willo invitation) — so "two
   applications" is one row for us and two participants in Willo. Sam marked him complete on 23.10:
   *accepted an old interview link*. He is now at Documents.

**Fix (ADR-0203):** the webhooks follow every interview; a delivery for an email nobody holds is
answered and not audited (`willo_stranger()`, pgTAP 933) so following everything does not bury the
real refusals. Needs one action from the owner: `WILLO_API_KEY=… node scripts/willo-webhooks.mjs
follow-all --apply` (dry run without `--apply`; `list` shows the state).

**Not proven:** that the 18 recorded on a different interview — only Willo's delivery log and
`node scripts/willo-webhooks.mjs list` can show it. If `list` shows our webhooks already follow all
interviews, the cause is something else and ADR-0203 is wrong; start from Willo's delivery log.

**Still to do:**
- [ ] Owner runs the script; confirm with `list`.
- [ ] Test with one real old-link participant end to end (Accept on an interview not ours; the card
  moves, E3 goes).
- [ ] Find anyone Accepted in Willo before the switch who is still stuck (Willo will not replay):
  Accepted-stage participants on any interview whose email is in the list from §3.2 (c). Move them
  by hand (Mark interview complete → Accept).
- [ ] Pull Willo's delivery history for the 18 to confirm "never sent" (Willo → Integrations →
  Developer tools).
- [ ] Decide whether OC1 should stop telling people to search for the old invitation (owner's copy).

### 3.2 · Queries (read-only; run on the live project)

```sql
-- (a) Every Accept we received, and where it ended up
select a.data->>'fromStatus', s.status::text, count(*)
  from audit_log a join staff s on s.id = a.entity_id
 where a.action = 'willo_event' and a.data->>'event' = 'accepted' group by 1, 2;

-- (b) The hand-moved candidates: any delivery of any kind? reminded? existing-staff wording?
with m as (select entity_id staff_id, at from audit_log where action = 'interview_marked_complete')
select count(*) moved,
       count(*) filter (where exists (select 1 from audit_log w where w.entity_id = m.staff_id
                                       and w.action in ('willo_event','willo_event_refused'))) had_a_delivery,
       count(*) filter (where exists (select 1 from notification_outbox o where o.recipient_staff_id = m.staff_id
                                       and o.template = 'OC1' and o.payload->>'variant' like 'existing%')) existing_wording
  from m;

-- (c) Waiting on Willo longest (compare their emails with Willo's Accepted stage)
select id, status, willo_invited_at::date, willo_completed_at::date
  from staff
 where removed_at is null and status in ('interview_requested', 'interview_completed')
 order by willo_invited_at;

-- (d) Verified deliveries we did not apply, with why (ADR-0198)
select started_at, counts from job_runs
 where job = 'willo-webhook' and counts->>'code' is not null order by started_at desc;
```

## 4 · Feedback inbox (the Ticket system)

Already built and on `main` by the time this was read (PRs #337, #340, #341, ADR-0202, the owner's own
tickets tool): a **Ticket** button in every Back Office top bar, numbered TK-n tickets, `/tickets` and
`/tickets/:id` (triage, report, context, resolution, updates), emails to the owner and to the reporter on
replies and on resolution, voice dictation, and — for the named owner logins only — a scope label and a
time tracker with a monthly report and CSV. **Do not build a second one.** Checked against the call:

| Needed | State |
|---|---|
| Button on every page, page link captured | Back Office: yes. The link is now the full address (query string included) and is clickable on the ticket |
| Type, summary, details | yes (kind, summary, details, plus optional severity) |
| Voice dictation | yes (browser speech recogniser; Chrome, Edge, Safari) |
| Screenshot / video / screen recording | **added here (ADR-0204):** attach files, take a screenshot, record the screen; uploaded after the ticket is saved |
| Sam sees status **and resolution** | yes: status, a Resolution note on the thread, and it is emailed to the reporter. Sam is an owner login, so he also sees the scope label and the time (named in `settings.ticket_tracking_emails`) |
| Time tracked through it | yes: start/stop timer or manual entry per ticket, labelled Me / Claude, billable flag, monthly report + CSV |
| Button in the Staff App and Client Portal | **not built.** Deliberate: ~1,000 workers would write straight into the owner's inbox in launch week. Say if Sam wants it, and for which app |
| Reusable on Floe | not packaged; the checklist below is what to take |

**Taking it to Floe.** Nothing in it is THC-specific except these dependencies, which Floe needs an
equivalent of: `profiles` (+ `office_role`), `current_app_role()`, `assert_office_caller()`,
`office_read_only_guard()`, `notification_outbox` + the `TK1` template (`packages/notifications`),
`settings`, `storage_deletions` + the gdpr-purge drain. Copy: migrations `20261025110000_tickets`,
`20261026090000_ticket_reply_and_tracker_list`, `20261026110000_ticket_files`; `apps/office/app/tickets/`;
`_components/ReportButton.tsx`, `DictateButton.tsx`, `report-button.css`; `_lib/{dictation,screenCapture,
signed-upload,sharedState}.ts`; pgTAP 932 and 934. Extracting a shared package is worth doing only once Floe's
tables are known; guessing them now would just move the THC assumptions into a package.

**Not run in a browser.** Screen capture and recording need a real browser tab and the Supabase Storage
service; neither exists in the build sandbox. Types, lint, unit tests and the screen render pass; the upload
path (signed URL → PUT → `attach_ticket_file`) and the recording bar must be tried once on the live site before
launch: file attach, screenshot, a 20-second recording while clicking to another page, then open the ticket.

## 5 · Out-of-scope log

Compiled from the ADRs (the git history only starts 18.10), classified against scope v1.6 as
**in-scope fix** / **new or changed work** / **technical**, for Sam to review. Hours are the
developer's to confirm — the repo cannot know them. The training-video set-up and upload is not in
the repository; it is added to the log from the developer's own records.

## 6 · Status of everything else

Unchanged from `docs/14-handover.md` and the open PRs. The open sweep PRs (#277–#285) and the UI polish
PRs are the launch-week review queue; none are touched here.
