# ADR-0021 · The Willo receiver, the "create candidate" call, and Resend activation link

**Status:** Accepted (migration `20260924110000`, pgTAP 482–481, vitest `packages/db/src/__tests__/willo.test.ts`) · **Builds on:** ADR-0006 (Edge Functions import workspace code), ADR-0013, the activation account (`20260923180000`) · **Scope:** §2.1, §2.4, §2.7, §2.8 E1/E3, §2.12, Appendix B (B1)

## Context

`willo_link_candidate` and `willo_record_event` existed, driven by `settings.willo_stage_map`, but nothing called them: no webhook receiver, no "create candidate in Willo" on submit, and the Willo Accept route could not provision the login the office Accept does since `20260923180000`. Separately, an expired E3 link (a day, `otp_expiry`) left the candidate writing to admin@, because nothing in the office could issue a new one.

THC's Willo account and API documentation (Appendix B, B1) were **not available** when this was built.

## Decisions

### 1. What is assumed about Willo — every assumption is configuration

Willo's webhook signing scheme, payload shape and candidate-creation endpoint are not known here. Nothing below is a claim about Willo's actual API; each is a default that a secret or `/settings` changes without a release.

| Concern | Built as | Change it with |
| --- | --- | --- |
| Signature | HMAC-SHA256 of the **raw body** with `WILLO_WEBHOOK_SECRET`; hex or base64; optional `sha256=`/`v1=` label; several comma-separated digests allowed (rotation); constant-time compare of 32-byte digests | `WILLO_SIGNATURE_HEADER` (default `x-willo-signature`) |
| Replay window | Only if Willo sends a timestamp: the header is then required, must be within the tolerance, and the signed message becomes `{timestamp}.{raw body}` | `WILLO_TIMESTAMP_HEADER`, `WILLO_TIMESTAMP_TOLERANCE_SECONDS` (300) |
| Payload | Tolerant reader: the event type, candidate key, stage and time from the usual places (`event`/`type`, `data.candidate.key`/`candidate_key`/…, `data.stage.name`/`stage`, `created_at`/`timestamp`). A stage change becomes the **stage name** (`Accepted` → `accepted`), anything else its **own name** (`New Response` → `new_response`) | `settings.willo_stage_map` on `/settings` (§2.4: "editable … does not need a release") |
| Create candidate | `POST {WILLO_API_BASE}{WILLO_INVITE_PATH}` with `first_name, last_name, email, phone_number, external_id (our staff id), send_invite: true`; the candidate key read from `key`/`id`/`candidate.key`/`data.…` | `WILLO_API_BASE`, `WILLO_INVITE_PATH` (`/interviews/{interviewKey}/candidates/`), `WILLO_API_AUTH_HEADER` (`Authorization`), `WILLO_API_AUTH_PREFIX` (`Bearer `) |

**To do when THC's account arrives:** read Willo's webhook docs and set the header names, or change `verifyWilloSignature` if the scheme differs (e.g. a different HMAC input); send one sandbox delivery of each kind and check `parseWilloEvent` finds the candidate key and stage, adding a path if not; check the create endpoint, body fields and where the key comes back; set `settings.willo_stage_map` to Willo's actual stage names; set `settings.willo_review_url_template`.

With no timestamp, replay protection rests on idempotency: every path through `willo_record_event` is a no-op on a repeat (pgTAP 380, 482), and a repeated Accept mints no token (below).

### 2. The receiver provisions the login with the office's code, not a copy

`provisionStaffLogin` moved from `apps/office` to `packages/db/src/provision.ts` (imports carry `.ts`, no `process.env`, per ADR-0006), with `issueActivationLink` on top. The office Accept, the office Resend and the Edge Function all call it. The office file re-exports it, so its tests are unchanged.

The order on a Willo Accept is the office's. `willo_event_plan()` says whether this event will move the card. Only then is the login provisioned and a token minted, and `willo_accept_with_account()` runs `link_staff_account` + `willo_record_event` (→ Documents, E3 with `/activate/{token}`) in **one transaction**.

**Minting replaces the token on a login**, so a mint that is not followed by an E3 kills the link already in the inbox. Two consequences:

- A retried Accept is not planned as `needsAccount` (the candidate is already in Documents), so it mints nothing.
- Where a mint does lose a race (two deliveries at once, two managers clicking Resend), `activation_link_refresh()` points every **unsent** E3 for that person at the newest link. An E3 already sent in that window cannot be fixed, and Resend is the remedy.

