import { expect, test } from '@playwright/test';

/**
 * The sign-in card is one component shared by all three apps (§1.4, §10.2),
 * so every project runs the same checks against its own product name.
 */
const PRODUCT: Record<string, string> = {
  office: 'Back Office',
  staff: 'Staff app',
  client: 'Client Portal',
};

test('login page renders the sign-in card', async ({ page }, testInfo) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByText(PRODUCT[testInfo.project.name]!, { exact: true })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
});

test('a failed sign-in never reveals whether the account exists', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('nobody@example.com');
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  const alert = page.getByRole('status');
  await expect(alert).toBeVisible();
  await expect(alert).not.toContainText(/no such|unknown email|not found|no account|no user/i);
});
