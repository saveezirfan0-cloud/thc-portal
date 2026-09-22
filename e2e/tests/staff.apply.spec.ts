import { expect, test } from '@playwright/test';

/**
 * The public application form (§2.1), on the device candidates actually use:
 * the staff project runs these against a Pixel 7 viewport.
 *
 * A submission that reaches the database is covered too: CI brings up the
 * local Supabase stack and points the apps at it, so the server action, the
 * RPC and the redirect are all real here. What this file still cannot do is
 * tell a new application from a returning one — §2.12 requires both to
 * produce exactly the same screen — so which branch the duplicate check took
 * is asserted in `supabase/tests/120_apply.sql`, where the outcome column is
 * visible.
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

    // A dead button is not an explanation. The wireframe's behaviour note is
    // "under 18 is rejected on the spot — coral error on the form", and
    // because the button is disabled there is no first submit to reveal it,
    // so the error has to appear without one. Asserting only toBeDisabled()
    // above is how that went unnoticed.
    await expect(page.getByText('You must be 18 or over to apply')).toBeVisible();

    // Eighteen exactly, today. The boundary belongs to the applicant.
    await page.getByLabel('Date of birth', { exact: true }).fill(dobForAge(18));
    await expect(submit).toBeEnabled();
    await expect(page.getByText('You must be 18 or over to apply')).toHaveCount(0);
  });

  test('says why the button is dead when consent is taken back (§1.7)', async ({ page }) => {
    await page.goto('/apply');
    const submit = page.getByRole('button', { name: 'Submit application' });
    const consent = page.getByRole('checkbox');

    await page.getByLabel('First name', { exact: true }).fill('Amara');
    await page.getByLabel('Surname', { exact: true }).fill('Kalu');
    await page.getByLabel('Email', { exact: true }).fill('amara.kalu@example.com');
    await page.getByLabel('Mobile', { exact: true }).fill('7010 000125');
    await page.getByLabel('Date of birth', { exact: true }).fill(dobForAge(24));

    // Untouched: the form has no business telling anyone off yet.
    await expect(page.getByText('Please tick the box to continue', { exact: false })).toHaveCount(
      0,
    );

    await consent.check();
    await expect(submit).toBeEnabled();

    // Taken back. Same problem as the age gate — the button dies and, before
    // this, nothing said why.
    await consent.uncheck();
    await expect(submit).toBeDisabled();
    await expect(page.getByText('Please tick the box to continue', { exact: false })).toBeVisible();
  });

  test('a complete application reaches the database and lands on the confirmation (§2.1)', async ({
    page,
  }) => {
    // Fresh on both arms of the §2.12 duplicate check, so this is a new
    // candidate rather than a returning applicant. The screen is identical
    // either way by design; what is being proved here is that the server
    // action, the RPC and the redirect all ran for real.
    const unique = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const email = `e2e.apply.${unique}@example.test`;

    await page.goto('/apply');
    await page.getByLabel('First name', { exact: true }).fill('Amara');
    await page.getByLabel('Surname', { exact: true }).fill('Kalu');
    await page.getByLabel('Email', { exact: true }).fill(email);
    // Ofcom's 07010 range is reserved for drama, so it can never collide
    // with a real worker or with supabase/seed.sql.
    await page.getByLabel('Mobile', { exact: true }).fill(`7010 ${unique.slice(-6)}`);
    await page.getByLabel('Date of birth', { exact: true }).fill(dobForAge(24));
    await page.getByRole('checkbox').check();

    await page.getByRole('button', { name: 'Submit application' }).click();

    await expect(page).toHaveURL(/\/apply\/submitted$/);
    await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();
    // Echoed from the cookie the action set, which only exists if the
    // submission got past the RPC.
    await expect(page.getByText(email)).toBeVisible();

    // §1.7: the address travels in a cookie, never in the URL, where it
    // would land in history and access logs.
    expect(page.url()).not.toContain(unique);
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
