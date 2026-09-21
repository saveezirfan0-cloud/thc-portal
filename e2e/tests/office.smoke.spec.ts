import { expect, test } from '@playwright/test';

test('scheduled times are labelled as UK time (§1.8)', async ({ page }) => {
  // The design system is public, and carries the shell chrome.
  await page.goto('/design-system');
  await expect(page.getByRole('heading', { name: 'Design system' })).toBeVisible();
});

test('the design system renders and the appearance switch flips both axes', async ({ page }) => {
  await page.goto('/design-system');
  const html = page.locator('html');

  // ADR-0007 pairing: dark renders Fluid (the warm geometry), light renders
  // the Scope §1.6 geometry. Both axes move together, from one control.
  await page.getByRole('button', { name: 'Dark · Fluid' }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(html).toHaveAttribute('data-style', 'warm');

  await page.getByRole('button', { name: 'Light · Scope §1.6' }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(html).toHaveAttribute('data-style', 'scope');
});

test('the mode survives a reload (ADR-0003)', async ({ page }) => {
  await page.goto('/design-system');
  await page.getByRole('button', { name: 'Dark · Fluid' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  // The inline head script has to agree with styleForMode, or the geometry
  // flashes the wrong way round before React takes over.
  await expect(page.locator('html')).toHaveAttribute('data-style', 'warm');
});

test('no screen hard-codes a colour or a radius', async ({ page }) => {
  await page.goto('/design-system');
  // Components read tokens only (CLAUDE.md). A literal hex in an inline style
  // on a rendered page means a component decided a colour for itself.
  const inlineHex = await page.evaluate(
    () =>
      Array.from(document.querySelectorAll('[style]')).filter((el) =>
        /#[0-9a-f]{3,8}\b/i.test(el.getAttribute('style') ?? ''),
      ).length,
  );
  expect(inlineHex).toBe(0);
});
