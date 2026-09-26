import { expect, test, type Page } from '@playwright/test';
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
import { nextCode, stepAt, totp, wrongCode } from './_support/totp';

/**
 * Two-step sign-in (ADR-0051).
 *
 * One manager, one authenticator — computed here from the secret the page
 * prints for typing by hand (RFC 6238, _support/totp.ts), exactly what the
 * phone app would compute from the QR code:
 *
 *   /account      Set up → the key → the first code turns it on;
 *   sign out, sign in with the password → /login/verify, not /dashboard;
 *   at the code step, every other page sends you back to it — /dashboard,
 *                 and /users with `next` carried;
 *   a wrong code  is refused, and you stay on the step;
 *   the right code lands on /dashboard, signed in.
 *
 * The login is this spec's own (seeded with psql, an owner by the insert
 * trigger, ADR-0050): two-step on the seeded admin would put every other
 * office spec behind a code while they run. Needs psql on 54322 and a
 * Supabase stack with TOTP on (supabase/config.toml [auth.mfa.totp]);
 * skipped, with the reason, without the database.
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
    tag: 'two-step',
    fullName: `Avocet Twostep ${unique()}`,
    password: NEW_PASSWORD,
  });
});

test.afterEach(() => {
  // auth.mfa_factors and the challenges go with the auth.users row.
  removeLogin(me?.email ?? null);
  me = null;
});

/** /login/verify, with or without a `next`. */
const AT_CODE_STEP = /\/login\/verify(\?.*)?$/;

function factorStatus(userId: string): string {
  return sql(
    `select coalesce(string_agg(status::text, ',' order by created_at), '')
       from auth.mfa_factors where user_id = ${lit(userId)}`,
  );
}

async function signInWithPassword(page: Page, email: string): Promise<void> {
  await page.goto(`${OFFICE_URL}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('set up on /account; then the password alone stops at the code step until the right code (ADR-0051)', async ({
  page,
}) => {
  // The sign-in code must come from a later 30-second step than the set-up
  // code, so the test may wait up to one step for it.
  test.setTimeout(120_000);

  await openAs(page, '/account', me!.email, NEW_PASSWORD);
  await expect(page.getByRole('heading', { name: 'My profile' })).toBeVisible();
  const panel = page.locator('section.panel', {
    has: page.getByRole('heading', { name: 'Two-step sign-in', exact: true }),
  });

  const { secret, setupStep } =
    await test.step('set up: read the key, type the first code', async () => {
      await expect(panel.getByText('Off', { exact: true })).toBeVisible();
      await panel.getByLabel('Which phone is it on?', { exact: true }).fill('E2E phone');
      await panel.getByRole('button', { name: 'Set up two-step sign-in' }).click();

      // The QR code and, for typing by hand, the same secret in groups of four.
      await expect(panel.getByRole('img', { name: /QR code/ })).toBeVisible();
      const grouped = (await panel.getByLabel('Set-up key', { exact: true }).innerText()).trim();
      expect(grouped).toMatch(/^[A-Z2-7]{1,4}( [A-Z2-7]{1,4})+$/);
      const key = grouped.replace(/\s+/g, '');
      // Not on until the first code: an unfinished factor is unverified.
      expect(factorStatus(me!.userId)).toBe('unverified');

      const now = Date.now();
      await panel.getByLabel('6-digit code', { exact: true }).fill(totp(key, now));
      await panel.getByRole('button', { name: 'Turn on two-step sign-in' }).click();

      await expect(panel.getByText('On', { exact: true })).toBeVisible();
      await expect(panel).toContainText('E2E phone');
      await expect(panel.getByRole('button', { name: 'Remove' })).toBeVisible();
      expect(factorStatus(me!.userId)).toBe('verified');
      return { secret: key, setupStep: stepAt(now) };
    });

  await test.step('sign out', async () => {
    await page.locator('.sidebar').getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  await test.step('the password alone lands on the code step, not the dashboard', async () => {
    await signInWithPassword(page, me!.email);
    await expect(page).toHaveURL(AT_CODE_STEP);
    await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible();
    await expect(page.getByLabel('6-digit code', { exact: true })).toBeVisible();
  });

  await test.step('at the code step, opening a page sends you back to it', async () => {
    // With `next` carried, so the right code would land where you were going.
    await page.goto(`${OFFICE_URL}/users`);
    await expect(page).toHaveURL(`${OFFICE_URL}/login/verify?next=%2Fusers`);
    // The default landing is left off the URL.
    await page.goto(`${OFFICE_URL}/dashboard`);
    await expect(page).toHaveURL(`${OFFICE_URL}/login/verify`);
    await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible();
    await expect(page.locator('.sidebar')).toHaveCount(0);
  });

  await test.step('a wrong code is refused, and you stay on the step', async () => {
    await page.getByLabel('6-digit code', { exact: true }).fill(wrongCode(secret));
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText(/That code did not match/)).toBeVisible();
    await expect(page).toHaveURL(AT_CODE_STEP);
    // Still not through: the dashboard still sends you back.
    await page.goto(`${OFFICE_URL}/dashboard`);
    await expect(page).toHaveURL(`${OFFICE_URL}/login/verify`);
  });

  await test.step('the right code lands on /dashboard, signed in', async () => {
    const { code } = await nextCode(secret, setupStep);
    await page.getByLabel('6-digit code', { exact: true }).fill(code);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(`${OFFICE_URL}/dashboard`);
    await expect(page.locator('.signed-in-as').first()).toContainText(me!.fullName);
    // And it holds: the next page is not sent back to the code step.
    await page.goto(`${OFFICE_URL}/account`);
    await expect(page).toHaveURL(`${OFFICE_URL}/account`);
  });
});
