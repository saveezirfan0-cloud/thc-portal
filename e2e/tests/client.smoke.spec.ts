import { expect, test } from '@playwright/test';

test('client portal serves its shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();
});

test('the client portal menu exposes no money and no staff data (§11.1)', async ({ page }) => {
  await page.goto('/');
  const forbidden = ['Reports', 'Payroll', 'Rates', 'Staff', 'Compliance', 'Clients'];
  for (const item of forbidden) {
    await expect(page.getByRole('link', { name: item })).toHaveCount(0);
  }
});
