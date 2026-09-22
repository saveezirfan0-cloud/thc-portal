import { expect, test } from '@playwright/test';

/**
 * The public application form (§2.1), on the device candidates actually use:
 * the staff project runs these against a Pixel 7 viewport.
 *
 * What is NOT here: a submission that reaches the database. That needs a
 * Supabase project, which does not exist yet (docs/04 step 2), so the round
 * trip beyond the server action is covered by `supabase/tests/120_apply.sql`
 * instead — including the duplicate check, which by design produces exactly
 * the same screen as a new application and so could not be told apart here.
 */
/** `yyyy-mm-dd` for someone who turns `age` today, offset by whole days. */
function dobForAge(age: number, offsetDays = 0): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - age);
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test.describe('/apply', () => {
  test('is public and shows the §2.1 fields', async ({ page }) => {
    await page.goto('/apply');

    await expect(page.getByRole('heading', { name: 'Apply to work with us' })).toBeVisible();
    for (const label of ['First name', 'Surname', 'Email', 'Mobile', 'Date of birth']) {
      await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByText('You must be 18 or over to work with us.')).toBeVisible();

    // No app chrome: this is a public page, not a screen of the PWA (§2.1).
    await expect(page.getByRole('link', { name: 'Shifts' })).toHaveCount(0);
  });

  test('will not submit until consent is given (§1.7)', async ({ page }) => {
    await page.goto('/apply');
    const submit = page.getByRole('button', { name: 'Submit application' });

    await page.getByLabel('First name', { exact: true }).fill('Amara');
    await page.getByLabel('Surname', { exact: true }).fill('Kalu');
    await page.getByLabel('Email', { exact: true }).fill('amara.kalu@example.com');
    await page.getByLabel('Mobile', { exact: true }).fill('7010 000123');
    await page.getByLabel('Date of birth', { exact: true }).fill(dobForAge(24));
    await expect(submit).toBeDisabled();

    await page.getByRole('checkbox').check();
    await expect(submit).toBeEnabled();
  });

  test('rejects under 18 on the form (§2.1)', async ({ page }) => {
    await page.goto('/apply');
    const submit = page.getByRole('button', { name: 'Submit application' });

    await page.getByLabel('First name', { exact: true }).fill('Too');
    await page.getByLabel('Surname', { exact: true }).fill('Young');
    await page.getByLabel('Email', { exact: true }).fill('too.young@example.com');
    await page.getByLabel('Mobile', { exact: true }).fill('7010 000124');
    await page.getByRole('checkbox').check();

    // A day short of eighteen. Consent is given and every other field is
    // valid, so the age alone is what holds the button. The server and the
    // database check it again (ADR-0008).
    await page.getByLabel('Date of birth', { exact: true }).fill(dobForAge(18, 1));
    await expect(submit).toBeDisabled();

    // Eighteen exactly, today. The boundary belongs to the applicant.
    await page.getByLabel('Date of birth', { exact: true }).fill(dobForAge(18));
    await expect(submit).toBeEnabled();
  });

  test('the confirmation screen names Willo and nothing else (§2.7, §2.12)', async ({ page }) => {
    await page.goto('/apply/submitted');

    await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();
    await expect(page.getByText('Willo (interview invitation)')).toBeVisible();
    // A returning applicant sees this same screen, so nothing on it may hint
    // at an existing record (§2.12).
    await expect(page.getByText(/already|existing|returning|blocked/i)).toHaveCount(0);
  });
});
