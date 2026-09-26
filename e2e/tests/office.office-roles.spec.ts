import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  OFFICE_URL,
  acceptInviteLink,
  appUnconfigured,
  inviteFromUsers,
  inviteUnavailable,
  pickOfficeRole,
  removeLogin,
  unique,
} from './_support/accounts';
import { lit, sql } from './_support/db';

/**
 * Office roles — owner, manager, scheduler (ADR-0050).
 *
 * Not `office.roles.spec.ts`: that name was taken by Roles & rates (§9.8),
 * the catalogue of worker roles and their pay. This one is about who in
 * the Back Office may open what.
 *
 * Three people, each in a browser of their own:
 *
 *   the owner      Gisela, the seeded admin (every admin at migration time
 *                  became an owner, and the insert trigger makes the seed's
 *                  an owner too). She invites the other two on /users with
 *                  the role picker, and later changes one of them.
 *   a scheduler    has no Reports, Roles, Settings or Users & access in the
 *                  menu; those four pages, opened by URL, say "Not available
 *                  for your role"; the dashboard has no financial snapshot
 *                  and no margin.
 *   a manager      has Reports and Roles, not Settings or Users & access.
 *
 * Then the owner makes the scheduler a manager, and the scheduler's menu
 * follows on the next page load — no sign-out (ADR-0050: office_can reads
 * profiles live).
 *
 * The menu and "Not available" are presentation; the database refuses
 * regardless (pgTAP 741). What a browser alone can show is that the screens
 * agree with it.
 *
 * Selectors are by href, role and label: /users is gaining another role
 * and another row action in parallel work, and neither should break this.
 *
 * Needs the CI stack — psql on 54322 and NEXT_PUBLIC_SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY for the invite (ADR-0049 §2). Skipped, with the
 * reason, without them.
 */

const NOT_AVAILABLE = 'Not available for your role';

/** Menu roots each role must not see (permissions.ts ROUTE_PERMISSION). */
const OWNER_ONLY = ['/settings', '/users'] as const;
const FINANCE = ['/reports', '/roles'] as const;

let invited: string[] = [];

test.beforeEach(async ({ page }) => {
  const missing = inviteUnavailable();
  test.skip(missing !== null, missing ?? undefined);
  test.skip(
    await appUnconfigured(page, `${OFFICE_URL}/login`),
    'No Supabase project: the Back Office refuses to serve.',
  );
});

test.afterEach(() => {
  for (const email of invited) removeLogin(email);
  invited = [];
});

/** The sidebar's link to a section, by its href (the label may carry a counter). */
function menuLink(page: Page, href: string) {
  return page.locator(`.sidebar nav a[href="${href}"]`);
}

async function expectMenu(page: Page, shown: readonly string[], hidden: readonly string[]) {
  // Always there for any Back Office login: the menu has rendered at all.
  await expect(menuLink(page, '/dashboard')).toHaveCount(1);
  await expect(menuLink(page, '/events')).toHaveCount(1);
  for (const href of shown) await expect(menuLink(page, href), `${href} shown`).toHaveCount(1);
  for (const href of hidden) await expect(menuLink(page, href), `${href} hidden`).toHaveCount(0);
}

/** The owner invites one Back Office login with this role; it sets a password. */
async function inviteAndAccept(page: Page, browser: Browser, officeRole: 'Manager' | 'Scheduler') {
  const tag = unique();
  const invitee = {
    role: 'admin' as const,
    fullName: `${officeRole === 'Manager' ? 'Heron' : 'Plover'} ${officeRole} ${tag}`,
    email: `e2e.office-role.${officeRole.toLowerCase()}.${tag}@example.test`,
    officeRole,
  };
  invited.push(invitee.email);
  const link = await inviteFromUsers(page, invitee);
  // Written by admin_register_account's six-argument form, as the owner chose.
  expect(
    sql(
      `select p.office_role from auth.users u join profiles p on p.id = u.id
        where lower(u.email) = lower(${lit(invitee.email)})`,
    ),
  ).toBe(officeRole.toLowerCase());

  const own = await acceptInviteLink(browser, link);
  await expect(own.page).toHaveURL(`${OFFICE_URL}/dashboard`);
  return { ...invitee, ...own };
}

