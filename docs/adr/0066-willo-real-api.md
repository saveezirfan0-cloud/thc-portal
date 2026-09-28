# ADR-0066 · Willo's real API: the token in the webhook address, `/participants/`, the bare key

Status: accepted · 28.09.2026 · **Amends** ADR-0021 §1 (what was assumed about Willo) and ADR-0024 (the lookup path)

Scope v1.6 §2.4, Appendix B (B1) · `packages/db/src/willo.ts` · `supabase/functions/willo-webhook/index.ts`

## Context

ADR-0021 built the Willo integration without THC's account, on assumptions kept as
configuration. On 28.09 THC's account was read through the API (`GET /webhooks/` with
THC's key), and Willo's Integration API V2 reference (Postman, and the third-party
profile at github.com/api-evangelist/willo that follows it) was checked. Three
assumptions were wrong:

| Assumed (ADR-0021) | Willo |
| --- | --- |
| Deliveries are HMAC-signed with a secret Willo issues | **No signing.** A webhook is `url`, `event`, `interviews`, `follow_all_interviews`, `departments`, `users`, `payload_configuration`, `api_version`, `status` — no secret, and the Developer tools screen has no Add button: webhooks are created by API only |
| `POST /interviews/{interviewKey}/candidates/`, `phone_number` | `POST /participants/` ("Invite Participant") with the interview key **in the body** as `interview`, and `phone` |
| `Authorization: Bearer <key>` | `Authorization: <API Key>`, the bare key |

A path or prefix setting could not express the second (the key moves into the body) and
an empty secret is awkward to set in the dashboard for the third, so both became code.

## Decisions

1. **The webhook secret travels in the address we register:**
   `{SUPABASE_URL}/functions/v1/willo-webhook?token=<WILLO_WEBHOOK_SECRET>`. The secret is
   ours — generated with `openssl rand -hex 32`, set as a Supabase secret, and put in the
   `url` of the webhook we create in Willo. `verifyWilloSignature` compares the SHA-256
   of the token with the SHA-256 of the secret in constant time. A missing secret still
   refuses every delivery (503). If a signature header is present it is what is checked,
   so a good token never rescues a bad signature; the signed path stays for a Willo that
   starts signing.
2. **Create candidate** is `POST /participants/` with `interview, name, first_name, last_name,
   email, phone, external_id, send_invite`. `name` (the full name) is **required**: the
   first live call on 28.09 was refused `400 {"name":["This field is required."]}`. Willo is a Django REST API and ignores fields it
   does not know, so `external_id` and `send_invite` are harmless if unused.
   `WILLO_INVITE_PATH` still overrides the path, and `{interviewKey}` is still replaced in it.
3. **The key goes bare.** `WILLO_API_AUTH_PREFIX` names a scheme (`Bearer`, `Token`) and
   gets its space; `none` or empty is the bare key.
4. **Lookup** (ADR-0024) defaults to `/participants/?interview={interviewKey}&external_id={externalId}`.
   Whether Willo filters on `external_id` is unverified; the reader only accepts a
   participant that carries our staff id, so an unfiltered list matches nobody and the
   sweep creates as before.
5. **Register our webhook for our interview only** — `follow_all_interviews: false`,
   `interviews: [WILLO_INTERVIEW_KEY]`, one webhook per event (`stage_change`,
   `new_response`). THC has thousands of Willo assessments; following all of them would
   write a `willo_event_refused` audit row for every stranger.
6. **THC's two existing webhooks stay.** Both are Sam's, follow all interviews on
   `stage_change`, and feed other systems (`hospitality.axlr8.uk` — Accelerate, THC's
   current system — and `the-hospitality-company.4-com.pro`). Ours is added beside them;
   removing theirs is THC's call once Accelerate is retired.

7. **The event is named in the address; the participant is found by its key's form**
   (28.09, after the first real deliveries). THC's `new_response` deliveries carried
   no event name under any path `parseWilloEvent` reads (`no_event_type`, 400). Each
   webhook sends one event, so each address now names it:
   `…/willo-webhook?token=<secret>&event=new_response` and `…&event=stage_change`;
   a body that does name its event still wins. The participant's key is taken from a
   named path if present, else from any 32-hex string in the body, and the receiver
   asks `willo_event_plan` which one is ours (the interview's key, also 32 hex, is
   skipped). A stage is read from any `stage`-like key before a bare `status`. Every
   delivery's shape (paths and types; values only for event/stage keys, never a
   name, email or answer) is logged as `[willo-webhook] delivery`, so the payload
   can be pinned down from the function log without logging personal data.

## Consequences

- The token appears in the request URL, so Supabase's edge request log (visible to
  project admins only) can show it. Rotating is: new secret → `PATCH /webhooks/{key}/`
  with the new `url` → done; deliveries in between are refused and Willo retries.
- Still unverified until the first real delivery: the stage-change payload shape
  (`parseWilloEvent` is a tolerant reader) and where the new participant's key comes back
  (`readInviteAnswer` reads `key` first). THC's webhooks report `api_version: "v1"`.
- `OWNER-TODO.md` §4 and `docs/12` carry the commands.
