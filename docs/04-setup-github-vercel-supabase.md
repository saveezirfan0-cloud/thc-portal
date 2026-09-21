# 04 · Setup: GitHub · Vercel · Supabase · Claude Code

Vercel and Supabase are not connected to this project yet. This is the order to connect them, with the exact commands, so the first Claude Code session on the code can start from a working pipeline.

## 1. GitHub (already: `saveezirfan0-cloud/thc-portal`)
1. Protect `main`: require PR, require the status check `ci` (added in §5 below).
2. Add repository secrets (Settings → Secrets → Actions): `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, `SUPABASE_DB_PASSWORD`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID_OFFICE|STAFF|CLIENT`.
3. Labels for bot routing: `domain:onboarding`, `domain:scheduling`, `domain:compliance`, `domain:checkin`, `domain:reports`, `domain:client-portal`, `domain:staff-pwa`, `domain:platform`, `domain:design-system`.
4. Install the **Claude GitHub App** on the repo (https://github.com/apps/claude) so `@claude` works on issues/PRs and so Claude Code on the web can open PRs.

## 2. Supabase
```bash
npm i -g supabase
supabase login                                  # uses SUPABASE_ACCESS_TOKEN
supabase projects create thc-staging --region eu-west-2 --org-id <org>
supabase link --project-ref <ref>
supabase db push                                # applies supabase/migrations/*.sql
supabase gen types typescript --linked > packages/db/src/types.ts
```
Dashboard steps (one-off):
- Enable extensions: `postgis`, `pg_cron`, `pg_net` (Database → Extensions).
- Storage buckets (private): `documents`, `photos`, `reports`, `timesheets`.
- Auth: enable Email provider, disable sign-ups (workers are invited; admins/clients are created by an admin), set Site URL per app, add redirect URLs for `/activate` and `/auth/reset`.
- Integrations → GitHub: connect the repo and turn on **Supabase Branching** so every PR gets a preview database with migrations applied.
- Edge Function secrets: `supabase secrets set GEMINI_API_KEY=… WILLO_API_KEY=… WILLO_WEBHOOK_SECRET=… RESEND_API_KEY=… VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… MAPBOX_TOKEN=…`
- Cron: applied by migration `0002_cron.sql` using `cron.schedule(...)` + `net.http_post` to the function URLs with the service-role key stored in Vault.

Production: repeat with `thc-prod` in an organisation **owned by THC** (the code and hosting transfer, §1.1). Keep staging in the supplier org until hand-over.

## 3. Vercel
```bash
npm i -g vercel
vercel login
# one project per app, root directory set to the app folder; framework Next.js; build via turbo
vercel link --project thc-office   # cwd apps/office
vercel link --project thc-staff    # cwd apps/staff
vercel link --project thc-client   # cwd apps/client
```
Per project env vars (Production + Preview): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only), `NEXT_PUBLIC_MAPBOX_TOKEN`, `RESEND_API_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `APP_TZ=Europe/London`.
- Vercel → Integrations → **Supabase**: links preview deployments to Supabase branches automatically (env vars swapped per PR).
- Domains: `office.` / `app.` / `clients.` on THC's domain; `app.` must be HTTPS with a valid cert for PWA install + push (Vercel does this).
- The Vercel MCP connector in Claude (`list_projects`, `deploy_to_vercel`, `get_deployment_build_logs`) works once the Vercel account is connected in claude.ai → Connectors; same for the Supabase connector (`apply_migration`, `execute_sql`, `deploy_edge_function`). After connecting, a Claude session can run migrations and read build logs directly.

## 4. Monorepo bootstrap (first coding session)
```bash
pnpm dlx create-turbo@latest . --skip-install
pnpm dlx create-next-app@latest apps/office --ts --app --eslint --src-dir=false --import-alias "@/*"
pnpm dlx create-next-app@latest apps/staff  --ts --app --eslint
pnpm dlx create-next-app@latest apps/client --ts --app --eslint
pnpm add -w -D typescript vitest @playwright/test prettier eslint
pnpm add --filter apps/staff @serwist/next serwist
pnpm add --filter "./apps/*" @supabase/supabase-js @supabase/ssr
pnpm add --filter packages/pdf @react-pdf/renderer
```
Then run `/init` in Claude Code to refresh `CLAUDE.md` with the real commands, and keep `docs/` as the source for rules.

## 5. GitHub Actions
`.github/workflows/ci.yml` — pnpm install, `turbo lint typecheck test`, `supabase db start && supabase test db` (pgTAP), Playwright smoke.
There is deliberately no `claude.yml`: automatic PR review was removed (see `05-domain-bots.md`). No workflow reads an Anthropic key.
`.github/workflows/preview.yml` — Vercel preview deploy per app when its folder changes (or rely on the Vercel Git integration, which is simpler).

## 6. Local development
```bash
supabase start            # local Postgres + Auth + Storage + Edge runtime
supabase db reset         # migrations + seed.sql
pnpm dev                  # turbo runs the three Next apps on :3000/:3001/:3002
supabase functions serve  # edge functions with .env.local
```
The PWA needs HTTPS for install/push on a phone: use `pnpm dlx local-ssl-proxy` or test on the Vercel preview URL.
