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

    // Eighteen exactly, today. The boundary belongs to the applicant.
    await page.getByLabel('Date of birth', { exact: true }).fill(dobForAge(18));
    await expect(submit).toBeEnabled();
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

    // Without a project the action says so on the page instead of throwing a
    // 500 (apps/staff/app/apply/actions.ts), and there is no database for a
    // submission to reach. Skip on that exact sentence rather than on a URL
    // or a timeout: with a project wired up it can never appear, so this
    // cannot quietly swallow a real regression in CI, which does have one.
    //
    // Waiting on either outcome first is what makes the check honest. The
    // submit goes through a server action, so at the moment of the click
    // neither has happened yet and an immediate read would find no message,
    // not skip, and fail here exactly as it did before the guard.
    const failure = page.getByText('this environment has no Supabase project');
    const confirmation = page.getByRole('heading', { name: 'Check your inbox' });
    await expect(failure.or(confirmation)).toBeVisible();
    test.skip(
      await failure.isVisible(),
      'No Supabase project: the submission has nowhere to land.',
    );

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
