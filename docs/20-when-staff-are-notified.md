# 20 · When staff are notified (for the office)

**Who this is for:** the office team. It answers one question: *at what point does a
worker get a notification in the Staff App?*

**Where it comes from:** Scope of Work v1.6 §8 (the notification register) and §7
(background rules), checked against the code in `packages/notifications/src/templates.ts`
and the scheduled jobs in `supabase/`. Where the code goes beyond §8, the row says so.

All times are **UK time**. All the notifications below are **push notifications** to the
worker's phone. They arrive even when the app is closed, as long as the worker has
turned notifications on (Staff App → *Turn on notifications*).

---

## 1. The short version

A worker is notified when:

1. **They are invited to a shift** (N5).
2. **They need to confirm** the shift: the day before by 12:00, then on the day (N6, N7).
3. **They have been removed** from a shift, because they missed the 12:00 deadline,
   the office withdrew them, the event was cancelled, or the role filled up
   (N6b, N10b, N10d, N12, N10c).
4. **The shift changes** — time, venue or dress code (N11, N11b).
5. **It is shift day** and they should check in, check out or take a break
   (N9, N9b, N13).
6. **A document needs attention**: expiring, expired, rejected or the block lifted
   (N1–N4, N8, N15), or their weekly hours limit changed (N14).
7. **They applied on Radar** and the outcome is known (N10, N10c).
8. **The office sends a message** to the line-up from the event board (OM1).

Workers are **not** notified about pay, or about an old invitation that expires by
itself (see §6).

---

## 2. Following one shift, from invite to check-out

| When | What the worker gets | Code |
| --- | --- | --- |
| **Auto-assign invites them**: the hourly round runs at **17 minutes past each hour**, from the moment the event is built until the shift starts. A manual invite from the office goes **immediately**. | "New shift invitation" — *role · event · date/time · rate/h* | N5 |
| Worker accepts. | Nothing. They are now Confirmed. | — |
| **Day before, from 08:00** — only if they are Confirmed and have not yet pressed "I'm ready". | "Confirm tomorrow's shift by 12:00 today — or you'll be removed from it" | N6 |
| **Day before, 12:00** is the deadline. | — | — |
| **Day before, 12:05** — the automatic cutoff removes anyone who has not pressed "I'm ready". | "You have been removed from your shift tomorrow as we have not received your re-confirmation by the 12:00 deadline" | N6b |
| **Day of the shift, from 09:00** (or two hours before the start, if that is earlier) up to 30 minutes before the start — only if they have not confirmed today. | "Confirm today's shift". This is a reminder only. Missing it never removes anyone. | N7 |
| **30 minutes before the start** — skipped if they have already checked in. | "Time to check in" | N9 |
| **30 minutes after the start** — not a notification. A worker who has not checked in is marked **No-show** automatically and the check-in button locks. | — | — |
| **6 hours after check-in** — only on shifts where the client does not pay for breaks, and only if no break has been started. Sent once. | "You've been on shift 6 hours — please ask your manager on site about taking your break." | N13 |
| **30 minutes before the end** — skipped if they have already checked out. | "Don't forget to check out" | N9 |
| **30 minutes after the end** — skipped if they have already checked out. Sent once. | "You haven't checked out of [event] yet — tap to check out." | N9b |
| **4 hours after the end** — not a notification. The check-out button locks and a "No check-out" violation goes to the office. | — | — |

### Times are per role, not per event

Every shift-day timing above is worked out from **that role's own start and end time**,
not the event's. If an event has an early Chef section and a late Waiting Staff section,
each worker is reminded relative to their own section.

### Booked late? Reminders adjust

- **N6 (day before):** a booking made between 08:00 and 12:00 the day before is reminded
  within a minute of being made. A booking made **after 12:00** the day before gets no N6,
  because there is no deadline left to remind them of.
- **N7 (on the day):** very early shifts are reminded earlier than 09:00, so a 07:00
  start is not reminded after it has begun.

---

## 3. When the shift changes or the worker is removed

These go out **immediately**, at the moment the office makes the change.

| Trigger | What the worker gets | Code |
| --- | --- | --- |
| Office changes the event's **start or end time** (either one). Worker must re-confirm. | "Shift time changed — now [new time]" | N11 |
| Office changes the **venue address or dress code** (time unchanged). Worker must re-confirm. | "Shift details changed — [what changed]. Please confirm in the app." | N11b |
| Office presses **Withdraw** on a **confirmed** worker. | "You've been removed from [event] · [date/time]" | N10b |
| Office presses **Withdraw** on an **open invitation**. | "Your invitation to [event] · [date/time] has been withdrawn." | N10d |
| **Event cancelled** (client cancels). Reaches every Confirmed and Invited worker **and** anyone with a pending Radar application. | "This event has been cancelled" | N12 |
| Office (or auto-assign) **picks a Radar applicant** — the booking becomes Confirmed. | "You're booked! Your application for [event] on [date] has been accepted. Tap to view your shift details." | N10 |
| The role **fills** while a worker's Radar application is still pending (office picked someone else, or auto-assign filled it). | "Shift update: the [event] shift on [date] has now been filled. Keep an eye on Radar — new shifts are added regularly." | N10c |
| Office sends a **message to the line-up** from the event board (e.g. changed entrance, parking, what to bring). | The office's own words, headed *event · date* | OM1 |

---

## 4. Documents and compliance

