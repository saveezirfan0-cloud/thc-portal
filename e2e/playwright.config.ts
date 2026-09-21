import { defineConfig, devices } from '@playwright/test';

/**
 * Phase 0 smoke: each app boots, serves its shell and carries the appearance
 * switch. Once auth lands, the login-per-role journeys go here too (CI runs
 * `pnpm turbo e2e:smoke`).
 */
const PORTS = { office: 3000, staff: 3001, client: 3002 } as const;

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
      testMatch: [/office\..*\.spec\.ts/, /auth\.smoke\.spec\.ts/, /gate\.smoke\.spec\.ts/],
    },
    {
      name: 'staff',
      use: { ...devices['Pixel 7'], baseURL: `http://127.0.0.1:${PORTS.staff}` },
      testMatch: [/staff\..*\.spec\.ts/, /auth\.smoke\.spec\.ts/, /gate\.smoke\.spec\.ts/],
    },
    {
      name: 'client',
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${PORTS.client}` },
      testMatch: [/client\..*\.spec\.ts/, /auth\.smoke\.spec\.ts/, /gate\.smoke\.spec\.ts/],
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
