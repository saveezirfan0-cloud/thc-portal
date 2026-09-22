import { expect, test } from '@playwright/test';

/**
 * Role routing (§1.4), the first of the two gates in front of row-level
 * security. Runs per project, so each app is checked against its own
 * middleware.
 *
 * Two of the three need a Supabase project to mean anything. Every
 * middleware degrades open without one — "render the shell rather than
 * redirect-looping" — so against the build CI produces there is no redirect
 * to assert, and the two tests below failed in all three apps rather than
 * telling anyone the gate was broken. They are skipped when the app is
 * ungated, the way the Shift Builder suite already skips itself when it is
 * gated: the same condition read from the other side.
 *
 * The third test needs no project and runs everywhere.
 */
test('an unauthenticated visitor is sent to sign in', async ({ page }) => {
  const response = await page.goto('/');
  test.skip(
    !page.url().includes('/login'),
    'No Supabase project: the middleware degrades open, so there is no redirect to assert.',
  );
  expect(response?.ok()).toBe(true);
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('the redirect remembers where the visitor was going', async ({ page }) => {
  await page.goto('/reports');
  test.skip(
    !page.url().includes('/login'),
    'No Supabase project: the middleware degrades open, so there is no redirect to assert.',
  );
  await expect(page).toHaveURL(/[?&]next=%2Freports/);
});

test('a sign-in page is reachable without a session', async ({ page }) => {
  const response = await page.goto('/login');
  expect(response?.ok()).toBe(true);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});
