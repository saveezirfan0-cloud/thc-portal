import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Signing out (§1.4). Runs per project, so each app is checked against its
 * own middleware and its own copy of the route.
 *
 * What is being defended here shipped broken once. `/auth/signout` answers
 * POST only — a GET sign-out fires from anything that makes the browser
 * issue one, a link prefetch included — and both callers were links, so
 * every click returned 405. The worse half was the wrong-app page: it is
 * what middleware serves a session whose role belongs to another app, its
 * sign-out is the only thing on it that can help, and the role gate
 * answered that POST with the same page. Signed in, admitted nowhere,
 * unable to switch accounts.
 *
 * The unit suites pin the markup (`packages/ui` for the component,
 * `packages/db` for the interstitial). Only a browser can show that the
 * POST actually reaches the handler through the middleware, which is the
 * part that was broken.
 */

const PASSWORD = 'password123';

/**
 * A seeded account whose role belongs to one of the OTHER two apps, so this
 * app's gate refuses it and serves the wrong-app page. Gisela is the seeded
 * admin, Marco a seeded client (supabase/seed.sql).
 */
const WRONG_ROLE: Record<string, string> = {
  office: 'marco@leonardo-stpauls.example',
  staff: 'marco@leonardo-stpauls.example',
  client: 'gisela@thehospitalitycompany.example',
};

/** True when a Supabase project is wired up, asked of the app rather than the environment. */
async function gated(page: Page): Promise<boolean> {
  await page.goto('/');
  return new URL(page.url()).pathname.startsWith('/login');
}

test('the route answers POST only, so a prefetch cannot end a shift', async ({ request }) => {
  // Deliberate, and worth pinning: the fix for the 405 was to make the
  // callers POST, never to make the route accept GET.
  const response = await request.get('/auth/signout', { maxRedirects: 0 });
  expect(response.status()).toBe(405);
});

test('a session the app refuses can still end itself', async ({ page }, testInfo) => {
  test.skip(
    !(await gated(page)),
    'No Supabase project: the middleware degrades open, so there is no wrong-app page to reach.',
  );

  const email = WRONG_ROLE[testInfo.project.name];
  expect(email, `no wrong-role account for project ${testInfo.project.name}`).toBeTruthy();

  await page.goto('/login');
  await page.getByLabel('Email').fill(email!);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // The credentials are good, so sign-in succeeds and the ROLE gate is what
  // refuses the session — a terminal 403 page, never a redirect (three apps
  // on three hosts made HOME_PATH a loop).
  await expect(page.getByRole('heading', { name: /not for the/i })).toBeVisible();

  // The only control on that page. If the role gate intercepts this POST, it
  // re-renders the same page and the account is stuck.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);

  // And the session is really gone, not merely navigated away from.
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});
