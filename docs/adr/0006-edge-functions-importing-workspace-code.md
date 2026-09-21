# ADR-0006 · How an Edge Function imports workspace code

**Status:** Open, 21.09.2026. Blocks the `notify-drain` Edge Function (§8, P2 in
`docs/13-remaining-work.md`). Refines the unresolved aside in
`.claude/skills/supabase-workflow` — "domain maths is imported from `packages/domain`
(build step copies or use an import map)" — which names two options and picks neither.

## Context

The jobs layer and the outbox now exist: `claim_outbox_batch` leases work, and
`messageFor()` in `packages/notifications/src/outbox.ts` turns a claimed row into a push
or an email, with the §8 rules that actually matter attached to it — N9 must say which of
its two halves to send, E1 is Willo's and must never go out from here, a row whose channel
disagrees with the register is a fault in the row rather than a network blip.

The Edge Function that drains the outbox needs those rules. It runs on Deno. The workspace
is Node and TypeScript compiled by `tsc --noEmit` with `moduleResolution: Bundler`, and
every internal import in `packages/*` is extensionless (`from './templates'`).

Deno requires the extension. That single line of difference is the whole problem.

## What was tried

Adding `.ts` to the two internal imports in `packages/notifications`. `tsc` rejects it:

```
error TS5097: An import path can only end with a '.ts' extension when
'allowImportingTsExtensions' is enabled.
```

The flag is available — the package is `noEmit` — but the package is consumed as source by
all three Next apps through `transpilePackages`, so enabling it is a change to the shared
base config and to how webpack resolves three applications, for the benefit of one
consumer. Reverted rather than pushed through.

## The options

1. **Vendor a Deno copy** under `supabase/functions/_shared/`. No build step, and it
   works today. It is also a second implementation of §8's send rules with nothing in CI
   able to test it — there is no Deno in the workspace — so it drifts silently, which is
   precisely the failure this repo has been careful to avoid elsewhere. `pay.vectors.json`
   exists because the same problem was solved properly for the pay rules.
2. **Generate a register artifact** (JSON) from `templates.ts` and import it from Deno
   with a drift test, mirroring `packages/domain/scripts/gen-vectors-sql.mjs`. This shares
   the *copy* but not the *rules*, so `messageFor` still ends up written twice.
3. **`allowImportingTsExtensions` across the workspace**, so one source tree serves both
   runtimes. Cleanest if webpack and `tsc` both stay happy; the cost is a config change
   touching three apps, which wants its own pull request and its own review.
4. **Publish `packages/notifications` to npm** (or a registry Supabase can reach) and
   import it with an `npm:` specifier. Correct, and heavier than this project needs while
   everything still lives in one repo.

## Why this is open rather than decided

Every option above is cheap to implement and expensive to get wrong, and the one that
looks cheapest — vendoring — is the one that quietly puts a second copy of the §8 rules in
the tree. None of them can be verified here: there is no Deno in the workspace and no
Supabase project to deploy against, so "it bundles" and "it runs" are both currently
unfalsifiable claims.

The jobs layer does not wait on this. The migration, the claim/lease/backoff functions and
the pure `messageFor` are merged and tested; what waits is only the Deno process that
calls them.

## Recommendation

Option 3, as its own pull request: try `allowImportingTsExtensions` in
`tsconfig.base.json`, confirm `pnpm turbo lint typecheck test build` stays green across
all three apps, and only fall back to option 2 if webpack objects. It is the only option
that leaves one implementation of the §8 rules.

## Update, 21.09.2026 — webpack does not object

The experiment above was run while building the auto-assign engine, which needs the same
import and was blocked behind the same question. `allowImportingTsExtensions: true` in
`tsconfig.base.json`, plus `.ts` on the two internal imports in
`packages/notifications/src/index.ts`, leaves `pnpm turbo lint typecheck test build` green
across all 29 tasks — including `next build` for all three apps through
`transpilePackages`, which was the specific risk.

So the one claim this ADR called unfalsifiable is now falsified in the cheap direction:
option 3 builds. That is not the same as the Edge Function running — there is still no
Deno in the workspace and no Supabase project — but the objection that made option 3
expensive has gone, and options 1 and 2 no longer need to be considered on its account.

The change was reverted rather than carried, because this ADR asks for it in its own pull
request and it touches the base config for three applications. It should be picked up
there, unblocking `notify-drain` (§8) and `auto-staffing` (§3.4) together.
