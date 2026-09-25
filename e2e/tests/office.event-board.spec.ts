import { expect, test } from '@playwright/test';
import { openAsAdmin } from './_support/session';

/**
 * Event board — Scope §3.3, wireframes/backoffice/event-board.html.
 *
 * The board needs a real event to render, and CI's Supabase carries the
 * seeded ones. Where there is no project the loader returns null and the
 * route 404s, so these skip rather than assert against a page that cannot
 * exist. The counting, the pool-visibility rule and the no-show window are
 * covered by board.test.ts either way.
 */

/** Gala Dinner, from supabase/seed.sql — three roles at different times. */
const GALA = '60000000-0000-4000-8000-000000000001';

test.beforeEach(async ({ page }) => {
  await openAsAdmin(page, `/events/${GALA}`);
  test.skip(
    (await page.locator('h1').count()) === 0 || (await page.title()).includes('404'),
    'No seeded event: this environment has no Supabase project.',
  );
});

test('the board shows the event and keeps both client policies visible (§3.2, §3.3)', async ({
  page,
}) => {
  await expect(page.getByRole('heading', { name: 'Event' })).toBeVisible();
  await expect(page.getByText('Break policy')).toBeVisible();
  await expect(page.getByText('Buffer policy')).toBeVisible();
});

test('role sections read in start order, like the running order of the day (§3.3)', async ({
  page,
}) => {
  // Gala Dinner: Chef 07:00, Kitchen Porter 09:00, Waiting Staff 17:00.
  const headings = page.locator('.panel-h h3');
  await expect(headings.nth(1)).toContainText('Chef');
  await expect(headings.nth(2)).toContainText('Kitchen Porter');
  await expect(headings.nth(3)).toContainText('Waiting Staff');
});

test('the section header counts confirmed, not invited (§3.3)', async ({ page }) => {
  // "N confirmed · M invited · K open of H" — the H is headcount, never
  // headcount + buffer.
  await expect(
    page.getByText(/\d+ confirmed · \d+ invited · \d+ open of \d+/).first(),
  ).toBeVisible();
});

test('the buffer is shown absolute, never collapsed into the total (§3.2)', async ({ page }) => {
  // Kitchen Porter is 3 (+1) in the seed; the header must not read "4".
  await expect(page.getByText('3 (+1)').first()).toBeVisible();
});

test('there is no Confirm button — the worker confirms in the app (§3.3)', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
  await expect(page.getByText('the worker confirms in the app').first()).toBeVisible();
});

test('Cancel event demands a reason before it will run (§3.3)', async ({ page }) => {
  await page.getByRole('button', { name: 'Cancel event' }).first().click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // Mandatory reason, the same pattern as a manual Block (§9.6).
  await expect(dialog.getByRole('button', { name: 'Cancel event' })).toBeDisabled();

  await dialog.getByLabel('Reason').fill('Client cancelled — postponed to Q1');
  await expect(dialog.getByRole('button', { name: 'Cancel event' })).toBeEnabled();

  // Say what it does before doing it: the bookings, the pushes and auto-assign.
  await expect(dialog).toContainText('N12');
  await expect(dialog).toContainText('auto-assign stops');
  await dialog.getByRole('button', { name: 'Keep the event' }).click();
  await expect(dialog).toBeHidden();
});
