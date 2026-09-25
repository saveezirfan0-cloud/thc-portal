# §8 register — what the scope leaves open

The register in `src/templates.ts` is complete against §8: every push (N1–N15,
including N6b, N9b, N10b, N10c) and every email (E1–E9) has one entry, and the
test holds the set of codes to the two §8 tables (`SCOPE_CODES`). Two sends §8
does not list are carried as extensions (`EXTENSION_CODES`), each saying why in
its own `trigger`: E2b (below, and 20260923170000) and E10, the §9.12
self-cancel email (see "Missing from §8").

Where §8 states a trigger in prose rather than the string that goes out, the
copy is taken from the screen carrying the same wording — `wireframes/staff/
locks.html` for the push register (its own note says "Copy above is verbatim
from §8"), §10.1 for E4, §10.6 and §10.7 for E8/E9. Everything that involved a
judgement call is listed below, for THC to confirm before anything sends.

## Push

| Code | What §8 gives | What the register uses | Why |
| --- | --- | --- | --- |
| N1 | `"update your [doc]"` | `Update your {document} — it expires on {date}` | §8's phrasing is a summary, not a sendable string. The wireframe register and the Documents push gallery both carry the expiry date, and N1 is a month out — without the date the worker cannot tell which deadline is meant. |
| N4 | §8 register: `"You have been blocked — please update"`; §4.2's table: `"You have been blocked — update your document"` | the §8 line, `You have been blocked — please update` | The scope disagrees with itself on the expiry-day push. The register is the table that names the codes, so the code follows §8 (the 26.09 audit accepted that reading); §4.2 is the fuller sentence and the one the worker would probably rather read. **Confirm which wording stands** — a one-line change in `templates.ts` either way, nothing else moves. |
| N8 | `"Re-upload, here is the reason"` | `Document rejected — {reason}. Re-upload.` | §8 describes the content rather than quoting it. Copy from `wireframes/staff/locks.html`. §2.3/§4.1 also require a Re-upload button on the screen the push opens. |
| N9 | `"Time to check in" / "Don't forget to check out"` | two halves under one code, `check-in` and `check-out` | One code, two sends, 30 min before the role's start and 30 min before its end. The register keeps the §8 line as `body` and exposes each half through `body('N9', …)`; the outbox key carries the half so the pair cannot collide on one booking. **Confirm:** whether THC wants these as one code or as N9/N9a in the outbox. |
| N6 | Timing "the day before (cutoff 12:00)" — no hour | queued from **08:00 UK the day before** until the 12:00 deadline, never after (`n6_due_at()`, 20260927140000) | §8 says when the deadline is, not when the reminder goes. 08:00 is the time the N6 push gallery shows (`wireframes/staff/invites.html`), and it leaves four hours to press "I'm ready". A booking accepted after 08:00 but before noon is reminded on the next minute; one accepted after noon gets nothing. **Confirm the hour.** |
| N7 | Timing "on the day of the shift" — no hour | queued from **09:00 UK on the day**, or two hours before the start if that is earlier (never before the UK day begins), until 30 minutes before the start (`n7_due_at()`, `n7_closes_at()`) — but never less than 30 minutes, and never past the start, so a 00:01–00:59 start is still reached; 00:00 exactly gets none (ADR-0034) | 09:00 is the N7 gallery's time (`wireframes/staff/shifts.html`). A fixed 09:00 would reach a 07:00 breakfast shift two hours after it started, hence the earlier bound; the reminder stops where N9 "Time to check in" starts. **Confirm both numbers.** |
| N11 | `"Shift time changed — now […]"` | `Shift time changed — now {window}` | §8 leaves the substituted text as an ellipsis. The Invites wireframe renders it much fuller — new window, the old window in brackets, event, role and "Tap to confirm the new time." **Confirm** which of the two is the copy; the register uses the §8 line with a single `{window}` placeholder rather than inventing the longer one. |
| N14 | `[20 / 48]` and `[term time / university holiday]` | `{limit}` and `{band}` | The scope's brackets are a choice of two values, not free text. §4.5 adds a third band the table does not list — a verified completion letter ("graduated, completion letter verified [date]" in the Documents wireframe). **Confirm** the completion-letter wording. |
| All | no push titles at all | short worker-facing `title` per push | §8 has a Trigger column, not a title, and its galleries render a push as the app name plus the body — so a push title exists in the product but nowhere in the scope. The titles here are ours and worker-safe; the §8 Trigger text stays in `trigger`, because some of it is office language ("manager presses Withdraw", N10b) or client commercial detail ("unpaid-break clients only", N13) that must never reach a worker. A test asserts neither phrase can appear in a title or body. **Confirm the titles**, or say a push should carry only "The Hospitality Company" as its title, as the galleries show. |
| All | — | `deepLink` | §8 records no landing screen. The links follow the routes in `docs/08-screen-inventory.md` and the text of each push ("Tap to view your shift details" → the shift, "Keep an eye on Radar" → `/radar`). Not scope copy; change freely. |

## Email

| Code | What §8 gives | What the register uses | Why |
| --- | --- | --- | --- |
| E1 | Sender "Willo — interview invitation (email only)" | an entry with `sender: 'willo'` and no THC copy | Willo sends it; the copy lives in Willo. The entry exists so the register matches §8 code for code, and the `willo` sender marks it as one this system must never send. |
| E2, E3, E5, E6, E7 | no subject line | subjects derived from the trigger, E5–E7 in the `— {name}, Employee ID {employeeId}` shape §8 gives E8/E9 | §8 only specifies subjects for E8 and E9. **These five subjects need THC's wording.** |
| E3 | "activation + password + 'download the app'" | password link plus a download-the-app line (`{link}`, `{installLink}`) | §8 and §2.7 both describe the email rather than quote it. The body carries all three elements §8 names so nothing is silently dropped, but **E3 is the only mandatory system email and has no copy anywhere in the scope** — the wording here is a placeholder and needs THC's before activation can ship. |
| E4 | "the Health & Safety Assessment — Unsuccessful wording in §10.1" | §10.1 verbatim, split as subject + body | §10.1 says the in-app terminal screen carries the email's wording "plus the same contact line". It is not clear whether the contact line (`Need help? Please contact us at: admin@thehospitalitycompany.co.uk`) belongs to the email too; the register leaves it out. **Confirm.** |
| E5, E6, E7 | recipients, no body | a factual body naming the worker, Employee ID and what changed | §8 names the recipients and the trigger but no wording. The bodies here are a minimum; they invent no fact the scope does not state. |
| E10 | not in §8 — §9.12: "an immediate email to admin@thehospitalitycompany.co.uk, flagging which event/role/shift lost a confirmed worker" | extension E10: sender `admin`, recipient admin@, subject `Confirmed worker self-cancelled — {event} · {role} · {date}`, body naming event, client, venue, role, the section's UK window, the worker, and the fill after the cancel as `{confirmed} of {headcount} (+{buffer})` with whether auto-assign is on | §9.12 asks for event/role/shift; the fill and the auto-assign switch are what tell the office whether it needs to act "if auto-assign doesn't backfill it in time". Queued inside `self_cancel_booking()` (20260927140200), keyed `E10:booking:<id>`. Not marked `mandatory`: that flag is §8's Phase column, and §8 does not list it — though §9.12's "triggers" leaves no opt-out. **Confirm the wording, and the number.** |
| E8, E9 | subject verbatim, body as a list of fields | the fields in the §8/§10.6/§10.7 order, one per line | The scope lists what the body carries but not its layout. E9 deliberately carries no declaration text (§10.7) — the test asserts that. |
| E5, E6, E7, E8, E9 | literal addresses | hard-coded in `recipients` | §9.12 makes the two *sender* addresses environment settings; it says nothing about recipients, so these are taken from §8 as written. **Confirm** whether `gisela@` and `thc_payroll@` should be settings too — they are individuals' and a third party's addresses, which tend to change without a release being welcome. |

## Where §8 contradicts itself

- **"Mandatory".** §8's opening paragraph says "The only mandatory system email
  is E3", but the EMAIL table's Phase column marks E2 and E4–E9 mandatory as
  well. The register follows the table — it is the more specific statement, and
  §10.6/§10.7 independently call E8 and E9 immediate and not batched — and a
  test pins that reading. **Confirm**, because if the opening line is the
  intended one, seven emails become optional.
- **N9's Content cell** carries its own timing ("each half is skipped if the
  worker has already signed in / signed out respectively") while the Timing
  column says only "−30 min". The register keeps `timing` to the column and
  holds the full cell in `scopeCopy`.

## Missing from §8 altogether

- **Worker self-cancels a confirmed booking (RULE-04, §3.6).** §9.12 says this
  "triggers an immediate email to admin@thehospitalitycompany.co.uk, flagging
  which event/role/shift lost a confirmed worker". §8 gives it no code. It was
  left out of the register for that reason, which meant the office was never
  told (docs/15 §3); it is now the extension **E10** — the next free E-number,
  as this note had pencilled in — sent from `admin` to admin@, queued by
  `self_cancel_booking()` in the same transaction as the cancel
  (20260927140200). It sits in `EXTENSION_CODES`, not `SCOPE_CODES`, so the
  test holding the register to §8 is unchanged. **Confirm with THC** that E10
  is the number they want, so a later §8 revision does not reuse it.
- **Client-facing notifications.** §11 gives the Client Portal no sends of its
  own, and §8 lists none. Noted only so the absence is deliberate.
- **N-code gaps.** §8's push table has no N-code between N10c and N11 other
  than what is listed, and no E-sub-codes. The numbering jumps (N13 and N14
  appear out of order in the table, N15 before N14) are presentation only —
  all fifteen are present.

## University Completion Letter requirement (CL1–CL6)

`docs/scope/university-completion-letter-requirement.pdf` §5 is a later THC
document than scope v1.6, and it names six sends without quoting any of them.
They are registered under their own `CL` prefix so they can never collide with
an N- or E-code THC assigns to §8 later (E10 is now the self-cancel email above).

| Code | Requirement §5 | What the register uses | Why |
| --- | --- | --- | --- |
| CL1 | Worker: upload received | push, "…your weekly hours stay the same until the office has checked it" | Acceptance criterion 2: the upload changes nothing, and the worker should not read "received" as "approved". |
| CL2 | Worker: approved (with new cap and effective date) | push, three variants: `dated`, `uncapped`, `visa_first` | Like N14, one sentence with optional clauses would send a placeholder to someone. `visa_first` is §7: the right to work ends before the release would start, so the worker is told their hours do not change. |
| — | Worker: rejected (with reason) | **N8** | The §8 push for any rejected document already carries the reason and the Re-upload button (§7 "reject flow with re-upload"). A second code would be two pushes for one event. |
| CL3 | Admin: new document awaiting review | email to admin@ | |
| CL4 | Admin: visa expiry approaching (e.g. 60/30/14 days) | email to admin@, one per rung per expiry date | Sent for every live worker with a right-to-work expiry, not only students — the cautious reading. |
| CL5 | Admin: opt-out signed | email to admin@ | Says in terms that it does not lift a Student visa term-time limit. |
| CL6 | Admin: opt-out cancelled | email to admin@, with the weeks already booked over the returning 48 | So the email is something the office can act on. |

**Confirm with THC:** all six are our wording; none is marked mandatory, since
the requirement does not say.
