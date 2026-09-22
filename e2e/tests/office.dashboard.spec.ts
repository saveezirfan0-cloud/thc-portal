import { type Page, expect, test } from '@playwright/test';
import { openAsAdmin } from './_support/session';

/**
 * /dashboard — Scope §9.1.
 *
 * Two halves, because the suite has to work in two environments.
 *
 * The structural tests run everywhere: four KPIs on one row, the weekly
 * money panel with the holiday element broken out, the ten-day list, and
 * the §1.8 zone note. CI builds the Back Office with no Supabase project,
 * so those render their empty states and still prove the screen's shape.
 *
 * The one test that asserts a number skips itself when there is no
 * database to count, the way gate.smoke.spec.ts skips when the gate
 * degrades open. 35 is the open-position total in supabase/seed.sql and is
 * worked out in the test itself.
 */

/** True when the page could not reach a database, so there is nothing to count. */
async function withoutData(page: Page): Promise<boolean> {
  return (await page.locator('.alert', { hasText: 'no Supabase project' }).count()) > 0;
}

test('the four operational KPIs sit on one row (§9.1)', async ({ page }) => {
  await openAsAdmin(page, '/dashboard');

  const tiles = page.locator('.tilegrid .kpi');
  await expect(tiles).toHaveCount(4);
  for (const label of ['Open positions', 'On shift now', 'Staff available', 'Compliance blocks']) {
    await expect(page.locator('.tilegrid .kpi .k', { hasText: label })).toBeVisible();
  }
});

test('Open positions counts every unfilled seat in the seed (§9.1)', async ({ page }) => {
  await openAsAdmin(page, '/dashboard');
  test.skip(await withoutData(page), 'No Supabase project: there is nothing to count.');

  // supabase/seed.sql, non-cancelled sections that have not yet ended:
  //   Gala Dinner       Chef 2/2 = 0 · KP 3, 2 confirmed = 1 · Waiting 12, 9 = 3
  //   Product Launch    Bar 6, 4 confirmed = 2
  //   Wedding           Chef 2, 0 = 2 · Waiting 10, 0 = 10
  //   Awards Night      Host 4, 3 confirmed = 1 · Waiting 16, 0 = 16
  //   Conference Lunch  cancelled — nothing was sold (§3.3)
  //   Lunch Service     two weeks ago — cannot be staffed now
  // = 35, and it counts confirmed only: the invited and self-applied
  //   bookings on the Gala's waiting section are not fill (§3.2).
  const tile = page.locator('.kpi', { has: page.locator('.k', { hasText: 'Open positions' }) });
  await expect(tile.locator('.v')).toHaveText('35');
});

test('the weekly snapshot is Mon–Sun and never blends the holiday pay (§9.1, §1.5)', async ({
  page,
}) => {
  await openAsAdmin(page, '/dashboard');

  const panel = page.locator('.panel', { hasText: 'This week · financial snapshot' });
  await expect(panel).toBeVisible();
  // The forecast label is part of the number, not decoration (§9.9).
  await expect(panel.getByText('Forecast for the period')).toBeVisible();

  test.skip(await withoutData(page), 'No Supabase project: there are no figures to show.');

  await expect(panel.locator('.kpi .k', { hasText: 'Chargeable' })).toBeVisible();
  await expect(
    panel.locator('.kpi .k', { hasText: 'Payable (incl. holiday +12.07%)' }),
  ).toBeVisible();
  await expect(panel.locator('.kpi .k', { hasText: 'Gross margin' })).toBeVisible();
  // Base and holiday appear as two figures, never as one.
  await expect(panel.getByText(/^Base £/)).toBeVisible();
  await expect(panel.getByText(/^Holiday £/)).toBeVisible();

  // Mon … Sun, in that order, in the panel header.
  await expect(panel.locator('.pill').first()).toHaveText(/^Mon .* – Sun /);
});

test('the ten-day list puts the margin on each role row (§9.1)', async ({ page }) => {
  await openAsAdmin(page, '/dashboard');

  const panel = page.locator('.panel', { hasText: 'Upcoming events' });
  await expect(panel).toBeVisible();
  test.skip(await withoutData(page), 'No Supabase project: there are no events to list.');

  // Every role line carries its allocation, its fill and its margin.
  const firstRole = panel.locator('.dash-roles .r').first();
  await expect(firstRole).toBeVisible();
  await expect(firstRole.locator('.green, .coral')).toHaveText(/[+−]£\d+\.\d{2}\/h/);

  // The buffer is absolute: "6 (+1)", never "7" (§3.2).
  const allocations = await panel.locator('.dash-roles .r .mono').allInnerTexts();
  expect(allocations.some((text) => /\d+ \(\+\d+\)/.test(text))).toBe(true);
});

test('scheduled windows name their zone (§1.8)', async ({ page }) => {
  await openAsAdmin(page, '/dashboard');
  // The topbar states the reader's own zone; the column heading says which
  // zone the times under it are. The runner is in UTC, which is not
  // Europe/London for most of the year, so this asserts the note exists
  // rather than which of its two readings it took.
  await expect(page.locator('.topbar .tz')).toContainText('Europe/London');

  test.skip(await withoutData(page), 'No Supabase project: the table has no header to check.');
  await expect(page.getByRole('columnheader', { name: 'Window (UK time)' })).toBeVisible();
});

test('the sidebar points at /dashboard, and / lands there', async ({ page }) => {
  await openAsAdmin(page, '/dashboard');
  const link = page.locator('.sidebar').getByRole('link', { name: 'Dashboard' });
  await expect(link).toHaveAttribute('href', '/dashboard');
  await expect(link).toHaveClass(/active/);

  await openAsAdmin(page, '/');
  await expect(page).toHaveURL(/\/dashboard$/);
});
