import { defineConfig, devices } from '@playwright/test';

/**
 * Phase 0 smoke: each app boots, serves its shell and carries the appearance
 * switch. Once auth lands, the login-per-role journeys go here too (CI runs
 * `pnpm turbo e2e:smoke`).
 */
const PORTS = { office: 3000, staff: 3001, client: 3002, public: 3011 } as const;

/**
 * The three smoke servers run deliberately UNCONFIGURED: with no Supabase
 * project the middleware renders the shell instead of redirecting to
 * /login, which is what the Phase 0 smoke tests assert. CI exports the
 * local stack's URL and key for the public journey below, so they have to
 * be blanked here explicitly or those tests change meaning.
 */
const UNCONFIGURED = { NEXT_PUBLIC_SUPABASE_URL: '', NEXT_PUBLIC_SUPABASE_ANON_KEY: '' };

/**
 * Machines that pin a Chromium build (sandboxes, locked-down CI images) can
 * point at it instead of downloading one. Left unset, Playwright uses its own.
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
      testMatch: [/office\..*\.spec\.ts/, new RegExp(`auth\\.smoke\\.spec\\.ts`)],
    },
    {
      name: 'staff',
      use: { ...devices['Pixel 7'], baseURL: `http://127.0.0.1:${PORTS.staff}` },
      testMatch: [/staff\..*\.spec\.ts/, new RegExp(`auth\\.smoke\\.spec\\.ts`)],
    },
    {
      name: 'client',
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${PORTS.client}` },
      testMatch: [/client\..*\.spec\.ts/, new RegExp(`auth\\.smoke\\.spec\\.ts`)],
    },
    {
      // /apply is reached from a phone browser long before there is an app
      // to install, so it is tested on a phone viewport (§2.1).
      name: 'public',
      use: { ...devices['Pixel 7'], baseURL: `http://127.0.0.1:${PORTS.public}` },
      testMatch: [/public\..*\.spec\.ts/],
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @thc/office start',
      url: `http://127.0.0.1:${PORTS.office}`,
      // Never reuse: a server left over from an earlier build serves stale
      // chunks, which breaks hydration and produces baffling failures.
      reuseExistingServer: false,
      timeout: 120_000,
      env: UNCONFIGURED,
    },
    {
      command: 'pnpm --filter @thc/staff start',
      url: `http://127.0.0.1:${PORTS.staff}`,
      // Never reuse: a server left over from an earlier build serves stale
      // chunks, which breaks hydration and produces baffling failures.
      reuseExistingServer: false,
      timeout: 120_000,
      env: UNCONFIGURED,
    },
    {
      command: 'pnpm --filter @thc/client start',
      url: `http://127.0.0.1:${PORTS.client}`,
      // Never reuse: a server left over from an earlier build serves stale
      // chunks, which breaks hydration and produces baffling failures.
      reuseExistingServer: false,
      timeout: 120_000,
      env: UNCONFIGURED,
    },
    {
      // A second staff server, this one wired to Supabase, because /apply
      // writes to the database and the smoke servers above must not. It
      // inherits NEXT_PUBLIC_SUPABASE_* from the environment: CI exports
      // the local stack after `supabase start`, and locally you export the
      // same two values (`supabase status -o env`) before running e2e.
      // Without them the server still boots and the public.* tests skip.
      command: `pnpm --filter @thc/staff exec next start --port ${PORTS.public}`,
      url: `http://127.0.0.1:${PORTS.public}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
