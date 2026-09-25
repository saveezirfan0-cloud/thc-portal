import { expect, test } from '@playwright/test';
import { openAsAdmin } from './_support/session';
import { databaseUnreachable, lit, sql } from './_support/db';

/**
 * Onboarding pipeline — Scope §2.2, §2.12, wireframes/backoffice/onboarding.html
 * (BO3), states Active / Rejected from docs/08.
 *
 * The board needs the seeded candidates (supabase/seed.sql spreads forty
 * workers across the whole `staff_status` enum; Oscar Bennett is the one
 * `rejected`). Where there is no project the loader returns nothing and the
 * six columns are empty, so the tests skip on an empty board rather than
 * assert against a screen that cannot exist. The filtering itself is pinned
 * in view-model.test.ts; this is the screen.
 */

const REJECTED = {
  first: 'Oscar',
  last: 'Bennett',
  email: 'oscar.bennett@example.com',
  phone: '+44 7700 900126',
  dob: '2000-03-03',
};

test.beforeEach(async ({ page }) => {
  await openAsAdmin(page, '/onboarding');
  test.skip(
    (await page.locator('.kcard').count()) === 0,
    'No seeded candidates: this environment has no Supabase project.',
  );
});

test('the toggle swaps the six columns to the rejected view, with its own filter (§2.2)', async ({
  page,
}) => {
  const toggle = page.getByRole('group', { name: 'Active or rejected candidates' });
  await expect(toggle.getByRole('button', { name: /Active/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // Active view: the role filter, no reason filter.
  await expect(page.getByLabel('Role')).toBeVisible();
  await expect(page.getByLabel('Reason')).toHaveCount(0);

  await toggle.getByRole('button', { name: /Rejected/ }).click();
  await expect(page.getByLabel('Reason')).toHaveValue('any');
  await expect(page.getByLabel('Reason').locator('option', { hasText: 'Any reason' })).toHaveCount(
    1,
  );
  await expect(page.getByLabel('Role')).toHaveCount(0);

  // Rejected cards sit in the column they were rejected from; the other
  // columns say so in the rejected view's own words.
  await expect(page.getByText('Nothing rejected at this stage').first()).toBeVisible();
  await expect(page.getByText('Nobody at this stage')).toHaveCount(0);
  await expect(page.getByText('Rejection is final on this record')).toBeVisible();
});

test('a card opens the candidate profile from the keyboard (Enter)', async ({ page }) => {
  const card = page.locator('.kcard[role="button"]').first();
  await card.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/onboarding\/[0-9a-f-]{36}$/);
});

test.describe('a returning applicant (§2.12)', () => {
  // A second /apply from the seeded rejected candidate, matched on email +
  // DOB, becomes a Returning applicant card and never a second record. The
  // public form's own function is used so the row is exactly what the
  // office sees in production (the per-caller wrapper adds only the
  // throttle, which a seeding call has no business spending).
  test.beforeAll(() => {
    const unreachable = databaseUnreachable();
    test.skip(unreachable !== null, unreachable ?? undefined);
    sql(
      `select public.submit_application(${lit(REJECTED.first)}, ${lit(REJECTED.last)}, ` +
        `${lit(REJECTED.email)}, ${lit(REJECTED.phone)}, ${lit(REJECTED.dob)}::date, true)`,
    );
  });

  test.afterAll(() => {
    if (databaseUnreachable() !== null) return;
    sql(
      `delete from public.applications where lower(email) = ${lit(REJECTED.email)} ` +
        `and outcome = 'returning_applicant' and resolved_at is null`,
    );
  });

  test('no second record: the card names the existing one and offers Reset or Reject', async ({
    page,
  }) => {
    await page.reload();
    const card = page.locator('.kcard.returning', { hasText: 'Returning applicant' }).first();
    await expect(card).toBeVisible();
    await expect(card).toContainText(`${REJECTED.first} ${REJECTED.last}`);
    await expect(card).toContainText('No second record was created');
    await expect(card.getByRole('button', { name: 'Reset to candidate' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Reject' })).toBeVisible();

    // A role filter hides it: a returning applicant has no roles yet, and
    // the filter is "candidates for this role", not "everything".
    const role = page.getByLabel('Role');
    await role.selectOption({ index: 1 });
    await expect(page.locator('.kcard.returning')).toHaveCount(0);
    await role.selectOption('');
    await expect(page.locator('.kcard.returning').first()).toBeVisible();
  });

  test('Reset to candidate asks for a reason and stays disabled until one is typed', async ({
    page,
  }) => {
    await page.reload();
    const card = page.locator('.kcard.returning', { hasText: 'Returning applicant' }).first();
    await card.getByRole('button', { name: 'Reset to candidate' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Same record, same Employee ID');
    const confirm = dialog.getByRole('button', { name: 'Reset to candidate' });
    await expect(confirm).toBeDisabled();

    await dialog.getByLabel(/Reason/).fill('Interviewed again, new references');
    await expect(confirm).toBeEnabled();

    // Nothing is sent: the record stays as the seed left it.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });
});
