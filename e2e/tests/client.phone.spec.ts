import { expect, test, type Page } from '@playwright/test';
import { openAsClient } from './_support/session';

/**
 * The Client Portal on a phone — §1.2, §11.1 (wireframes/client/events.html,
 * "Phone · 390px").
 *
 * The client project runs at desktop size, so nothing else in the suite
 * sees the cards that replace the table below 820px. This file runs at
 * 390×844 with a touch screen, signed in as the seeded client contact
 * (Marco V., Leonardo Hotel St Pauls), and holds the two promises the
 * wireframe makes for that width: each card carries every field the table
 * row does — nothing is dropped on the phone — and nothing makes the page
 * wider than the phone, which would zoom it out and leave the bar and the
 * cards short of the right edge.
 */
test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

/** Same rule as client.portal.spec.ts: a 503 is an app with no Supabase project. */
async function skipUnlessServing(page: Page): Promise<void> {
  const response = await page.goto('/client');
  test.skip(response?.status() === 503, 'No Supabase project: the Client Portal refuses to serve.');
}

/** The page is no wider than the phone: no sideways scroll anywhere. */
async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, 'document wider than the viewport').toBeLessThanOrEqual(innerWidth);
}

test.beforeEach(async ({ page }) => {
  await skipUnlessServing(page);
});

test('the list is cards, not a table, and every card carries every field (§11.1, §1.2)', async ({
  page,
}) => {
  await openAsClient(page, '/client?tab=all');
  await expect(page.getByRole('heading', { name: 'Your events', exact: true })).toBeVisible();

  await expect(page.locator('table.tbl')).toBeHidden();
  const cards = page.locator('.cards .ecard');
  // Marco's two seeded events: the Gala Dinner and the Lunch Service.
  await expect(cards.first()).toBeVisible();
  const count = await cards.count();
  expect(count).toBeGreaterThanOrEqual(2);

  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    const cancelled = ((await card.getAttribute('class')) ?? '').includes('cancelled');

    // Status · date · window.
    await expect(card.locator('.when .pill')).toBeVisible();
    await expect(card.locator('.when .win b')).toHaveText(/^\w{3} \d{1,2} \w{3} \d{4}$/);
    await expect(card.locator('.when .win')).toContainText('UK time');
    // Name, venue and PO.
    await expect(card.locator('.t')).toBeVisible();
    await expect(card.locator('.t')).not.toBeEmpty();
    await expect(card.locator('.m')).toContainText('PO ');
    // "N of M confirmed" and the faces — not on a cancelled event, which
    // has no line-up left to show.
    if (!cancelled) {
      await expect(card.locator('.ev-fill')).toContainText(/\d+ of \d+ confirmed/);
      await expect(card.locator('.ev-fill .avatars')).toBeVisible();
    }
    // The document and the way into the event.
    const foot = card.locator('.foot');
    await expect(foot).toBeVisible();
    await expect(foot.getByRole('link', { name: 'Details →' })).toBeVisible();
    await expect(
      foot.locator('a.btn, button.btn, .muted').filter({ hasText: /Timesheet|No document/ }),
    ).toBeVisible();

    // Inside the phone's width, not cut off its right edge.
    const box = await card.boundingBox();
    expect(box, 'card has a box').not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  }

  await expectNoSidewaysScroll(page);
});

test('no page in the portal scrolls sideways on a phone (§1.2)', async ({ page }) => {
  await openAsClient(page, '/client');
  await expectNoSidewaysScroll(page);

  for (const tab of ['past', 'all']) {
    await page.goto(`/client?tab=${tab}`);
    await expectNoSidewaysScroll(page);
  }

  // The first event's page: header card, role sections, feedback buttons.
  await page.goto('/client?tab=all');
  const details = page.locator('.cards .ecard').first().getByRole('link', { name: 'Details →' });
  await details.click();
  await expect(page).toHaveURL(/\/client\/events\/[0-9a-f-]{36}$/);
  await expect(page.locator('.ehead h1')).toBeVisible();
  await expectNoSidewaysScroll(page);

  await page.goto('/client/account');
  await expectNoSidewaysScroll(page);
});

test('the account menu opens as a panel ending on Account and Sign out, equal and full width', async ({
  page,
}) => {
  await openAsClient(page, '/client');
  await page.getByRole('button', { name: 'Account menu' }).click();
  const menu = page.locator('#client-account');
  await expect(menu).toBeVisible();

  const account = menu.getByRole('link', { name: 'Account' });
  const signOut = menu.getByRole('button', { name: 'Sign out' });
  await expect(account).toBeVisible();
  await expect(signOut).toBeVisible();
  const [a, s] = [await account.boundingBox(), await signOut.boundingBox()];
  expect(a && s, 'both buttons have a box').toBeTruthy();
  expect(Math.round(a!.width)).toBe(Math.round(s!.width));
  expect(a!.height).toBeGreaterThanOrEqual(44);
  expect(s!.height).toBeGreaterThanOrEqual(44);

  await expectNoSidewaysScroll(page);
});

test('the filters survive a reload because they live in the address bar', async ({ page }) => {
  await openAsClient(page, '/client');
  await page.getByRole('button', { name: /^Past/ }).click();
  await expect(page).toHaveURL(/[?&]tab=past/);
  await page.getByPlaceholder('Search events').fill('lunch');
  await expect(page).toHaveURL(/[?&]q=lunch/);

  await page.reload();
  await expect(page.getByPlaceholder('Search events')).toHaveValue('lunch');
  await expect(page.getByRole('button', { name: /^Past/ })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Clear filters' }).first().click();
  await expect(page).not.toHaveURL(/[?&]q=/);
});
