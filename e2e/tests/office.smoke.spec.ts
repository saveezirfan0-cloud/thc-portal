import { expect, test } from '@playwright/test';

test('back office serves its shell with the full menu', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  for (const item of ['Events', 'Check-in monitor', 'Compliance', 'Reports']) {
    await expect(page.getByRole('link', { name: item })).toBeVisible();
  }
});

test('scheduled times are labelled as UK time (§1.8)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('All times UK (Europe/London)')).toBeVisible();
});

test('the design system renders and the appearance switch flips both axes', async ({ page }) => {
  await page.goto('/design-system');
  const html = page.locator('html');

  await page.getByRole('button', { name: 'Dark · Scope §1.6' }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(html).toHaveAttribute('data-style', 'scope');

  await page.getByRole('button', { name: 'Light · Warm' }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(html).toHaveAttribute('data-style', 'warm');
});

test('the mode survives a reload (ADR-0003)', async ({ page }) => {
  await page.goto('/design-system');
  await page.getByRole('button', { name: 'Dark · Scope §1.6' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
