# §8 register — what the scope leaves open

The register in `src/templates.ts` is complete against §8: every push (N1–N15,
including N6b, N9b, N10b, N10c) and every email (E1–E9) has one entry, and the
test holds the set of codes to the two §8 tables.

Where §8 states a trigger in prose rather than the string that goes out, the
copy is taken from the screen carrying the same wording — `wireframes/staff/
locks.html` for the push register (its own note says "Copy above is verbatim
from §8"), §10.1 for E4, §10.6 and §10.7 for E8/E9. Everything that involved a
judgement call is listed below, for THC to confirm before anything sends.

## Push

| Code | What §8 gives | What the register uses | Why |
| --- | --- | --- | --- |
| N1 | `"update your [doc]"` | `Update your {document} — it expires on {date}` | §8's phrasing is a summary, not a sendable string. The wireframe register and the Documents push gallery both carry the expiry date, and N1 is a month out — without the date the worker cannot tell which deadline is meant. |
| N8 | `"Re-upload, here is the reason"` | `Document rejected — {reason}. Re-upload.` | §8 describes the content rather than quoting it. Copy from `wireframes/staff/locks.html`. §2.3/§4.1 also require a Re-upload button on the screen the push opens. |
| N9 | `"Time to check in" / "Don't forget to check out"` | two halves under one code, `check-in` and `check-out` | One code, two sends, 30 min before the role's start and 30 min before its end. The register keeps the §8 line as `body` and exposes each half through `body('N9', …)`; the outbox key carries the half so the pair cannot collide on one booking. **Confirm:** whether THC wants these as one code or as N9/N9a in the outbox. |
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
  which event/role/shift lost a confirmed worker". §8 gives it no code, so the
  register has no entry for it — adding one would invent a code. It needs an
  E-code from THC (E10, on the current numbering).
- **Client-facing notifications.** §11 gives the Client Portal no sends of its
  own, and §8 lists none. Noted only so the absence is deliberate.
- **N-code gaps.** §8's push table has no N-code between N10c and N11 other
  than what is listed, and no E-sub-codes. The numbering jumps (N13 and N14
  appear out of order in the table, N15 before N14) are presentation only —
  all fifteen are present.
