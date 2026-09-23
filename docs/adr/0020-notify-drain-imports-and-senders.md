# ADR-0020 · notify-drain: how it imports the §8 rules, and how it sends

**Status:** Accepted, 24.09.2026. Closes the one question ADR-0006 left open ("that
Supabase's bundler follows a relative import reaching outside `supabase/functions/`"),
as far as it can be closed without a Supabase project, and records the choices P2 made
that are not obvious from the code.

## 1 · The import: option 3 stands, now with evidence

ADR-0006 chose option 3 — `allowImportingTsExtensions`, `.ts` on every internal import
in `packages/notifications`, and Edge Functions importing the package **by relative
path** (`../../../packages/notifications/src/drain.ts`). What it could not show was that
a Deno bundler actually follows that path out of `supabase/functions/`.

That was checked for this ADR with Deno 2.9 (installed from npm into a scratch
directory — there is still no Deno in the workspace), against the repository as
committed:

| Check | Result |
| --- | --- |
| `deno check` on all six Edge Functions (`notify-drain`, `finance-reports`, `auto-staffing`, `booking-tick`, `compliance-daily`, `gdpr-purge`) | pass — and it caught one real type error in `notify-drain` (a `Uint8Array<ArrayBufferLike>` passed as a `fetch` body) that `tsc` in the package could not see |
| `deno bundle supabase/functions/notify-drain/index.ts` | one 826 KB file, 87 modules, the `packages/notifications` sources inlined |
| that bundle, run with `deno run` | boots, answers 401 to a call without the service key, and with it proceeds to `job_run_start` |
| `drainBatch()` + the RFC 8291 worked example, run under Deno | same results as under vitest |

The only substitution: `esm.sh` is blocked by this environment's egress policy, so the
check mapped `https://esm.sh/@supabase/supabase-js@2.45.4` to the same version on npm
through a scratch import map. The import map is not committed; the functions still
import from `esm.sh` as the other five do.

**What remains unproven** is Supabase's own bundler, not Deno's. `supabase functions
deploy` builds the same Deno module graph, so a relative import that stays inside the
repository should resolve as it does above — but whether the CLI exposes files outside
`supabase/functions/` to its bundler depends on the CLI version and bundling mode (Docker
or `--use-api`), and until `supabase functions deploy notify-drain` is run against a real
project this is an expectation, not an observation. `finance-reports` and `auto-staffing`
already depend on the same thing, so the first deploy of any of the three settles it for
all of them. **Run the deploy from the repository root.** If it fails
to resolve `../../../packages`, the fallback is still ADR-0006's option 4 (publish the
package, import with `npm:`), not a vendored copy: the package is a valid Deno module
either way, which the checks above now show directly.

## 2 · Web Push without a library

`npm:web-push` was the obvious choice and is not used. It is written against Node's
`crypto` (`createECDH`, `createCipheriv`) and `https`, which on Supabase's Edge Runtime
means Deno's Node-compatibility layer on a Deno version the platform pins. The protocol —
RFC 8291 encryption, RFC 8188 framing, an RFC 8292 VAPID JWT — is about 150 lines of
WebCrypto, which runs natively in Node, Deno and the Edge Runtime alike.

It lives in `packages/notifications/src/webpush.ts` and is held by
`__tests__/webpush.test.ts`: byte-for-byte against the RFC 8291 Appendix A worked
example, round-trip through an independent `node:crypto` decrypter, and the VAPID
signature verified with the public key. That is stronger evidence than a dependency would
have given, and there is no dependency to audit.

## 3 · Where the decisions live

`supabase/functions/notify-drain/index.ts` is wiring: claim, read `settings.senders`,
call `drainBatch()`, write the verdicts back. Every decision is in
`packages/notifications/src/drain.ts` and tested with the network mocked:

- **Rendering** — `messageFor()` for the §8 register, `documentMessageFor()` for
  BG08/D1/D2, which fetch their files from Storage and attach them.
- **Sender** — `resolveSender()` reads `settings.senders` on every run (so `/settings`
  applies from the next minute), lower-cases it, and falls back to the seeded
  `admin@`/`timesheets@` — with a log line — if the row is missing, malformed or a
  no-reply address (§9.12). `templates.ts` names a sender by role only; the address is
  never read from it. `Reply-To` is the sender, so replies reach a monitored mailbox.
- **Four verdicts per row**, each one SQL call:

  | Verdict | When | SQL |
  | --- | --- | --- |
  | sent | Resend 2xx; a push accepted by at least one of the worker's devices | `complete_outbox_send(id, true)` |
  | retry | network, 429, 5xx, Resend 401/403, a push no device accepted, a worker with no device yet | `complete_outbox_send(id, false, error)` — backoff 1/2/4/8/16 min, failed at attempt 6 |
  | failed | `UnsendableRow`, Resend 400/409/422, a document email whose file is gone | `fail_outbox_send(id, error)` — new, fails at once |
  | unconfigured | the channel's secrets are missing | `release_outbox_claim(id, error)` — new, un-counts the attempt, back in 5 min |

- **Push to every device** the worker has registered; the row is sent if any device
  accepted it (retrying would repeat it on the one that did). A 404/410 deletes that
  subscription (RFC 8030); any other failure keeps it. An endpoint is a bearer capability
  for a device, so it never appears in an error or a log.
- **Email idempotency** — the outbox key is Resend's `Idempotency-Key`. The lease stops two
  drains sending a row; this stops a send whose answer was lost (a timeout, a killed
  function) being sent twice by the retry.

## 4 · Why "not configured" does not spend attempts

The first deploy will almost certainly happen before THC's DNS is verified and the Resend
key exists (docs/14 O3). Had a missing key counted as a failure, every queued row —
including E3, the only way a new worker gets into the app — would be exhausted and failed
within 31 minutes of the first run, and would need re-queueing by hand when the key
arrived. Instead the claim is handed back, the reason is written on the row where the
office queue can show it, the run logs one line naming the missing secrets, and the row
is looked at again every five minutes with all six attempts intact. The two channels are
independent: push sends while email is held, and vice versa.

A row that can never be sent is still failed while held — it is rendered before the key
check, so an E1 or an unknown code does not sit in the queue looking merely "waiting".

## 5 · Schedules

`notify-drain` is enabled every minute, and `finance-reports` is re-enabled in the same
migration (`20260924100000`), as `20260923193100` required. `190_job_function_grants`
asserts the new enabled list. Deploy order is unchanged: functions, then
`install_job_schedules()`.

## Consequences

- Sending is now real the moment the secrets are set; there is no further code step.
- A new Edge Function that needs workspace code imports it by relative path with `.ts`, and
  should be `deno check`ed the way section 1 describes — `tsc` in the package is not the
  same compiler and missed a real error here.
- `D1`/`D2`/`BG08` bodies still sign off with the literal `timesheets@`/`admin@` address in
  their text (`documents.ts`). If `/settings` changes a sender, the From line follows and
  the signature line does not; making the signature a placeholder is a copy change for
  the documents owner.
