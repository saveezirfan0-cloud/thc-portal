# ADR-0094 · The office can reject a profile selfie

**Status:** Proposed — awaiting THC · **Refines:** §10.1, §10.3 (3/11), §2.7 · **Builds on:** ADR-0045

## Context
§10.1 sets the avatar once and locks it ("changing it afterwards also goes through the office"), and §10.3 prints it on the timesheet. The office could look at the selfie and, through the worker's own *Request a change* (ADR-0045), decide a **new** photo. It could not take down one that was not appropriate: the face stayed on the Back Office, the client line-up (§11.1) and the sheets until the worker thought to ask. A candidate still in the wizard had no route at all (`request_profile_change` refuses them).

## Decision
1. **Reject** on the "Profile selfie" row of `/onboarding/:id` and of `/staff/:id` → Documents, beside the photo's Set pill. A reason is required (≤ 300 characters), shown to the worker word for word.
2. **`office_reject_selfie(p_staff, p_reason)`** (admin only, through the manager's session so `auth.uid()` is the actor):
   - `staff.photo_path → null`. The §10.1 lock *is* "photo_path is not null", so clearing it hands the worker a fresh capture and `staff_set_photo()` is unchanged; the avatar falls back to initials everywhere (§2.7).
   - `onboarding_progress.selfie_at → null`. The wizard decides "3/11 done" from this stamp, not from the photo; without clearing it a candidate would be shown the step as finished with no photo. A candidate in Documents is put back on step 3 (the chaser OC3 already names it); everything else in their progress is untouched.
   - Queues **RC5** (push, to the worker): *Profile photo not accepted — Your profile photo was not accepted: {reason}. Please take a new one.* → `/profile/details`. Key `RC5:selfie:<staff id>:<moment>`, so a retake rejected again is told again. Its own code: it is not a decision on a request (RC3's *Change not made*, `RC3:request:<id>`).
   - Audits `staff.selfie_rejected` with the manager as actor and **no reason** — the reason lives in the RC5 outbox row, which `remove_worker()` scrubs with everything else addressed to the worker.
3. **Who and when.** Any Back Office admin (as the other photo decisions of ADR-0045; a viewer is stopped by the read-only trigger). Refused for a worker who has left, been rejected or removed (`not_active`) and where there is no photo (`no_photo`).
4. **Where the worker retakes.** On wizard step 3 while in *Documents* (the unlocked `SelfieStep` already exists), and on Profile details once working (the unlocked `PhotoField` already exists). Both enforce nothing new: `staff_set_photo()` takes a new photo whenever `photo_path` is null.
5. **Nothing issued is rewritten** (§1.7). The object stays in the `photos` bucket — an already-issued allocation sheet printed it — and is purged with the worker's prefix on GDPR removal, as every old photo is.

## Consequences
- No schema change: one function, one register code (RC5, `ADDITION_CODES`; switchable in /settings → Notifications), no new column.
- A pending photo change request is left alone; approving it later is an office decision like any other.
- **Known limit.** A candidate between *Documents* verified and *Contract* signed (quiz → contract) has no screen to retake on: the wizard no longer asks for step 3 once the documents are past, and Profile details opens only when they are working. Rejecting then takes the photo down and tells them (RC5); the new photo is asked for when they reach Profile details. Re-opening step 3 across the later stages would change the wizard's step ordering and is not done here.
- **THC to confirm:** the RC5 wording (docs/15 Q21); whether the office should also be able to *replace* a photo without a request.
- pgTAP 776; `templates.test.ts` / `switches.test.ts` hold RC5 to the register; office tests for the action, the button and both rows.
