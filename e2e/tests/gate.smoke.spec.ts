import { expect, test } from '@playwright/test';

/**
 * Role routing (§1.4), the first of the two gates in front of row-level security.
 *
 * These run per project, so each app is checked against its own middleware.
 * They replace the earlier "serves its shell" tests, which only passed while
 * no Supabase project was configured: with one configured, an unauthenticated
 * visitor is correctly redirected, which is the behaviour worth asserting.
 */
test('an unauthenticated visitor is sent to sign in', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.ok()).toBe(true);
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('the redirect remembers where the visitor was going', async ({ page }) => {
  await page.goto('/reports');
  await expect(page).toHaveURL(/[?&]next=%2Freports/);
});

test('a public route is not gated', async ({ page }, testInfo) => {
  // Every app exposes its own sign-in page without a session.
  const response = await page.goto('/login');
  expect(response?.ok()).toBe(true);
  await expect(page).toHaveURL(/\/login$/);
  expect(testInfo.project.name).toBeTruthy();
});
