import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { databaseUnreachable, lit, sql } from './_support/db';
import { openAsAdmin } from './_support/session';

/**
 * Roles & rates — Scope §9.8, wireframes/backoffice/roles.html.
 *
 * The screen is apps/office/app/roles: RolesScreen.tsx (the table),
 * RoleModal.tsx (New / Edit), DeleteRoleModal.tsx (the in-use guard) and
 * money.ts (the 12.07%). The figures asserted are supabase/seed.sql's six
 * roles, run through `role_directory_v` (20260921153100_roles_directory.sql):
 *
 *   Waiting Staff  £14.00  +£1.69  £15.69   on 5 client rate cards
 *   Barista        £14.50  +£1.75  £16.25   on 2 client rate cards
 *
 * §9.8 is particular about one thing above all: the holiday element is a
 * permanently visible label beside the base, never blended into it. So each
 * money assertion checks the three columns separately.
 *
 * Nothing here edits or deletes a seeded role — the suite is fully parallel
 * and every other office spec reads them. The one write creates a role with
 * a unique name, deletes it through the screen, and removes it by hand if
 * the test fails half way.
 */

/** A table row, by the role-name button in its first cell (RolesScreen.tsx). */
const roleRow = (page: Page, name: string) =>
  page
    .locator('table.tbl tbody tr')
    .filter({ has: page.getByRole('button', { name, exact: true }) });

/** Skips when the loader reported no project: the table is then an empty state. */
async function skipWithoutRoles(page: Page): Promise<void> {
  test.skip(
    (await page.locator('table.tbl tbody tr').count()) === 0,
    'No seeded roles: this environment has no Supabase project.',
  );
}

test('the catalogue lists the seeded roles with holiday broken out, never blended (§9.8)', async ({
  page,
}) => {
  await openAsAdmin(page, '/roles');
  await expect(page.getByRole('heading', { level: 1, name: 'Roles & rates' })).toBeVisible();
  await skipWithoutRoles(page);

  // The wireframe's seven columns, in its order (RolesScreen.tsx <thead>).
  const headers = page.locator('table.tbl thead th');
  await expect(headers).toHaveText([
    'Role',
    'Description',
    'Staff pay rate ✎',
    'Holiday +12.07%',
    'Final rate',
    'On rate cards',
    'Actions',
  ]);

  // "Holiday pay 12.07% is a permanently visible label, not just a tooltip."
  const panel = page.locator('section.panel', {
    has: page.getByRole('heading', { name: 'Roles', exact: true }),
  });
  await expect(panel.locator('.hol-lbl')).toContainText('Holiday +12.07%');
  await expect(panel.locator('.hol-lbl')).toContainText('calculated, never stored');

  // Base, holiday and final are three cells; the holiday reads as an addition.
  const waiting = roleRow(page, 'Waiting Staff');
  await expect(waiting.locator('td[data-label="Staff pay rate"]')).toHaveText('£14.00');
  await expect(waiting.locator('td.hol')).toHaveText('+£1.69');
  await expect(waiting.locator('td.fin')).toHaveText('£15.69');
  await expect(waiting.locator('td[data-label="On rate cards"]')).toHaveText('5 clients');
  await expect(waiting.locator('td.desc')).toHaveText(
    'Silver service and plated service; bar-back where needed. Minimum 18.',
  );

  const barista = roleRow(page, 'Barista');
  await expect(barista.locator('td[data-label="Staff pay rate"]')).toHaveText('£14.50');
  await expect(barista.locator('td.hol')).toHaveText('+£1.75');
  await expect(barista.locator('td.fin')).toHaveText('£16.25');

  // Every row carries Edit and Delete (§9.8: "Edit / Delete buttons per row").
  await expect(waiting.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  await expect(waiting.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
});

test('New role will not save without a name and a rate to the penny, and Cancel writes nothing (§9.8)', async ({
  page,
}) => {
  // Runs with or without a project: the modal's gate is the form itself.
  await openAsAdmin(page, '/roles');
  await page.locator('.topbar').getByRole('button', { name: '+ New role' }).click();

  const dialog = page.getByRole('dialog', { name: 'New role' });
  await expect(dialog).toBeVisible();
  const create = dialog.getByRole('button', { name: 'Create role' });
  await expect(create).toBeDisabled();

  // A third decimal is refused, not rounded (money.ts parseRate).
  await dialog.getByLabel('Role name').fill('E2E never saved');
  await dialog.getByLabel('Staff pay rate').fill('14.555');
  await expect(dialog.locator('#role-rate-hint')).toHaveText(
    'Enter a rate to the penny, e.g. 14.50.',
  );
  await expect(create).toBeDisabled();

  // A good rate enables it — and the calc strip breaks the holiday out.
  await dialog.getByLabel('Staff pay rate').fill('14.00');
  const calc = (label: string) => dialog.locator('.calc .c', { hasText: label }).locator('.v');
  await expect(calc('Base')).toHaveText('£14.00');
  await expect(calc('Holiday +12.07%')).toHaveText('+£1.69');
  await expect(calc('Final rate')).toHaveText('£15.69');
  await expect(create).toBeEnabled();

  // A blank name disables it again (validate.ts: a role needs a name).
  await dialog.getByLabel('Role name').fill('   ');
  await expect(create).toBeDisabled();

  // §9.8 keeps dress code and charge rate off this form entirely.
  await expect(dialog.getByLabel(/dress code/i)).toHaveCount(0);
  await expect(dialog.getByLabel(/charge rate/i)).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'E2E never saved', exact: true })).toHaveCount(0);
});

