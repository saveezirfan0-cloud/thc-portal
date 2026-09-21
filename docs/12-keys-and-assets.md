# 12 · Keys, connections and brand assets

Everything you need to obtain, where to get it, and where it goes. Ordered by when you
actually need it, so you are not chasing keys for features that do not exist yet.

`docs/04-setup-github-vercel-supabase.md` lists the full end-state. This page is the
practical order of work.

---

## Tier 1 · Needed now, to run against a real database

Only **four** values are read by the code today. Everything else below is for later.

| Value | Where to get it | Where it goes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard → your project → Settings → API → Project URL | `.env.local` in each app, and each Vercel project |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same page. Labelled **anon / public**, or **publishable** in the newer dashboard | Same |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page. Labelled **service_role**, or **secret** | Same, but **server-side only**. Never in a `NEXT_PUBLIC_` name |
| `APP_TZ` | Not obtained. It is always `Europe/London` | Same |

Links:

- Create the project: https://supabase.com/dashboard/new
- API keys once it exists: https://supabase.com/dashboard/project/_/settings/api

**Region must be London (`eu-west-2`).** This is UK payroll and right-to-work data.

**The service role key bypasses every security policy.** It belongs in a server
environment variable and nowhere else. If it ever appears in a browser bundle, rotate it
on that same API page.

### Where `.env.local` goes

One per app, next to the existing `.env.example`:

```
apps/office/.env.local
apps/staff/.env.local
apps/client/.env.local
```

They are git-ignored. Copy `.env.example` and fill in the four values above.

---

## Tier 2 · Needed to deploy and to run the robots

### GitHub repository secrets

Settings → Secrets and variables → Actions → New repository secret:
https://github.com/saveezirfan0-cloud/thc-portal/settings/secrets/actions

| Secret | Where to get it | Needed for |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | https://supabase.com/dashboard/account/tokens | Later, for running migrations from CI |
| `SUPABASE_PROJECT_ID` | The project reference in your Supabase URL | Later |
| `SUPABASE_DB_PASSWORD` | Set when you create the project. Save it then; it is not shown again | Later |
| `VERCEL_TOKEN` | https://vercel.com/account/tokens | Later, only if you deploy from CI rather than the Git integration |
| `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID_*` | Vercel project → Settings → General | Later |

Also install the Claude GitHub App on the repository, or `@claude` will not respond:
https://github.com/apps/claude/installations/select_target

### Vercel

Create three projects from this one repository:
https://vercel.com/new

| Project | Root directory | Suggested domain |
|---|---|---|
| `thc-office` | `apps/office` | `office.` |
| `thc-staff` | `apps/staff` | `app.` |
| `thc-client` | `apps/client` | `clients.` |

For each project, set the four Tier 1 values under Settings → Environment Variables, for
both Production and Preview. Framework is Next.js. The build command can stay default;
Turborepo handles the shared packages.

The staff app **must** be served over HTTPS on a real domain, because a progressive web
app cannot be installed or receive push notifications otherwise. Vercel does this for you.

Connect the Supabase integration so preview deployments get their own branch database:
Vercel → Integrations → Supabase.

---

## Tier 3 · Needed per phase, not yet

Do not chase these now. Each is listed against the phase that first needs it.

| Key | Where | First needed |
|---|---|---|
| `WILLO_API_KEY`, `WILLO_WEBHOOK_SECRET` | THC's Willo account | Phase 1, interviews |
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey | Phase 1, reading dates off documents |
| `RESEND_API_KEY` | https://resend.com/api-keys | Phase 1, the activation email |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Generated, not obtained. Run `npx web-push generate-vapid-keys`, or ask me | Phase 3, push notifications |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | https://account.mapbox.com/access-tokens/ | Phase 2, the venues map |

Anything used by a background function goes in Supabase rather than Vercel:

```
supabase secrets set GEMINI_API_KEY=… WILLO_API_KEY=… RESEND_API_KEY=…
```

Email needs two verified senders on THC's domain, `admin@` and `timesheets@`, which means
adding DNS records. That is a dependency on THC and has lead time, so start it early even
though the code needs it later.

---

## Brand assets

Put the source files in the `brand/` folder at the repository root and tell me. I will
generate every size and wire them in. Do not hand-place the icons: several have exact
names the code already expects.

**What to supply:**

- The logo as **SVG** if you have it. Vector scales to every size without going fuzzy.
- Failing that, a **PNG at 1024 by 1024** or larger, on a transparent background.
- A square version that reads well when small, if the main logo is wide. App icons are
  square and end up around 20 pixels in a browser tab.
- Any brand colour references you want honoured.

**Where they end up:**

| File | App | Why |
|---|---|---|
| `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | `apps/staff/public/` | The web app manifest already names these three. They do not exist yet, so the staff app is currently not installable. |
| `favicon.ico` and `apple-icon.png` | All three apps' `public/` | Browser tab and iOS home screen |
| Brand mark | `packages/ui` | The sign-in card and sidebar currently render the letters "THC" in a box as a placeholder |

The maskable icon needs roughly 20% clear padding around the mark, because Android crops
it to whatever shape the phone uses. I will handle that when generating.

---

## Design

Drop the updated wireframes in and say so. The stylesheets in `packages/ui` are derived
from `wireframes/assets/thc.css` on comment boundaries, so a design change is regenerated
rather than hand-patched. That is session S0 in `docs/11-session-prompts.md`.

---

## What else, beyond keys

- **Protect `main`.** Require a pull request and require the `ci` check to pass:
  https://github.com/saveezirfan0-cloud/thc-portal/settings/branches
- **Add the routing labels** so `@claude` knows which bot to use: `domain:onboarding`,
  `domain:scheduling`, `domain:compliance`, `domain:checkin`, `domain:reports`,
  `domain:client-portal`, `domain:staff-pwa`, `domain:platform`, `domain:design-system`.
- **Decide where production lives.** Your setup doc notes the hosting transfers to THC at
  hand-over, so production should sit in an organisation THC owns. Staging can stay in
  yours.
- **Chase THC for the Appendix B inputs.** The contract text, sample completion letters,
  the logo, the Willo keys, DNS, and the export from the old system. Several phases stop
  dead without them.
- **Two open product decisions** are recorded in `docs/11-session-prompts.md`: the Client
  Portal line-up, and the three judgement calls in the row-level-security migration.