| Trigger | When | What the worker gets | Code |
| --- | --- | --- | --- |
| Document **expiring** | **1 month** before expiry | "Update your [document] — it expires on [date]" | N1 |
| | **2 weeks** before | "Update your [document] — 2 weeks left" | N2 |
| | **1 week** before | "Final reminder: update your [document]" | N3 |
| Document **expired** | **On the expiry day**, with the automatic block. The worker is removed from future shifts and invitations are withdrawn. | "You have been blocked — please update" | N4 |
| Document **rejected** by the office | The moment the office rejects it | "Document rejected — [reason]. Re-upload." (with a **Re-upload** button) | N8 |
| **Conviction declaration reviewed and accepted**, worker unblocked | When the manager verifies it and the full compliance re-check passes | "Thanks for your patience — your shifts are open again. Tap to see what's available." | N15 |
| **Weekly hours limit changes** (term starts or ends, or a completion letter is verified) | **On the morning the change takes effect**, once per change | "Your weekly limit is now [20 / 48] hours — [term time / university holiday] until [date]." | N14 |

The daily compliance job runs at **05:00 UK**. The expiry reminders (N1–N3), the expiry-day
block and notice (N4) and the weekly-limit notice (N14) all go out from that run.

**University completion letter** (a later requirement, not in §8): a worker is also
notified when a letter is **uploaded** (their hours stay the same until the office checks
it) and when it is **approved** (their new limit and the date it starts). A **rejection**
uses the normal N8 push.

---

## 5. Candidates in onboarding (before they are staff)

Email is used before the worker has the app, and push once they do.

| Trigger | When | Channel |
| --- | --- | --- |
| Accepted after interview (E3) | On acceptance — the only mandatory system email | Email |
| Rejected after interview (E2) | On the rejection decision | Email |
| Health & Safety quiz failed three times (E4) | On the third failed attempt | Email |
| All documents verified and the quiz unlocks (E12) | The moment the quiz unlocks | Email |
| Document rejected (N8) | The moment it is rejected | Push |
| **Chasers** — interview not done (OC1), account not set up (OC2), onboarding step waiting (OC3) | **Daily**, starting a day after their last progress, **10:00–18:00 UK**, until they act. Any progress restarts the count. | Email (OC1, OC2), push (OC3) |

---

## 6. When a worker is **not** notified

- **A stale invitation or Radar application** disappears on its own once the event has
  ended. This is silent, by design (RULE-16).
- **Pay**: there is no pay or payroll notification in the register.
- **Reminders already satisfied**: no check-in reminder if already checked in, no
  check-out reminder if already checked out, no break reminder if a break was started.
- **Day-before reminder (N6)** if they were booked after 12:00 the day before.
- **Worker's own actions**: cancelling their own shift, declining an invite or applying on
  Radar does not push them (they just did it).
- **Notifications turned off on the phone**: nothing reaches them. Push is the main channel
  (§8), so a worker with notifications off will miss invites and reminders. Remind them to
  switch them on.

---

## 7. Proposed additions (awaiting THC's sign-off)

These are in the register but are **not in scope v1.6**, and their wording is still
being agreed (`packages/notifications/REGISTER-NOTES.md`, "Additions").

| Feature | Trigger | What the worker gets |
| --- | --- | --- |
| **Request a change** (name or photo) | Office approves or rejects | "Profile updated" / "Change not made — [reason]" |
| **Offer up a shift** (a worker hands a booked shift to others) | A shift is offered (other workers: **hourly rounds**, wave 1 first, never after expiry) | "Shift up for grabs — [role · event · time · rate/h]" |
| | A worker takes it | Taker: "You're booked!". Offerer: "Shift handed over" |
| | Nobody takes it before it lapses | Offerer: "You're still booked" |
| | Office declines the cover request | Offerer: "Cover request closed" |

---

## 8. Points still to be confirmed with THC

The scope fixes *that* these are sent but not always the exact hour. The system currently
uses these values; tell us if THC wants them changed:

1. **N6 starts at 08:00** the day before (scope only says "the day before").
2. **N7 starts at 09:00** on the day, earlier for early starts (scope only says "on the day").
3. **N4 wording**: §8 says "You have been blocked — please update"; §4.2 says
   "…update your document". The system uses the §8 line.
4. **N9 as one code or two** (check-in half and check-out half).
5. **Push titles**: the scope gives only the message body, so the titles
   ("Document expiring", "Confirm tomorrow's shift", …) are ours.

## 9. A note on go-live

Nothing is sent until the owner has finished the deployment steps in
`docs/16-owner-guide.md` §4 (push keys, the job functions deployed, the schedules
installed). After that, every send goes through the notification outbox once, with a
unique key, so a job re-running can never send a worker the same notification twice.

## Quick reference: every worker push by code

| Code | Moment |
| --- | --- |
| N1 / N2 / N3 | 1 month / 2 weeks / 1 week before a document expires |
| N4 | Document expiry day (and the block) |
| N5 | Invited to a shift |
| N6 | Day before, from 08:00, until the 12:00 deadline |
| N6b | Day before, 12:05, removed for not confirming |
| N7 | Shift day, from 09:00, until 30 min before start |
| N8 | Document rejected |
| N9 | 30 min before start (check in) and 30 min before end (check out) |
| N9b | 30 min after the scheduled end, still not checked out |
| N10 | Radar application accepted |
| N10b | Withdrawn from a confirmed shift |
| N10c | Radar application: role filled by someone else |
| N10d | Open invitation withdrawn |
| N11 / N11b | Shift time changed / venue or dress code changed |
| N12 | Event cancelled |
| N13 | 6 hours on shift with no break (unpaid-break clients) |
| N14 | Weekly hours limit changes band (05:00 job, morning of the change) |
| N15 | Unblocked after a conviction declaration is accepted |
| OM1 | Office message to the line-up |