**Refusals.** A refusal no retry can change (unknown candidate, somebody else's login, a mapping to a missing target) is answered **200** and recorded with `willo_record_refusal()` (`audit_log`, `willo_event_refused`), so Willo stops retrying. Anything else is 5xx, and Willo retries. A missing `WILLO_WEBHOOK_SECRET` refuses **every** delivery (503), never accepts unsigned ones. A missing `STAFF_APP_URL` is 500, so Willo's retry lands once it is set.

### 3. "Create candidate in Willo" is a sweep, not a call inside the form

§2.4 (on submit) and §2.12 step 1 (on Reset) are the same condition: `interview_requested` with no `willo_candidate_id`. The reset guard already nulls it. So:

- `willo_invite_due()` leases due candidates. The lease is an `audit_log` row; the backoff is 5 min, doubling, capped at 6 h; claims count per onboarding period.
- The Edge Function (`POST /willo-webhook/invite`, service key) creates each candidate in Willo and records the key with `willo_link_candidate()`.
- A trigger on `staff` nudges that route through `pg_net` the moment a candidate becomes due, so E1 goes out on submit. The nudge is a no-op without `settings.edge_base_url` and the vault key, and can never fail the application.
- The `willo-invite` schedule (every minute) is the safety net. It is registered **disabled** (pgTAP 190 lists the enabled ones) until the keys exist.

Without `WILLO_API_KEY` / `WILLO_INTERVIEW_KEY` the route logs `no candidate created in Willo, no E1 sent`, leases nothing, and returns. Every waiting candidate is then picked up on the first run with keys.

The apply form is untouched. `submit_application()` deliberately returns nothing that tells a new applicant from a returning one (§2.12). A call from the form would need exactly that, and it would also miss Resets.

~~**Known edge:** if Willo creates the candidate and `willo_link_candidate` then fails transiently, the next lease creates them again (a second E1).~~ **Closed by `20260924170000`** (pgTAP 512). Creating a candidate is not undoable and is what sends E1, so the sweep no longer decides for itself what to do with a person:

- `willo_invite_created(staff, key, ref)` replaces `willo_link_candidate` in the sweep. It writes the key to `audit_log` **before** attempting the link, in one transaction, and **returns** its outcome (`linked`, `already_linked`, or a terminal `not_awaiting_interview` / `superseded` / `other_candidate_linked` / `candidate_taken` / `unknown_staff`) instead of raising — so a raised error now means only that the call did not get through, which the Edge Function retries with the key still in memory, and which `willo_invite_failed(…, p_willo_candidate_id => …)` records if the retries run out.
- `willo_invite_due()` reads that key back as `invite_mode = 'relink'` with `created_candidate_id`. A candidate carrying one is **re-linked, never re-created**.
- A failure now carries how much it knows: `no` (a 4xx — create again), `unknown` (5xx, 408/429, timeout — create again as `recover`, reusing the same `invite_ref` as an `Idempotency-Key`), `yes` with no key (a 2xx whose body we could not read — the candidate exists and E1 has gone, so they are **held** for this onboarding period rather than invited twice; the office's Reset, §2.12, is the way back).
- A key that can never be ours is audited `willo_invite_orphan` — a live Willo candidate belonging to nobody, to be removed there — and the orphan releases the candidate to create again, so a terminal outcome cannot wedge the sweep in a re-link loop.

The `Idempotency-Key` header is a **second line only**: §1 above says the API shape is assumed until THC's sandbox arrives, so nothing here depends on Willo de-duplicating anything. What remains, and cannot be closed from this side, is the window between the POST and any record of it: if the isolate dies there, the retry is still a create.

No new table: `001_rls_guard` inventories every table, and `audit_log` is where these rows would be looked for anyway.

### 4. Resend activation link

- **Office only**, on `/onboarding/:id` and on `/staff/:id` for anyone accepted who has not activated: status Documents, Quiz, Contract, Compliant or Blocked. "Activated" means the login has a password.
- **Refused** for anyone not yet accepted, rejected, inactive, removed or already activated. An activated person uses Forgot password.
- **Rate limit:** at most one resend per 10 minutes per person, read from `audit_log`.
- **Check before minting.** `onboarding_resend_activation_check()` runs **before** anything is minted, so a refused resend never kills a working link. `onboarding_resend_activation()` re-checks under a row lock, links the login if none is linked, and queues a **new** E3 with key `E3:resend:<staff>:<n>`. It is audited as `onboarding_resend_activation`, with the manager as actor.
- **Payload and template are unchanged:** `{link, installLink, name}`, E3. No change was needed in `packages/notifications`.

**Deviation from the wireframe.** `wireframes/backoffice/candidate.html` and `staff-profile.html` have no Resend button. It is added as an outline button beside Reject candidate on the candidate profile, and at the top of the actions on the staff profile, shown only in the state above.

### 5. `activated` now means activated

`onboarding_candidates_v.activated` was `user_id is not null`. Since Accept links the login before the candidate opens E3, every accepted candidate read "Activated (E3)". It is now `staff_account_activated()`, which checks for a linked login with a password, and answers only the office, the service role and the person themselves.

## Consequences / deploy

- `supabase functions deploy willo-webhook --no-verify-jwt`. Willo does not send a Supabase JWT; the function verifies Willo's signature itself, and the `/invite` route checks the service key.
- `supabase secrets set WILLO_WEBHOOK_SECRET=… WILLO_API_KEY=… WILLO_INTERVIEW_KEY=… STAFF_APP_URL=https://<staff app>`, plus the optional overrides above.
- Point Willo's webhook at `{SUPABASE_URL}/functions/v1/willo-webhook`.
- Once the keys are set: `update job_schedules set enabled = true where job = 'willo-invite'; select install_job_schedules();` and add `willo-invite` to pgTAP 190's list in the same commit.
