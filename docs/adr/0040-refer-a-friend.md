# ADR-0040 · Refer a friend: a referral code on /apply, recorded, no reward

Status: proposed — awaiting THC · 25.09.2026

Addition to Scope v1.6: §2.1 (`/apply?ref=`), §2.3 (referrer on the candidate), §9.6,
§10.1, §1.7 (privacy notice), §1.5. Plan: `docs/18-staff-features-plan.md` §5. THC: Q19,
Q20 (`docs/15-open-questions.md`).

## Context

Workers already bring friends to THC by word of mouth, and the office has no record of
who brought whom. The product owner approved a "Refer a friend" link in the Staff App.
There is no agreed reward, and a reward promised in the app would be a term of
engagement THC has not written. Telling a referrer that their friend was hired would
disclose one person's employment status to another.

## Decision

1. **A personal code, recorded on `/apply`, no reward.** A compliant worker gets a
   stable 8-character code (`^[A-HJ-NP-Z2-9]{8}$`, minted lazily, once). `/profile/refer`
   shows the link `{origin}/apply?ref={code}`, **Share** (Web Share API), **Copy**, a QR
   (the existing activation QR component) and "N people have applied with your link".
   **No reward copy** anywhere (Q19). The Profile hub gains a "Refer a friend" row.
2. **The referrer sees a count only**, never names or outcomes (Q20). RF1 ("Your friend
   {firstName} has joined The Hospitality Company.") is proposed, **not built**.
3. **The applicant never sees the referrer's name.** `/apply` carries the code in a
   hidden field; the response is identical with or without a code. The consent line and
   `/privacy` gain "If a friend referred you, we record who referred you." (THC legal
   text pending).
4. **A referral never blocks an application.** `submit_application_as_caller` is
   restated once with an 8th argument `p_referral_code text default null`; after the
   application is written it calls owner-only `record_application_referral`, which
   skips a bad, revoked or self code, inserts `on conflict do nothing` and never raises.
   The anon `submit_application` path is unchanged and records nothing; throttles are
   untouched.
5. **The office sees it.** `/onboarding/:id` shows "Referred by {name} ({employeeId})"
   linking to `/staff/:id`; the kanban card gets a "Referred" chip; `/staff/:id`
   Overview gets a "Referrals" card and a "Referred by" line. These are separate admin
   queries — `onboarding_candidates_v` is not restated.

### Data model (Phase 0)

`staff_referral_codes(staff_id pk → staff, code text unique, created_at, revoked_at)`;
`application_referrals(application_id pk → applications, referrer_staff_id → staff,
candidate_staff_id → staff, code, recorded_at, check referrer <> candidate)`. RLS: one
`admin_read` select policy on each; no staff or client policy. Worker RPCs
`my_referral_code()` (compliant only) and `my_referral_summary() → {code, applied}`.
Domain: `packages/domain/src/referral.ts` (`isReferralCode()`, `referralLink()`).

### Implementation notes (onboarding, `20260930140000_apply_referral.sql`)

- `record_application_referral` finds "the application just written" as the one for
  this email stamped in the current transaction (`created_at = now()`) that carries no
  referral yet — `submit_application()` returns void and is not changed, so it cannot
  hand back the id. It is revoked from `service_role` as well as public/anon/
  authenticated: only the definer that owns it can write a referral.
- The 7-argument `submit_application_as_caller` is dropped, so `522_apply_caller_throttle`
  names the 8-argument signature in its two grant assertions; its calls are unchanged.
- `/apply` sends `p_referral_code` only when there is a code, and resends without it on
  PostgREST's `PGRST202` (a database not yet on this migration) — a referral never costs
  an application. The consent sentence is shown to every applicant, referred or not.
- The kanban's "Referred" chip marks a candidate card by person and a returning-applicant
  card by that application; rejected cards carry it too.

## Consequences

- **What never changes.** No money: nothing reaches `packages/pdf`, reports or payroll.
  The client sees nothing (no client policy, no `client_*` view; ADR-0004/0026). The
  anon `/apply` path and its throttles behave exactly as before.
- GDPR removal revokes the removed worker's code; referral rows are kept and the
  referrer reads "Deleted account #id" (pgTAP 652).
- pgTAP 650, 652, 680 (code minted once and stable, compliant only, summary is a count),
  681 (valid code recorded for both `candidate_created` and `returning_applicant`; bad /
  revoked / self code records nothing and the application still succeeds; anon path
  records nothing; identical response with or without a code).
- **THC to confirm** (docs/15): Q19 — what reward, if any, earned by what; Q20 — may a
  referrer be told their friend joined (RF1), and the privacy wording.
