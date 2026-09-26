import { expect, test } from '@playwright/test';
import {
  CLIENT_URL,
  OFFICE_URL,
  SEEDED_CLIENT,
  acceptInviteLink,
  appUnconfigured,
  inviteFromUsers,
  inviteUnavailable,
  removeLogin,
  unique,
} from './_support/accounts';
import { lit, sql } from './_support/db';

/**
 * A Client Portal login, invited from the Back Office (ADR-0049 §1–§3,
 * §1.4, §11.1).
 *
 * The manager invites someone at Leonardo Hotel St Pauls on the Back
 * Office's /users; the link the modal shows is on the CLIENT PORTAL's
 * origin, not the office's; the invitee opens it there, chooses a
 * password and lands on /client — the portal's only home — already
 * seeing their own company's events.
 *
 * Runs in the `client` project (baseURL :3002) and drives the Back Office
 * on :3000 by absolute URL, so it needs both servers, as
 * playwright.config.ts starts them. The office builds the link from
 * NEXT_PUBLIC_CLIENT_URL; `next start` is production, where the office
 * refuses to guess it, so playwright.config.ts sets it on the office
 * server to this project's origin.
 *
 * Needs the CI stack: psql on 54322, and NEXT_PUBLIC_SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY in the Back Office's environment. Skipped,
 * with the reason, without them.
 */

let inviteeEmail: string | null = null;

test.beforeEach(async ({ page }) => {
  const missing = inviteUnavailable();
  test.skip(missing !== null, missing ?? undefined);
  test.skip(
    (await appUnconfigured(page, `${OFFICE_URL}/login`)) ||
      (await appUnconfigured(page, `${CLIENT_URL}/login`)),
    'No Supabase project: the Back Office or the Client Portal refuses to serve.',
  );
});

test.afterEach(() => {
  removeLogin(inviteeEmail);
  inviteeEmail = null;
});

test('invite a Client Portal user → the link opens on the portal → password → /client', async ({
  page,
  browser,
}) => {
  const tag = unique();
  const invitee = {
    role: 'client' as const,
    fullName: `Linnet Client ${tag}`,
    email: `e2e.client-invite.${tag}@example.test`,
    clientName: SEEDED_CLIENT.name,
  };
  inviteeEmail = invitee.email;

  const link = await test.step('the manager invites them for a seeded client', async () => {
    const setUp = await inviteFromUsers(page, invitee);
    expect(setUp).toMatch(
      new RegExp(`^${CLIENT_URL.replace(/\./g, '\\.')}/auth/invite\\?token=[A-Za-z0-9_-]{32,200}$`),
    );
    // Tied to that client, as a client login — the portal's views filter on it.
    expect(
      sql(
        `select p.role || '|' || coalesce(p.client_id::text, '') || '|' ||
                coalesce(u.raw_app_meta_data ->> 'role', '')
           from auth.users u join profiles p on p.id = u.id
          where lower(u.email) = lower(${lit(invitee.email)})`,
      ),
    ).toBe(`client|${SEEDED_CLIENT.id}|client`);
    return setUp;
  });

  await test.step('the row is on the Client Portal tab with its client', async () => {
    await page
      .getByRole('button', { name: /^Client Portal/ })
      .first()
      .click();
    await page.getByRole('searchbox', { name: 'Search users' }).fill(invitee.email);
    const row = page.locator('.users-table tbody tr', { hasText: invitee.email });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(SEEDED_CLIENT.name);
    await expect(row).toContainText('Invited');
  });

  await test.step('the invitee sets a password on the portal and lands on /client', async () => {
    const own = await acceptInviteLink(browser, link);
    try {
      await expect(own.page).toHaveURL(`${CLIENT_URL}/client`);
      // Their own company's events: Leonardo's Gala Dinner is upcoming
      // in the seed (client.portal.spec.ts has the rest of §11.1).
      await expect(own.page.getByText('Gala Dinner').first()).toBeVisible();
    } finally {
      await own.context.close();
    }
  });
});
