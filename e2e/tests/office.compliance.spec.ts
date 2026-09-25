import { expect, test } from '@playwright/test';
import { openAsAdmin } from './_support/session';

/**
 * Compliance — Scope §4.1–§4.5, wireframes/backoffice/compliance.html, the
 * three states docs/08 lists: Needs review · Reject modal · Radar. The seed
 * carries three pending documents and one expired passport, so the queue
 * and the radar both have rows in CI. Where there is no project the loader
 * reports a problem and the tabs read 0, so these skip rather than assert
 * against an empty screen. The queue's ordering and the CSV's rows are
 * pinned in queue.test.ts and auditCsv.test.ts; this is the screen.
 */

test.beforeEach(async ({ page }) => {
  await openAsAdmin(page, '/compliance');
  test.skip(
    (await page.locator('table.tbl tbody tr').count()) === 0,
    'No seeded compliance queue: this environment has no Supabase project.',
  );
});

test('the Needs review badge counts the rows the office has to act on (§4.1)', async ({ page }) => {
  const tab = page.getByRole('tab', { name: /Needs review/ });
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  const badge = Number((await tab.locator('.n').textContent())?.trim());
  expect(Number.isInteger(badge) && badge > 0).toBe(true);
  await expect(page.locator('table.tbl tbody tr')).toHaveCount(badge);

  // Every row offers Verify; the office never sees an item it cannot act on.
  await expect(
    page.locator('table.tbl tbody tr').first().getByRole('button').first(),
  ).toBeVisible();
});

test('Reject opens a modal that is disabled until a reason is typed (§4.1, N8)', async ({
  page,
}) => {
  const reject = page.locator('table.tbl tbody tr').getByRole('button', { name: 'Reject' }).first();
  await reject.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole('button', { name: /^Reject (document|declaration)$/ });
  await expect(confirm).toBeDisabled();

  await dialog.getByLabel(/Reason/).fill('Photo page is cut off');
  await expect(confirm).toBeEnabled();

  // Close without sending: the seed stays as it was for the other specs.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
});

test('Radar shows the three counters and the expired / expiring filter (§4.2, §4.3)', async ({
  page,
}) => {
  await page.getByRole('tab', { name: /Radar/ }).click();
  const radar = page.getByRole('region', { name: 'Radar' });
  await expect(radar.getByText('Expired · blocking')).toBeVisible();
  await expect(radar.getByText('Expiring · ≤ 30 days')).toBeVisible();
  await expect(radar.getByText('Term letters · expire 31 Dec')).toBeVisible();

  const filter = radar.getByRole('group', { name: 'Filter the radar' });
  await expect(filter.getByRole('button', { name: /All/ })).toHaveAttribute('aria-pressed', 'true');
  await filter.getByRole('button', { name: /Expired/ }).click();
  await expect(filter.getByRole('button', { name: /Expired/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // Jonah Whitfield's passport expired 19 days ago in the seed (§4.3).
  await expect(radar.getByText('Jonah Whitfield').first()).toBeVisible();
});

test('the audit export is a CSV with the AC7 header row (completion letter req. §4)', async ({
  page,
}) => {
  // page.request shares the signed-in context's cookies, so this is the
  // office's own download and not an anonymous GET.
  const response = await page.request.get('/compliance/export');
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-type']).toMatch(/^text\/csv/);
  expect(response.headers()['content-disposition']).toMatch(/^attachment; filename="/);

  const [header] = (await response.text()).split(/\r?\n/);
  expect(header).toMatch(/^Recorded at \(UK\),Record,Event,Employee ID,Worker,By,/);
});
