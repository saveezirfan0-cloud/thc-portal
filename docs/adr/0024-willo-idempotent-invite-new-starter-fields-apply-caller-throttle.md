# ADR-0024 · Willo invite idempotency, the New Starter report's gender/postcode/country, and /apply per caller

Status: accepted · 26.09.2026 · closes four docs/14 §4 items from the 24.09 wave and before

## Context

- **Willo duplicate invite.** The `willo-invite` sweep POSTed a candidate to
  Willo (Willo creates them and sends E1) and only then recorded the key with
  `willo_link_candidate`. If that call was lost, nothing said the candidate
  existed in Willo; the next sweep created them again and a second E1 went out.
- **New Starter report.** §9.9 Tab 3's columns, confirmed by THC 28.07.2026,
  are Staff · Employee ID · NI · Home address · **Postcode** · **Country** ·
  DOB · **Gender (M/F)** · First shift · Statement · Student Loan.
  `20260923130000` added the three columns; nothing filled them.
- **/apply consent tick** was hand-built because the shared `Checkbox` was
  not keyboard-operable (D1). #48 fixed that.
- **/apply per caller.** Limits were per email and per mobile only.

## Decision

1. **Willo: record, then link, in one call; ask before re-creating**
   (`20260926100000`, `packages/db/src/willo.ts`, pgTAP 520, vitest
   `willo-sweep.test.ts`).
   - `willo_invite_created(staff, key)` writes an `audit_log`
     `willo_invite_created` row (once per key per onboarding period) and links
     the key in a sub-block; a failed link keeps the record and answers
     `not_linked`. Service role only.
   - `willo_invite_due()` (dropped and recreated — its result type grew; same
     arguments, same grants, same backoff) also returns `known_candidate_id`
     (a key recorded this period that nobody holds → link it, never create)
     and `prior_candidate_ids` (keys from earlier periods).
   - A Reset nulls `willo_candidate_id`; a new trigger writes the dropped key
     as `willo_candidate_retired` (not on a GDPR removal) so it can be
     excluded.
   - The sweep (`runInviteSweep`, I/O injected) links a known key; on any
     attempt after the first asks Willo for a candidate whose `external_id` is
     our staff id (the create has always sent it) before creating; retries the
     record three times in-run.
   - **Assumed, not verified** (Appendix B, B1): `GET
     {WILLO_API_BASE}{WILLO_LOOKUP_PATH}`, default
     `/interviews/{interviewKey}/candidates/?external_id={externalId}`, same
     auth header; Willo echoes `external_id`. Only a returned candidate that
     carries our staff id — and is not an earlier period's key — is accepted,
     so an endpoint that ignores the filter matches nobody and the sweep
     creates as before. 404 = none; 401/403/405/501 = no such endpoint → create
     as before (logged); 5xx/408/429/network → **do not create**, retry after
     the backoff. `WILLO_LOOKUP_PATH=off` disables the lookup.
   - Residual: a create whose record is lost, on a Willo without an
     external-id lookup, can still duplicate. Willo's docs settle it.

2. **Gender on step 7; postcode and country follow the address**
   (`20260926100100`, pgTAP 521).
   - The scope asks for gender, so it is collected — on the HMRC step, whose
     data the report exports (§2.8). HMRC's RTI record takes M or F only; the
     form offers exactly those two with a note saying why and what it is used
     for (`HMRC_GENDER_NOTE` in `packages/domain/src/hmrc.ts`).
   - A new **8-argument overload** of `submit_hmrc_checklist` (`p_gender`)
     validates it, calls the untouched 7-argument function and writes
     `staff.gender` in the same transaction. The 7-argument function keeps its
     name, arguments and grants (existing callers and pgTAP 392 unaffected);
     the Staff App calls the new one.
   - **Deviation from the wireframe:** `wireframes/staff/onboarding-2.html`
     has no gender block. It predates THC confirming the report columns; the
     block sits before the NI number.
   - Postcode and country: a trigger re-derives both from `home_address` on
     every change (wizard step 2, Profile edits), so the report never carries a
     postcode the worker has left. Country is "United Kingdom" exactly when a
     UK postcode ends the address (the wizard accepts nothing else), otherwise
     blank. Existing rows backfilled. Not attempted: the UK nation
     (England/Scotland/Wales/NI), which Scottish/Welsh tax codes would want.

3. **/apply consent tick → shared `Checkbox`.** Same submitted value (`on`),
   same classes; the coral square of the validation state is drawn by
   `apply.css` from the error the component renders (`:has(.error)`).

4. **/apply per caller** (`20260926100200`, pgTAP 522, vitest `caller.test.ts`).
   - The server action derives the caller from `x-forwarded-for` (first hop)
     else `x-real-ip`, buckets IPv6 by /64, and sends only
     `HMAC-SHA256(APPLY_THROTTLE_SALT, bucket)`. Without the salt a constant
     is used and a warning logged once.
   - `submit_application_as_caller(…, p_caller_hash)` — service role only, so
     the hash cannot be chosen by the caller — refuses anything but 64 hex
     (no raw IP can be stored, §1.7), enforces `settings.apply_caller_throttle`
     (`per_hour` 5, `per_day` 20), then calls `submit_application` unchanged
     and counts only accepted applications. Hashes live in
     `private.apply_caller_hits` (not `public`: no API role has schema usage
     or table grants; RLS on, no policy) and are purged past
     `retention_hours` (48) by every call.
   - A new function rather than a `submit_application` overload: 120 holds
     that exactly one `submit_application` exists and 190 that it is one of
     three definer functions anon can reach.
   - Without `SUPABASE_SERVICE_ROLE_KEY` the form falls back to the anon
     `submit_application` (per-email/mobile only) and logs it once.
   - Residual: anon can still call `submit_application` directly through
     PostgREST. Closing it = revoking anon once every deployment carries the
     service key, with 120/190 updated in the same PR.

## Configuration

- Staff App (Vercel): `APPLY_THROTTLE_SALT` — any long random string, per
  environment. `SUPABASE_SERVICE_ROLE_KEY` must be set for the per-caller limit
  to apply (it already is for uploads and `/activate`).
- `willo-webhook` (Supabase secrets): optional `WILLO_LOOKUP_PATH` (default
  above; `off` to disable).
