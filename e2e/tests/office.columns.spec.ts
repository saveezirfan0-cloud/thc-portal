import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { databaseUnreachable, lit, sql } from './_support/db';
import { openAs, openAsAdmin } from './_support/session';

/**
 * The column chooser (ADR-0139, release audit package F): show / hide and
 * reorder a list's columns, remembered per person in
 * `profiles.list_columns` (20261014193000, pgTAP 839).
 *
 * Every change here is made as the seeded second owner, ops@, whom no other
 * spec signs in as — the chooser is per person, so Gisela's lists, which
 * office.venues.spec and the others read in parallel, never move. ops@'s
 * choices are cleared before and after.
 */
const OPS = 'ops@thehospitalitycompany.example';

test.describe.configure({ mode: 'serial' });

function clearOps(): void {
  sql(
    `update profiles set list_columns = '{}'::jsonb
      where id = (select id from auth.users where email = ${lit(OPS)})`,
  );
}

function opsColumns(): string {
  return sql(
    `select coalesce(list_columns -> 'venues', 'null'::jsonb)::text from profiles
      where id = (select id from auth.users where email = ${lit(OPS)})`,
  );
}

test.beforeAll(() => {
  if (!databaseUnreachable()) clearOps();
});
test.afterAll(() => {
  if (!databaseUnreachable()) clearOps();
});

const heads = (page: Page) => page.locator('table.tbl thead th');
const dialog = (page: Page) => page.getByRole('dialog', { name: /^Columns · Venues/ });
const tick = (page: Page, name: string) =>
  dialog(page)
    .locator('label.check')
    .filter({ hasText: new RegExp(`^${name}`) });

async function openVenues(page: Page): Promise<void> {
  const reason = databaseUnreachable();
  test.skip(reason !== null, reason ?? '');
  await openAs(page, '/venues', OPS);
  await expect(page.locator('table.tbl tbody tr').first()).toBeVisible();
}

const DEFAULT = [
  'Venue',
  'Address',
  'Type',
  'Geofence (m)',
  'Events',
  'Date added',
  'Added by',
  'Actions',
];

test('hides and reorders a column, says so, and keeps Venue first and Actions last', async ({
  page,
}) => {
  await openVenues(page);
  await expect(heads(page)).toHaveText(DEFAULT);

  const button = page.locator('.colchooser-btn');
  await expect(button).toHaveAccessibleName('Columns — 8 of 8 shown');
  await button.click();
  await expect(dialog(page)).toBeVisible();
  await expect(tick(page, 'Venue').locator('input')).toBeDisabled();
  await expect(tick(page, 'Actions').locator('input')).toBeDisabled();

  await tick(page, 'Address').click();
  await expect(page.locator('.colchooser-live')).toHaveText('Column Address hidden');
  await page.getByRole('button', { name: 'Move Geofence (m) up' }).click();
  await expect(page.locator('.colchooser-live')).toHaveText(
    'Geofence (m) moved to position 2 of 6',
  );
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(button).toBeFocused();
  await expect(button).toHaveAccessibleName('Columns — 7 of 8 shown');

  await expect(heads(page)).toHaveText([
    'Venue',
    'Geofence (m)',
    'Type',
    'Events',
    'Date added',
    'Added by',
    'Actions',
  ]);
  // Saved a moment after the last change, and never into the URL.
  await expect.poll(opsColumns).toContain('"hidden": ["address"]');
  expect(new URL(page.url()).search).toBe('');
});

test('a reload paints the saved columns from the server — no flash of the defaults', async ({
  page,
}) => {
  await openVenues(page);
  // The HTML as the server sends it, before any script runs.
  const html = await (await page.request.get('/venues')).text();
  const thead = /<thead>([\s\S]*?)<\/thead>/.exec(html)?.[1] ?? '';
  expect(thead).not.toContain('>Address<');
  expect(thead.indexOf('Geofence (m)')).toBeLessThan(thead.indexOf('>Type<'));
  await expect(heads(page).nth(1)).toHaveText('Geofence (m)');
});

test('the choice is per person: Gisela still sees every column', async ({ page }) => {
  const reason = databaseUnreachable();
  test.skip(reason !== null, reason ?? '');
  await openAsAdmin(page, '/venues');
  await expect(page.locator('table.tbl tbody tr').first()).toBeVisible();
  await expect(heads(page)).toHaveText(DEFAULT);
});

test('works from the keyboard alone: Alt+Arrow moves, Space ticks, Escape returns', async ({
  page,
}) => {
  await openVenues(page);
  const button = page.locator('.colchooser-btn');
  await button.focus();
  await page.keyboard.press('Enter');
  // Focus lands on the first column that can change: Address, hidden above.
  const address = tick(page, 'Address').locator('input');
  await expect(address).toBeFocused();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.locator('.colchooser-live')).toHaveText('Address moved to position 2 of 6');
  // Focus stays on the control that moved.
  await expect(address).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.locator('.colchooser-live')).toHaveText('Column Address shown');
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await expect(button).toBeFocused();
  // Closing the dialog saves at once — leaving the page straight away loses nothing.
  await expect.poll(opsColumns).toContain('"hidden": []');
  await expect(heads(page)).toHaveText([
    'Venue',
    'Geofence (m)',
    'Address',
    'Type',
    'Events',
    'Date added',
    'Added by',
    'Actions',
  ]);
});

test('on a phone the same choice decides what a venue card shows, in that order', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openVenues(page);
  const card = page.locator('table.tbl tbody tr').first();
  const labels = () =>
    card.locator('td[data-label]').evaluateAll((tds) => tds.map((td) => td.dataset['label']));
  expect(await labels()).toEqual([
    'Geofence (m)',
    'Address',
    'Type',
    'Events',
    'Date added',
    'Added by',
  ]);

  await page.locator('.colchooser-btn').click();
  // A sheet from the bottom, its targets finger-sized.
  const box = await page.locator('.colchooser-pop').boundingBox();
  expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(844);
  const move = dialog(page).getByRole('button', { name: 'Move Type up' });
  expect((await move.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await tick(page, 'Added by').click();
  await expect.poll(labels).not.toContain('Added by');

  await dialog(page).getByRole('button', { name: 'Reset to default' }).click();
  await expect(page.locator('.colchooser-live')).toHaveText('Columns reset to default');
  await dialog(page).getByRole('button', { name: 'Done' }).click();
  expect(await labels()).toEqual([
    'Address',
    'Type',
    'Geofence (m)',
    'Events',
    'Date added',
    'Added by',
  ]);
  await expect.poll(opsColumns).toBe('null');
});
