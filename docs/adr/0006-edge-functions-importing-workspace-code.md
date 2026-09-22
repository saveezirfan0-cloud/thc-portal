# ADR-0006 · How an Edge Function imports workspace code

**Status:** Accepted, 21.09.2026 — option 3. Was Open for three hours; the experiment it
asked for was run and passed, so the recommendation below is now the decision. Unblocks
the import side of the `notify-drain` Edge Function (§8, P2 in
`docs/13-remaining-work.md`); P2 itself still waits on the VAPID pair and the Resend key
(`docs/14` O3). Refines the unresolved aside in
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

---

## Decision, and what the experiment showed

Option 3, taken. `allowImportingTsExtensions` is set in `tsconfig.base.json` and the two
internal imports in `packages/notifications` now carry `.ts`.

The fear was that the flag would be fine for `tsc` and break webpack, since all three Next
apps consume these packages as source through `transpilePackages`. It does not. Measured
across the whole workspace, nothing cached:

| Check | Result |
| --- | --- |
| `pnpm turbo typecheck` | 12/12 workspaces pass |
| `pnpm turbo build` | all three Next apps build |
| `pnpm turbo test` | pass |
| `pnpm turbo lint` | pass |

So one source tree now serves both runtimes, and there is no second copy of the §8 send
rules to drift — which was the whole objection to options 1 and 2.

## What is still unproven

That Supabase's bundler follows a relative import reaching *outside* `supabase/functions/`
into `packages/`. There is no Deno and no Supabase project in the build environment, so
"it bundles" cannot be tested here; it is testable the moment `supabase functions deploy`
is run against a real project.

If it turns out not to, the fallback is not back to vendoring: it is to publish
`packages/notifications` to a registry Deno can reach and import it with an `npm:`
specifier — option 4, which was rejected only as heavier than necessary while everything
lives in one repo, not as wrong. The flag landed here is what makes that fallback cheap
too, because the package is a valid Deno module either way.

## Note for whoever writes the next shared package

The convention is now: **internal relative imports inside `packages/*` carry the `.ts`
extension.** Only `packages/notifications` does today, because it is the only one an Edge
Function needs. A package that stays Node-only does not have to follow, but there is no
cost to doing so, and a package that later grows a Deno consumer will have to.