test('editing a rate says what it was and which rate cards it moves, and Cancel keeps it (§9.8)', async ({
  page,
}) => {
  await openAsAdmin(page, '/roles');
  await skipWithoutRoles(page);

  await roleRow(page, 'Waiting Staff').getByRole('button', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit role' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Role name')).toHaveValue('Waiting Staff');
  await expect(dialog.getByLabel('Staff pay rate')).toHaveValue('14.00');
  await expect(dialog.getByRole('button', { name: 'Save role' })).toBeEnabled();

  await dialog.getByLabel('Staff pay rate').fill('15.00');
  await expect(dialog.locator('#role-rate-hint')).toContainText('Was £14.00.');
  await expect(dialog.locator('.note')).toContainText('This role is on 5 rate cards');

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(roleRow(page, 'Waiting Staff').locator('td.fin')).toHaveText('£15.69');
});

test('a role on rate cards and events cannot be deleted, and says why (§9.8)', async ({ page }) => {
  await openAsAdmin(page, '/roles');
  await skipWithoutRoles(page);

  await roleRow(page, 'Waiting Staff').getByRole('button', { name: 'Delete', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete role?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('In use — it cannot be deleted yet.')).toBeVisible();
  // DeleteRoleModal.tsx describeUse(): the counts come from the list row.
  await expect(dialog).toContainText('It is on 5 client rate cards and');
  await expect(dialog.getByRole('button', { name: 'Delete role' })).toBeDisabled();

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(roleRow(page, 'Waiting Staff')).toHaveCount(1);
});

test('a new role is created, listed with its three rates, then deleted (§9.8)', async ({
  page,
}) => {
  const unreachable = databaseUnreachable();
  test.skip(unreachable !== null, unreachable ?? '');

  const name = `E2E role ${Date.now()}`;
  try {
    await openAsAdmin(page, '/roles');
    await page.locator('.topbar').getByRole('button', { name: '+ New role' }).click();
    const dialog = page.getByRole('dialog', { name: 'New role' });
    await dialog.getByLabel('Role name').fill(name);
    await dialog.getByLabel('Staff pay rate').fill('12.34');
    await dialog.getByLabel('Description').fill('Made by office.roles.spec.ts');
    await dialog.getByRole('button', { name: 'Create role' }).click();
    await expect(dialog).toBeHidden();

    // 12.34 × 0.1207 = 1.489… → +£1.49; final_rate(12.34) = 13.83 — the
    // database's figures (role_directory_v), shown as three cells.
    const row = roleRow(page, name);
    await expect(row).toHaveCount(1);
    await expect(row.locator('td[data-label="Staff pay rate"]')).toHaveText('£12.34');
    await expect(row.locator('td.hol')).toHaveText('+£1.49');
    await expect(row.locator('td.fin')).toHaveText('£13.83');
    await expect(row.locator('td[data-label="On rate cards"]')).toHaveText('0 clients');
    expect(sql(`select pay_rate from roles where name = ${lit(name)}`)).toBe('12.34');

    // On no rate card and no event, so the guard lets it go.
    await row.getByRole('button', { name: 'Delete', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Delete role?' });
    await expect(confirm).toContainText('safe to delete');
    await confirm.getByRole('button', { name: 'Delete role' }).click();
    await expect(confirm).toBeHidden();
    await expect(roleRow(page, name)).toHaveCount(0);
    expect(sql(`select count(*) from roles where name = ${lit(name)}`)).toBe('0');
  } finally {
    // Best effort: a failure half way must not leave a role behind, and a
    // cleanup that throws must not hide the result that matters.
    try {
      sql(`delete from roles where name = ${lit(name)}`);
    } catch (cause) {
      console.warn(`[e2e] could not remove role ${name}: ${String(cause)}`);
    }
  }
});
