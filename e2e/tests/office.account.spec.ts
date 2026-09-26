import { expect, test } from '@playwright/test';
import {
  NEW_PASSWORD,
  OFFICE_URL,
  appUnconfigured,
  createOfficeLogin,
  removeLogin,
  unique,
  type SeededLogin,
} from './_support/accounts';
import { databaseUnreachable, lit, sql } from './_support/db';
import { openAs } from './_support/session';

/**
 * /account — My profile (ADR-0049 §7).
 *
 * A manager renames themself: the sidebar foot, which the root layout
 * reads once for every page, shows the new name straight away, and
 * /activity has "Updated own profile" against it — naming the fields
 * changed, never the values.
 *
 * The login is this spec's own, seeded with psql: renaming the seeded
 * admin would change the name every other office spec runs as, while
 * they run. Needs psql on 54322; skipped, with the reason, without it.
 */

let me: SeededLogin | null = null;

test.beforeEach(async ({ page }) => {
  const missing = databaseUnreachable();
  test.skip(missing !== null, missing ?? undefined);
  test.skip(
    await appUnconfigured(page, `${OFFICE_URL}/login`),
    'No Supabase project: the Back Office refuses to serve.',
  );
  me = createOfficeLogin({
    tag: 'account',
    fullName: `Kestrel Before ${unique()}`,
    password: NEW_PASSWORD,
  });
});

test.afterEach(() => {
  removeLogin(me?.email ?? null);
  me = null;
});

test('editing my name shows it in the sidebar and records "Updated own profile"', async ({
  page,
}) => {
  const renamed = `Kestrel After ${unique()}`;

  await openAs(page, '/account', me!.email, NEW_PASSWORD);
  await expect(page.getByRole('heading', { name: 'My profile' })).toBeVisible();
  const foot = page.locator('.signed-in-as').first();
  await expect(foot).toContainText(me!.fullName);

  await test.step('save a new name', async () => {
    const save = page.getByRole('button', { name: 'Save details' });
    // Nothing to save until something changes.
    await expect(save).toBeDisabled();
    await page.getByLabel('Full name', { exact: true }).fill(renamed);
    await page.getByLabel('Job title', { exact: true }).fill('Night manager');
    await save.click();
    await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
  });

  await test.step('the sidebar names me by the new name, here and on the next page', async () => {
    await expect(foot).toContainText(renamed);
    await expect(foot).not.toContainText(me!.fullName);
    await page.goto('/dashboard');
    await expect(page.locator('.signed-in-as').first()).toContainText(renamed);
    expect(
      sql(
        `select full_name || '|' || coalesce(job_title, '') from profiles where id = ${lit(me!.userId)}`,
      ),
    ).toBe(`${renamed}|Night manager`);
  });

  await test.step('/activity has the edit, by me, with the field names and not the values', async () => {
    await page.goto(`/activity?q=${encodeURIComponent(renamed)}&period=24h`);
    const row = page
      .locator('.activity-table tbody tr')
      .filter({ has: page.locator('.cell-title b', { hasText: 'Updated own profile' }) });
    await expect(row).toHaveCount(1);
    await expect(row.locator('.activity-who')).toContainText(renamed);
    await expect(row).toContainText('Users & access');
    const details = row.locator('.activity-details');
    await expect(details).toContainText('full_name');
    await expect(details).toContainText('job_title');
    await expect(details).not.toContainText('Night manager');
  });
});
