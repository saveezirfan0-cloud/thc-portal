import { expect, test, type Page } from '@playwright/test';
import {
  NEW_PASSWORD,
  OFFICE_URL,
  SEEDED_ADMIN_NAME,
  acceptInviteLink,
  appUnconfigured,
  inviteFromUsers,
  inviteUnavailable,
  removeLogin,
  unique,
} from './_support/accounts';
import { sql, lit } from './_support/db';

/**
 * /users — inviting a Back Office login, and switching it off again
 * (ADR-0055 §1–§5, §1.4, §1.7).
 *
 * The whole life of an office login, as two people:
 *
 *   the manager    (Gisela, the seeded admin) invites a new colleague on
 *                  /users and reads the set-up link from the modal;
 *   the invitee    opens it in a browser of their own, chooses a password
 *                  and lands on /dashboard, signed in;
 *   the manager    switches the login off, with a reason;
 *   the invitee    can no longer sign in — the one refusal the sign-in
 *                  screen gives for everything (§1.4);
 *   /activity      names the manager against "Invited user" and
 *                  "Switched login off", both about the invitee.
 *
 * Needs the CI stack: psql on 54322, and NEXT_PUBLIC_SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY in the Back Office's environment (the key
 * mints the login, ADR-0055 §2). Skipped, with the reason, without them.
 */

const SIGN_IN_REFUSED = 'Email or password is incorrect. Try again or reset your password.';

let inviteeEmail: string | null = null;

test.beforeEach(async ({ page }) => {
  const missing = inviteUnavailable();
  test.skip(missing !== null, missing ?? undefined);
  test.skip(
    await appUnconfigured(page, `${OFFICE_URL}/login`),
    'No Supabase project: the Back Office refuses to serve.',
  );
});

test.afterEach(() => {
  removeLogin(inviteeEmail);
  inviteeEmail = null;
});

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto(`${OFFICE_URL}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('invite → set a password → /dashboard; switched off → cannot sign in; both on /activity', async ({
  page,
  browser,
}) => {
  const tag = unique();
  const invitee = {
    role: 'admin' as const,
    fullName: `Wren Invitee ${tag}`,
    email: `e2e.office-invite.${tag}@example.test`,
    jobTitle: 'Scheduler',
  };
  inviteeEmail = invitee.email;

  const link =
    await test.step('the manager invites a Back Office user and reads the link', async () => {
      const setUp = await inviteFromUsers(page, invitee);
      // On the Back Office's own origin, carrying a token and nothing that
      // could steer where it lands (ADR-0055 §3).
      expect(setUp).toMatch(
        new RegExp(
          `^${OFFICE_URL.replace(/\./g, '\\.')}/auth/invite\\?token=[A-Za-z0-9_-]{32,200}$`,
        ),
      );
      // The login exists and is the kind the manager chose — written by
      // admin_register_account as the manager, not by the service key.
      expect(
        sql(
          `select p.role || '|' || p.full_name || '|' || coalesce(p.job_title, '') || '|' ||
                coalesce(u.raw_app_meta_data ->> 'role', '')
           from auth.users u join profiles p on p.id = u.id
          where lower(u.email) = lower(${lit(invitee.email)})`,
        ),
      ).toBe(`admin|${invitee.fullName}|Scheduler|admin`);
      return setUp;
    });

  await test.step('the row is on the Back Office tab as Invited, not yet used', async () => {
    await page.getByRole('searchbox', { name: 'Search users' }).fill(invitee.email);
    const row = page.locator('.users-table tbody tr', { hasText: invitee.email });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(invitee.fullName);
    await expect(row).toContainText('Invited');
    await expect(row.getByRole('button', { name: 'New invite link' })).toBeVisible();
  });

  await test.step('the invitee opens the link in their own browser and chooses a password', async () => {
    const own = await acceptInviteLink(browser, link);
    try {
      await expect(own.page).toHaveURL(`${OFFICE_URL}/dashboard`);
      await expect(own.page.locator('.signed-in-as').first()).toContainText(invitee.fullName);
    } finally {
      await own.context.close();
    }
  });

  await test.step('the manager switches that login off, with a reason', async () => {
    await page.reload();
    await page.getByRole('searchbox', { name: 'Search users' }).fill(invitee.email);
    const row = page.locator('.users-table tbody tr', { hasText: invitee.email });
    // Used once, so it is Active and gets no new link (ADR-0055 §3a).
    await expect(row).toContainText('Active');
    await expect(row.getByRole('button', { name: 'New invite link' })).toHaveCount(0);

    await row.getByRole('button', { name: 'Switch off' }).click();
    const confirm = page.getByRole('dialog', { name: `Switch off ${invitee.fullName}?` });
    await expect(confirm).toBeVisible();
    const button = confirm.getByRole('button', { name: 'Switch off' });
    // No reason, no switch: it goes in the activity log.
    await expect(button).toBeDisabled();
    await confirm.getByLabel('Reason', { exact: true }).fill('E2E: left THC');
    await button.click();
    await expect(confirm).toBeHidden();
    await expect(row).toContainText('Switched off');
    await expect(row.getByRole('button', { name: 'Switch on' })).toBeVisible();
  });

  await test.step('the invitee can no longer sign in', async () => {
    const context = await browser.newContext();
    try {
      const fresh = await context.newPage();
      await signIn(fresh, invitee.email, NEW_PASSWORD);
      await expect(fresh.getByText(SIGN_IN_REFUSED)).toBeVisible();
      await expect(fresh).toHaveURL(/\/login/);
    } finally {
      await context.close();
    }
  });

  await test.step('/activity names the manager against both, about the invitee', async () => {
    await page.goto(`${OFFICE_URL}/activity?q=${encodeURIComponent(invitee.fullName)}&period=24h`);
    await expect(page.getByRole('heading', { name: 'Activity log' })).toBeVisible();
    const rows = page.locator('.activity-table tbody tr');

    for (const action of ['Invited user', 'Switched login off']) {
      const row = rows.filter({ has: page.locator('.cell-title b', { hasText: action }) });
      await expect(row, action).toHaveCount(1);
      await expect(row.locator('.activity-who')).toContainText(SEEDED_ADMIN_NAME);
      await expect(row).toContainText('Users & access');
      await expect(row.locator('td[data-label="Record"]')).toContainText(invitee.fullName);
    }
    // Newest first: the switch came after the invite.
    await expect(rows.first()).toContainText('Switched login off');
    await expect(
      rows.filter({ hasText: 'Switched login off' }).locator('.activity-details'),
    ).toContainText('Reason: E2E: left THC');
  });
});
