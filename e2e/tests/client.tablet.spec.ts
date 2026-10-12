import { expect, test, type Page } from '@playwright/test';
import { openAsClient } from './_support/session';

/**
 * The Client Portal on a tablet — §1.2, §11.1 (wireframes/client/events.html:
 * "Tablet (768–1024px) — the desktop table stays, with the Venue column
 * folded under the event name").
 *
 * Between the phone's cards (≤820px) and a laptop the list is still the
 * table, folded to four columns (event · date and status · confirmed and
 * faces · document). Before the fold the Document column — the download
 * the customer comes for — sat off the panel's right edge behind a sideways
 * scroller at 821–1099px. This holds the fold: at 1024×1366 every row's
 * download and "Details →" are on screen, and nothing scrolls sideways.
 */
test.use({ viewport: { width: 1024, height: 1366 } });

/** Same rule as client.portal.spec.ts: a 503 is an app with no Supabase project. */
async function skipUnlessServing(page: Page): Promise<void> {
  const response = await page.goto('/client');
  test.skip(response?.status() === 503, 'No Supabase project: the Client Portal refuses to serve.');
}

test.beforeEach(async ({ page }) => {
  await skipUnlessServing(page);
});

test('every row’s document and Details sit inside the viewport at 1024px (§11.1, §1.2)', async ({
  page,
}) => {
  await openAsClient(page, '/client?tab=all');
  await expect(page.locator('table.tbl')).toBeVisible();
  await expect(page.locator('.cards')).toBeHidden();

  // Folded: the Venue and Line-up columns and the Status column are gone,
  // their contents shown under the name, the fill bar and the date.
  await expect(page.locator('th', { hasText: 'Document' })).toBeVisible();
  await expect(page.locator('th.col-venue')).toBeHidden();
  await expect(page.locator('th.col-lineup')).toBeHidden();
  await expect(page.locator('th.col-status')).toBeHidden();

  // The table fits its scroller: nothing to scroll sideways to.
  const scroller = page.locator('.ev-table');
  const { scrollWidth, clientWidth } = await scroller.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(scrollWidth, 'table wider than its panel').toBeLessThanOrEqual(clientWidth);

  // Horizontal bounds only: the lower rows are below a 1366px fold, and
  // scrolling them into view could also scroll the table sideways and hide
  // the very fault this looks for.
  const panel = await scroller.boundingBox();
  expect(panel, 'scroller has a box').not.toBeNull();
  const right = Math.min(1024, panel!.x + panel!.width);

  const rows = page.locator('.ev-table tbody tr');
  const count = await rows.count();
  expect(count).toBeGreaterThanOrEqual(2);
  for (let i = 0; i < count; i++) {
    const cell = rows.nth(i).locator('td').last();
    const controls = cell.locator('a, button');
    const n = await controls.count();
    expect(n, 'a Document cell has at least its Details link').toBeGreaterThanOrEqual(1);
    for (let j = 0; j < n; j++) {
      const box = await controls.nth(j).boundingBox();
      expect(box, 'control has a box').not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(panel!.x);
      expect(box!.x + box!.width).toBeLessThanOrEqual(right);
    }
  }

  // The download itself, named as ADR-0074 names it, the first row's in
  // full view.
  const download = page
    .locator('.ev-table tbody td:last-child')
    .getByRole('link', { name: /Allocation Timesheet|Completed Timesheet/ })
    .first();
  const box = await download.boundingBox();
  expect(box, 'a live download is listed').not.toBeNull();
  expect(box!.x + box!.width).toBeLessThanOrEqual(right);

  const page_ = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(page_.scrollWidth, 'document wider than the viewport').toBeLessThanOrEqual(
    page_.innerWidth,
  );
});