test('a scheduler and a manager see only their sections; a role change follows on reload (ADR-0050)', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);

  const scheduler = await test.step('the owner invites a scheduler, who sets a password', () =>
    inviteAndAccept(page, browser, 'Scheduler'));
  const manager = await test.step('the owner invites a manager, who sets a password', () =>
    inviteAndAccept(page, browser, 'Manager'));

  try {
    await test.step('the owner has every section', async () => {
      await page.goto(`${OFFICE_URL}/dashboard`);
      await expectMenu(page, [...FINANCE, ...OWNER_ONLY], []);
    });

    await test.step("the scheduler's menu has no Reports, Roles, Settings or Users & access", async () => {
      await scheduler.page.goto(`${OFFICE_URL}/dashboard`);
      await expectMenu(
        scheduler.page,
        ['/staff', '/clients', '/compliance'],
        [...FINANCE, ...OWNER_ONLY],
      );
    });

    await test.step('opened by URL, those four pages say "Not available for your role"', async () => {
      for (const path of [...FINANCE, ...OWNER_ONLY]) {
        await scheduler.page.goto(`${OFFICE_URL}${path}`);
        // The page answers — not a redirect to /login, not an error page.
        await expect(scheduler.page, path).toHaveURL(`${OFFICE_URL}${path}`);
        await expect(scheduler.page.getByText(NOT_AVAILABLE, { exact: true }), path).toBeVisible();
        await expect(scheduler.page.getByText(/signed in as a Scheduler/), path).toBeVisible();
      }
      // A section the role may use shows no such thing.
      await scheduler.page.goto(`${OFFICE_URL}/events`);
      await expect(scheduler.page.getByText(NOT_AVAILABLE)).toHaveCount(0);
    });

    await test.step("the scheduler's dashboard has no financial snapshot and no margin", async () => {
      const dash = scheduler.page;
      await dash.goto(`${OFFICE_URL}/dashboard`);
      // The dashboard itself is theirs: the four operational KPIs and the
      // short-staffed panel (no money on it, ADR-0053) are drawn.
      await expect(dash.locator('.tilegrid .kpi')).toHaveCount(4);
      await expect(dash.locator('.panel', { hasText: 'Upcoming events' })).toBeVisible();

      await expect(
        dash.locator('.panel', { hasText: 'This week · financial snapshot' }),
      ).toHaveCount(0);
      await expect(dash.getByText('Gross margin')).toHaveCount(0);
      await expect(dash.getByText(/Chargeable|Payable \(incl/)).toHaveCount(0);
      await expect(dash.getByRole('link', { name: 'Full report →' })).toHaveCount(0);
      // The ten-day list: no margin in its header, and no "+£9.40/h" on any role.
      await expect(dash.getByText(/margin\/h/)).toHaveCount(0);
      await expect(dash.getByText(/[+−-]£\d+\.\d{2}\/h/)).toHaveCount(0);
    });

    await test.step('the manager has Reports and Roles, not Settings or Users & access', async () => {
      await manager.page.goto(`${OFFICE_URL}/dashboard`);
      await expectMenu(manager.page, FINANCE, OWNER_ONLY);
      // …and the money a scheduler does not see.
      await expect(
        manager.page.locator('.panel', { hasText: 'This week · financial snapshot' }),
      ).toBeVisible();

      await manager.page.goto(`${OFFICE_URL}/reports`);
      await expect(manager.page.getByText(NOT_AVAILABLE)).toHaveCount(0);
      for (const path of OWNER_ONLY) {
        await manager.page.goto(`${OFFICE_URL}${path}`);
        await expect(manager.page.getByText(NOT_AVAILABLE, { exact: true }), path).toBeVisible();
        await expect(manager.page.getByText(/signed in as a Manager/), path).toBeVisible();
      }
    });

    await test.step('the owner makes the scheduler a manager on /users', async () => {
      await page.goto(`${OFFICE_URL}/users`);
      await expect(page.getByRole('heading', { name: 'Users & access' })).toBeVisible();
      await page.getByRole('searchbox', { name: 'Search users' }).fill(scheduler.email);
      const row = page.locator('.users-table tbody tr', { hasText: scheduler.email });
      await expect(row).toHaveCount(1);
      await expect(row.locator('td[data-label="Office role"]')).toHaveText('Scheduler');

      await row.getByRole('button', { name: 'Change role' }).click();
      // "Change <name>'s role" — the apostrophe is typographic, so by pattern.
      const dialog = page.getByRole('dialog', { name: /^Change .+ role$/ });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(scheduler.fullName);
      const confirm = dialog.getByRole('button', { name: 'Change role' });
      // Nothing to save while the role is the one it already has.
      await expect(confirm).toBeDisabled();
      await pickOfficeRole(dialog.getByLabel('Office role', { exact: true }), 'Manager');
      await confirm.click();
      await expect(dialog).toBeHidden();
      await expect(row.locator('td[data-label="Office role"]')).toHaveText('Manager');
      expect(
        sql(
          `select p.office_role from auth.users u join profiles p on p.id = u.id
            where lower(u.email) = lower(${lit(scheduler.email)})`,
        ),
      ).toBe('manager');
    });

    await test.step("the former scheduler's menu follows after a reload, still signed in", async () => {
      await scheduler.page.goto(`${OFFICE_URL}/dashboard`);
      await expect(scheduler.page).toHaveURL(`${OFFICE_URL}/dashboard`);
      await expectMenu(scheduler.page, FINANCE, OWNER_ONLY);
      await expect(
        scheduler.page.locator('.panel', { hasText: 'This week · financial snapshot' }),
      ).toBeVisible();
      await scheduler.page.goto(`${OFFICE_URL}/reports`);
      await expect(scheduler.page.getByText(NOT_AVAILABLE)).toHaveCount(0);
    });
  } finally {
    await scheduler.context.close();
    await manager.context.close();
  }
});
