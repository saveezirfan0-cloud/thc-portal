import { type Page, expect, test } from '@playwright/test';
import { openAsAdmin } from './_support/session';

/**
 * The Back Office on a phone — §1.2, ADR-0030.
 *
 * The office project runs at desktop size, so nothing else in the suite sees
 * the phone layout. This file runs its tests at 390×844 with a touch screen
 * and a mobile viewport, which is what made the bug visible in the first
 * place: one control that did not wrap made the layout wider than the
 * phone, the browser zoomed out, and the top bar and every panel stopped
 * short of the right edge.
 */
test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

const PHONE = 390;

/** Every route the phone tab bar and More sheet lead to, plus the event views. */
const ROUTES = [
  '/dashboard',
  '/onboarding',
  '/events',
  '/events?view=month',
  '/events?view=week',
  '/events?view=day',
  '/events/new',
  '/compliance',
  '/checkin',
  '/staff',
  '/clients',
  '/roles',
  '/reports',
  '/feedback',
  '/venues',
  '/settings',
];

async function layoutWidth(page: Page): Promise<number> {
  // `.main` clips sideways overflow as a safety net (ADR-0030 §7). Lift it,
  // so this measures whether anything actually fails to wrap rather than
  // whether the net caught it.
  await page.addStyleTag({ content: '.main { overflow-x: visible !important; }' });
  return page.evaluate(() => document.documentElement.scrollWidth);
}

for (const route of ROUTES) {
  test(`${route} lays out at the phone's width`, async ({ page }) => {
    await openAsAdmin(page, route);
    expect(await layoutWidth(page)).toBeLessThanOrEqual(PHONE);
  });
}

test('the sidebar gives way to the tab bar and its More sheet', async ({ page }) => {
  await openAsAdmin(page, '/events');

  await expect(page.locator('aside.sidebar')).toBeHidden();
  const bar = page.getByRole('navigation', { name: 'Main' });
  await expect(bar).toBeVisible();
  for (const tab of ['Dashboard', 'Scheduling', 'Compliance', 'Check-in']) {
    await expect(bar.getByRole('link', { name: tab })).toBeVisible();
  }

  // The top bar keeps one row: the appearance switch moved to the sheet.
  await expect(page.locator('.topbar').getByRole('group', { name: 'Appearance' })).toBeHidden();

  const more = bar.getByRole('button', { name: /More/ });
  await more.click();
  const sheet = page.getByRole('dialog', { name: 'Menu' });
  await expect(sheet).toBeVisible();
  for (const section of ['Onboarding', 'Staff', 'Clients', 'Roles', 'Reports', 'Venues']) {
    await expect(sheet.getByRole('link', { name: section })).toBeVisible();
  }
  // ADR-0012: sign-out has to be reachable on a phone, and it lives here.
  await expect(sheet.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Dark' })).toBeVisible();

  await sheet.getByRole('link', { name: 'Staff' }).click();
  await expect(page).toHaveURL(/\/staff/);
  await expect(page.getByRole('dialog', { name: 'Menu' })).toHaveCount(0);
});

test('list tables become labelled cards (Scheduling)', async ({ page }) => {
  await openAsAdmin(page, '/events');
  const table = page.locator('table.card-rows');
  test.skip((await table.count()) === 0, 'No events in this period to draw.');
  await expect(table.locator('thead')).toBeHidden();
  const firstRow = table.locator('tbody tr').first();
  // Each value is printed against its column name, from `data-label`.
  await expect(firstRow.locator('td[data-label="Client · Venue"]')).toBeVisible();
});
