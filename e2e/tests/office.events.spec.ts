import { expect, test } from '@playwright/test';
import { openAsAdmin } from './_support/session';

/**
 * /events — Scope §3.1.
 *
 * CI builds the Back Office with no Supabase project, so there are no events
 * to render. What that still proves is the part §3.1 is most particular
 * about: one toggle rather than two, arrows that step the right period in
 * every view including List, and a URL per state. The fill arithmetic and the
 * ordering are covered by the view-model unit tests instead.
 */

const AT = (view: string, date = '2026-09-18') => `/events?view=${view}&date=${date}`;

test('one toggle serves List and Calendar, and works both ways (§3.1)', async ({ page }) => {
  await openAsAdmin(page, AT('list'));
  const toggle = page.locator('.toolbar .seg').first();
  await expect(toggle.getByRole('link', { name: 'List' })).toHaveClass(/on/);

  await toggle.getByRole('link', { name: 'Calendar' }).click();
  await expect(page).toHaveURL(/view=month/);
  await expect(
    page.locator('.toolbar .seg').first().getByRole('link', { name: 'Calendar' }),
  ).toHaveClass(/on/);

  // Back the other way, from the same single toggle.
  await page.locator('.toolbar .seg').first().getByRole('link', { name: 'List' }).click();
  await expect(page).toHaveURL(/view=list/);
});

test('the Month / Week / Day switch appears only inside Calendar (§3.1)', async ({ page }) => {
  await openAsAdmin(page, AT('list'));
  await expect(page.getByRole('link', { name: 'Week', exact: true })).toHaveCount(0);

  await openAsAdmin(page, AT('month'));
  for (const view of ['Month', 'Week', 'Day']) {
    await expect(page.getByRole('link', { name: view, exact: true })).toBeVisible();
  }
});

test('the arrows step a month, a week or a day, per view (§3.1)', async ({ page }) => {
  await openAsAdmin(page, AT('month'));
  await expect(page.locator('.datenav .lbl')).toHaveText('September 2026');
  await page.getByLabel('Next period').click();
  await expect(page.locator('.datenav .lbl')).toHaveText('October 2026');
  await page.getByLabel('Previous period').click();
  await expect(page.locator('.datenav .lbl')).toHaveText('September 2026');

  await openAsAdmin(page, AT('week'));
  await expect(page.locator('.datenav .lbl')).toHaveText('Mon 14 Sep – Sun 20 Sep 2026');
  await page.getByLabel('Next period').click();
  await expect(page.locator('.datenav .lbl')).toHaveText('Mon 21 Sep – Sun 27 Sep 2026');

  await openAsAdmin(page, AT('day'));
  await expect(page.locator('.datenav .lbl')).toHaveText('Fri 18 Sep 2026');
  await page.getByLabel('Next period').click();
  await expect(page.locator('.datenav .lbl')).toHaveText('Sat 19 Sep 2026');
});

test('past events are browsable in List too, not only in Calendar (§3.1)', async ({ page }) => {
  await openAsAdmin(page, AT('list'));
  await expect(page.locator('.datenav .lbl')).toHaveText('September 2026');
  await page.getByLabel('Previous period').click();
  await expect(page.locator('.datenav .lbl')).toHaveText('August 2026');
  await expect(page).toHaveURL(/view=list/);
});

test('the month grid runs Monday to Sunday and dims the neighbours (§3.1)', async ({ page }) => {
  await openAsAdmin(page, AT('month'));
  const heads = page.locator('.cal .dh');
  await expect(heads).toHaveCount(7);
  await expect(heads.first()).toHaveText('Mon');
  await expect(heads.last()).toHaveText('Sun');

  // September 2026 starts on a Tuesday, so Monday 31 August leads the grid.
  await expect(page.locator('.cal .day').first()).toHaveClass(/other/);
  await expect(page.locator('.cal .day').first()).toContainText('31');
});

test('the week view is seven day columns, not a time grid (§3.1)', async ({ page }) => {
  await openAsAdmin(page, AT('week'));
  await expect(page.locator('.wk .col')).toHaveCount(7);
  await expect(page.locator('.wk .col').first()).toContainText('Mon 14');
  await expect(page.locator('.wk .col').last()).toContainText('Sun 20');
});

test('+ New event sits in the header in every view (§3.1)', async ({ page }) => {
  for (const view of ['list', 'month', 'week', 'day']) {
    await openAsAdmin(page, AT(view));
    const button = page.locator('.topbar').getByRole('link', { name: '+ New event' });
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute('href', '/events/new');
  }
});

test('Today returns to the current period from anywhere', async ({ page }) => {
  await openAsAdmin(page, AT('month', '2020-01-15'));
  await expect(page.locator('.datenav .lbl')).toHaveText('January 2020');
  await page.getByRole('link', { name: 'Today' }).click();
  await expect(page.locator('.datenav .lbl')).not.toHaveText('January 2020');
});

test('every view keeps the filters in the URL, so a view is a link', async ({ page }) => {
  await openAsAdmin(page, `${AT('list')}&status=upcoming`);
  await expect(page.getByLabel('Filter by status')).toHaveValue('upcoming');

  // Switching view keeps the filter rather than silently dropping it.
  await page.locator('.toolbar .seg').first().getByRole('link', { name: 'Calendar' }).click();
  await expect(page).toHaveURL(/status=upcoming/);
});
