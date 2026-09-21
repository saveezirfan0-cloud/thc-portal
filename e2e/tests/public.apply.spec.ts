import { expect, test, type Page } from '@playwright/test';

/**
 * The public application form (§2.1) and the confirmation screen (§2.7,
 * §2.12), on a phone viewport because that is where applicants are.
 *
 * Wireframe: `wireframes/public/apply.html`.
 *
 * These write to the database, so they run against the server Playwright
 * starts with NEXT_PUBLIC_SUPABASE_* set (see playwright.config.ts). With
 * no local Supabase stack there is nothing to submit to, and they skip.
 */
const configured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

/**
 * Unique per run. The duplicate check matches on email AND on mobile
 * (§2.12), so both have to be fresh or the second test in a run is a
 * returning applicant by accident. The clock separates runs, the random
 * tail separates tests inside one.
 */
function freshEmail(tag: string): string {
  return `e2e.${tag}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@apply.test`;
}

/** Ofcom's 07700 900000–900999 range, reserved for fiction. */
function freshMobile(): string {
  const tail = String(Math.floor(Math.random() * 100)).padStart(2, '0');
  return `7700 9${String(Date.now()).slice(-3)}${tail}`;
}

async function fill(page: Page, over: { email: string; mobile?: string; age?: string }) {
  await page.getByLabel('First name').fill('Amara');
  await page.getByLabel('Surname').fill('Kalu');
  await page.getByLabel('Email', { exact: true }).fill(over.email);
  await page.getByLabel('Mobile', { exact: true }).fill(over.mobile ?? freshMobile());
  await page.getByLabel('Age').selectOption(over.age ?? '22');
  await page.getByRole('checkbox').check();
}

test.describe('public /apply', () => {
  test('serves the §2.1 form with no shell, no sidebar and no login', async ({ page }) => {
    await page.goto('/apply');

    await expect(page.getByRole('heading', { name: 'Apply to work with us' })).toBeVisible();
    for (const field of ['First name', 'Surname', 'Email', 'Mobile', 'Age']) {
      await expect(page.getByLabel(field, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole('checkbox')).not.toBeChecked();
    await expect(page.getByText('You must be 18 or over to work with us.')).toBeVisible();

    // No app chrome: this page exists before there is an account.
    await expect(page.getByRole('link', { name: 'Shifts' })).toHaveCount(0);
  });

  test('refuses an under-18 on the form, before anything is submitted', async ({ page }) => {
    await page.goto('/apply');
    await fill(page, { email: freshEmail('under18'), age: 'under_18' });

    // "On the spot": the error and the disabled button appear on selection.
    await expect(page.getByText('You must be 18 or over to apply')).toBeVisible();
    const submit = page.getByRole('button', { name: 'Submit application' });
    await expect(submit).toBeDisabled();

    await expect(page).toHaveURL(/\/apply$/);
  });

  test('refuses an under-18 again on the server when the form is tampered with', async ({
    page,
  }) => {
    test.skip(!configured, 'needs a Supabase project — run `supabase start` and export its env');

    await page.goto('/apply');
    const email = freshEmail('tampered');
    await fill(page, { email });

    // Change the select in the DOM without telling React, so the form
    // believes it is valid and posts 'under_18' anyway. This is the §1.7
    // "and on the backend" half of the age gate.
    await page.evaluate(() => {
      const select = document.querySelector<HTMLSelectElement>('select[name="ageBand"]');
      if (!select) throw new Error('no age select on the page');
      const option = document.createElement('option');
      option.value = 'under_18';
      select.appendChild(option);
      select.value = 'under_18';
    });

    await page.getByRole('button', { name: 'Submit application' }).click();

    await expect(page.getByText('You must be 18 or over to apply')).toBeVisible();
    await expect(page).toHaveURL(/\/apply$/);
    await expect(page.getByRole('heading', { name: 'Check your inbox' })).toHaveCount(0);
  });

  test('will not submit without the GDPR tick (§1.7)', async ({ page }) => {
    await page.goto('/apply');
    await fill(page, { email: freshEmail('consent') });
    await page.getByRole('checkbox').uncheck();

    await page.getByRole('button', { name: 'Submit application' }).click();

    await expect(
      page.getByText(
        "Please tick the box to continue — we can't process your application without your consent",
      ),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/apply$/);
  });

  test('a valid application lands on "Check your inbox"', async ({ page }) => {
    test.skip(!configured, 'needs a Supabase project — run `supabase start` and export its env');

    const email = freshEmail('new');
    await page.goto('/apply');
    await fill(page, { email });
    await page.getByRole('button', { name: 'Submit application' }).click();

    await expect(page).toHaveURL(/\/apply\/submitted$/);
    await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByText('Willo (interview invitation)')).toBeVisible();

    // The card echoes the address; the URL must not (§1.7). A live email
    // in a GET lands in browser history, access logs and Referer.
    expect(page.url()).not.toContain(email.split('@')[0]);
  });

  // This drives the "applied twice" case, because a browser cannot set a
  // worker to blocked or inactive first. What it proves is the part
  // §2.12 cares about on this side of the screen: a matched applicant is
  // shown the ordinary confirmation and nothing else. Which queue the
  // office sees them in — returning applicant vs duplicate submission —
  // is asserted in supabase/tests/070_applications.sql, where the
  // lifecycle states can actually be set up.
  test('a matched applicant sees exactly the same screen, never the reason (§2.12)', async ({
    page,
  }) => {
    test.skip(!configured, 'needs a Supabase project — run `supabase start` and export its env');

    const email = freshEmail('repeat');
    const mobile = freshMobile();
    const card = page.locator('.auth-card');

    await page.goto('/apply');
    await fill(page, { email, mobile });
    await page.getByRole('button', { name: 'Submit application' }).click();
    await expect(page).toHaveURL(/\/apply\/submitted/);
    const firstTime = await card.innerText();

    // The same person again. The office gets a "returning applicant"
    // entry naming the existing record; the applicant gets this, and the
    // strongest way to say "exactly this" is that the two screens are the
    // same text, to the character.
    await page.goto('/apply');
    await fill(page, { email, mobile });
    await page.getByRole('button', { name: 'Submit application' }).click();

    await expect(page).toHaveURL(/\/apply\/submitted/);
    await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();
    expect(await card.innerText()).toBe(firstTime);
    await expect(page.getByText(email)).toBeVisible();
  });
});
