import { expect, test } from '@playwright/test';

/**
 * Role routing (§1.4), the first of the two gates in front of row-level
 * security. Runs per project, so each app is checked against its own
 * middleware.
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

test('a sign-in page is reachable without a session', async ({ page }) => {
  const response = await page.goto('/login');
  expect(response?.ok()).toBe(true);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});
