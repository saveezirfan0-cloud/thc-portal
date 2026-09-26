import { defineConfig, devices } from '@playwright/test';

/**
 * The browser suite (CI runs `pnpm turbo e2e:smoke`).
 *
 * Smoke, per app: it boots, serves its shell, carries the appearance switch,
 * and its gate (§1.4) sends a stranger to /login. Then the journeys, each
 * signed in through tests/_support/session.ts as the seeded account it needs:
 *
 *   office   the event list and calendar, the shift builder, the event
 *            board, and `outbox.spec.ts` — a manager's "Send allocation
 *            sheet" writes exactly one notification_outbox row under the
 *            register's key (§8, §11.4); `office.users.spec.ts` — invite a
 *            Back Office login on /users, accept its set-up link, switch it
 *            off, read both on /activity — and `office.account.spec.ts` —
 *            rename yourself on /account (ADR-0049)
 *   staff    the public /apply form, the PWA shell and the four app locks,
 *            the three working screens, `staff.activation.spec.ts` — a GET
 *            of /activate/:token never spends the link and the submit does,
 *            once (§2.7) — and `staff.wizard.spec.ts` — step 1 of 11 in
 *            order, Male/Female before Continue, the lock until documents
 *            are verified, the base rate only (§10.3, Appendix A)
 *   client   `client.portal.spec.ts` — the customer's own events and no
 *            other's, the confirmed line-up and nothing about how it was
 *            chosen, no money anywhere, feedback locked until the event
 *            starts and "✓ Feedback sent" after (§11.1–§11.5); and
 *            `client.invite.spec.ts` — a Client Portal login invited from
 *            the office's /users, set up on the portal (ADR-0049; drives
 *            both servers)
 *
 * The journeys that read or seed the database do it with psql through
 * tests/_support/db.ts and skip, saying why, when no database is reachable.
 */
const PORTS = { office: 3000, staff: 3001, client: 3002 } as const;

/**
 * Machines that pin a Chromium build (sandboxes, locked-down CI images) can
 * point at it instead of downloading one. Left unset, Playwright uses its own.
 */
/**
 * The apps need a reachable Supabase to render: screens query it server-side,
 * and the middleware gates every route behind a session. The servers inherit
 * the ambient environment, so point it at a database before running this.
 *
 * CI runs `supabase start` and exports that stack's URL and anon key. Locally,
 * either do the same or use a .env.local pointed at a project you can reach.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
const launchOptions = executablePath ? { executablePath } : {};

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { trace: 'on-first-retry', launchOptions },
  projects: [
    {
      name: 'office',
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${PORTS.office}` },
      testMatch: [
        /office\..*\.spec\.ts/,
        // The outbox is written from the Back Office (Send on an event's
        // document), so the journey runs against this server.
        /outbox\.spec\.ts/,
        /auth\.smoke\.spec\.ts/,
        /gate\.smoke\.spec\.ts/,
        /signout\.smoke\.spec\.ts/,
      ],
    },
    {
      // public.* is the logged-out /apply journey (§2.1). It lives in the
      // staff app and is reached from a phone browser long before there is
      // an account, so it runs on this project's phone viewport rather
      // than standing up a server of its own.
      name: 'staff',
      use: { ...devices['Pixel 7'], baseURL: `http://127.0.0.1:${PORTS.staff}` },
      testMatch: [
        /staff\..*\.spec\.ts/,
        // Named as well as matched above: /activate/:token is public and
        // the wizard is the candidate's first signed-in screen, both on
        // this phone viewport.
        /staff\.activation\.spec\.ts/,
        /staff\.wizard\.spec\.ts/,
        /public\..*\.spec\.ts/,
        /auth\.smoke\.spec\.ts/,
        /gate\.smoke\.spec\.ts/,
        /signout\.smoke\.spec\.ts/,
      ],
    },
    {
      name: 'client',
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${PORTS.client}` },
      testMatch: [
        /client\..*\.spec\.ts/,
        /auth\.smoke\.spec\.ts/,
        /gate\.smoke\.spec\.ts/,
        /signout\.smoke\.spec\.ts/,
      ],
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @thc/office start',
      url: `http://127.0.0.1:${PORTS.office}`,
      // /users builds a Client Portal invite link on the portal's origin
      // (ADR-0049), read from NEXT_PUBLIC_CLIENT_URL. `next start` runs as
      // production, where the office refuses to guess it, so without this
      // every client invite in client.invite.spec.ts is refused. Merged
      // over the ambient environment by Playwright, not a replacement.
      env: {
        NEXT_PUBLIC_CLIENT_URL:
          process.env.NEXT_PUBLIC_CLIENT_URL || `http://127.0.0.1:${PORTS.client}`,
      },
      // Never reuse: a server left over from an earlier build serves stale
      // chunks, which breaks hydration and produces baffling failures.
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @thc/staff start',
      url: `http://127.0.0.1:${PORTS.staff}`,
      // Never reuse: a server left over from an earlier build serves stale
      // chunks, which breaks hydration and produces baffling failures.
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @thc/client start',
      url: `http://127.0.0.1:${PORTS.client}`,
      // Never reuse: a server left over from an earlier build serves stale
      // chunks, which breaks hydration and produces baffling failures.
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
