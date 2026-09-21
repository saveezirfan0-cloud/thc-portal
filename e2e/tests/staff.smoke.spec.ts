import { expect, test } from '@playwright/test';

test('staff app serves its shell with the bottom navigation', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Shifts', { exact: true }).first()).toBeVisible();
  for (const item of ['Invites', 'Radar', 'Documents', 'Profile']) {
    await expect(page.getByRole('link', { name: item })).toBeVisible();
  }
});

test('the PWA manifest is served and installable (ADR-0001)', async ({ request }) => {
  const response = await request.get('/manifest.webmanifest');
  expect(response.ok()).toBe(true);

  const manifest = (await response.json()) as {
    display: string;
    start_url: string;
    icons: unknown[];
  };
  // Installability is what unlocks Web Push on iOS 16.4+ (§10.5).
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBe('/shifts');
  expect(manifest.icons.length).toBeGreaterThan(0);
});
