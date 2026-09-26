import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { databaseUnreachable, lit, sql } from './_support/db';
import { openAsAdmin } from './_support/session';

/**
 * Clients — Scope §9.7, wireframes/backoffice/clients.html and
 * client-card.html.
 *
 * The directory is apps/office/app/clients (ClientsScreen.tsx,
 * ClientModal.tsx); the card is clients/[id] (ClientCard.tsx, RateCard.tsx,
 * ClientEvents.tsx). Leonardo Hotel St Pauls is the client asserted on, as
 * supabase/seed.sql writes it:
 *
 *   Marco V. · +44 20 7074 1000 · "Banqueting Manager, Cathedral Suite"
 *   events@leonardo-stpauls.example + ops@… · breaks paid · buffer paid
 *   rate card  Bar Staff, Chef, Host, Kitchen Porter, Waiting Staff
 *              Waiting Staff £22.97 charge − £15.69 final = +£7.28/h, 31.7%
 *   events     Gala Dinner (next Friday, PO 4471-A), Lunch Service
 *
 * §9.7 says a client can be edited at any time and never deleted, so the
 * screen has no Delete and neither does the database. The one write here
 * creates a uniquely named client and takes it out again with psql.
 */

const LEONARDO = '40000000-0000-4000-8000-000000000001';
const GALA = '60000000-0000-4000-8000-000000000001';

/** A directory row, by the link on the client's name (ClientsScreen.tsx). */
const clientRow = (page: Page, name: string) =>
  page.locator('table.tbl tbody tr').filter({ has: page.getByRole('link', { name, exact: true }) });

/** One of the card's four numbered blocks, by its heading (ClientCard.tsx and friends). */
const block = (page: Page, title: RegExp) =>
  page.locator('section.panel', { has: page.getByRole('heading', { name: title }) });

test('the directory lists the seeded clients with contact, rate-card roles and policies (§9.7)', async ({
  page,
}) => {
  await openAsAdmin(page, '/clients');
  await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible();
  test.skip(
    (await page.locator('table.tbl tbody tr').count()) === 0,
    'No seeded clients: this environment has no Supabase project.',
  );

  await expect(page.locator('table.tbl thead th')).toHaveText([
    'Client',
    'Contact',
    'Phone',
    'Rate card roles',
    'Policies',
    'Events',
    'Avg margin',
  ]);

  // Search narrows the directory to one row, whatever else earlier runs
  // may have added, so the pagination (eight a page) cannot hide it.
  await page.getByLabel('Search client, contact, email').fill('Leonardo');
  const leonardo = clientRow(page, 'Leonardo Hotel St Pauls');
  await expect(page.locator('table.tbl tbody tr')).toHaveCount(1);
  await expect(leonardo.getByRole('link')).toHaveAttribute('href', `/clients/${LEONARDO}`);
  await expect(leonardo.locator('td.name .sub')).toHaveText('Banqueting Manager, Cathedral Suite');
  await expect(leonardo.locator('td[data-label="Contact"]')).toContainText('Marco V.');
  // Two addresses, shown as the first "+1" (describeEmails).
  await expect(leonardo.locator('td[data-label="Contact"] .sub')).toHaveText(
    'events@leonardo-stpauls.example +1',
  );
  await expect(leonardo.locator('td[data-label="Phone"]')).toHaveText('+44 20 7074 1000');
  await expect(leonardo.locator('td[data-label="Rate card roles"] .chip')).toHaveText([
    'Bar Staff',
    'Chef',
    'Host',
    'Kitchen Porter',
    'Waiting Staff',
  ]);
  await expect(leonardo.locator('td[data-label="Policies"]')).toHaveText(
    'Breaks: paid · Buffer: paid',
  );

  // The other policy wording: ExCeL pays for neither (seed.sql).
  await page.getByLabel('Search client, contact, email').fill('ExCeL');
  await expect(clientRow(page, 'ExCeL London').locator('td[data-label="Policies"]')).toHaveText(
    'Breaks: unpaid · Buffer: strict',
  );

  // §9.7: never deleted — there is no Delete on this screen at all.
  await expect(page.getByRole('button', { name: /Delete/ })).toHaveCount(0);
});

test('New client asks for every field and refuses a bad email; Cancel writes nothing (§9.7)', async ({
  page,
}) => {
  // Runs with or without a project: the modal gates itself.
  await openAsAdmin(page, '/clients');
  await page.locator('.topbar').getByRole('button', { name: '+ New client' }).click();

  const dialog = page.getByRole('dialog', { name: 'New client' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('all fields mandatory')).toBeVisible();
  const create = dialog.getByRole('button', { name: 'Create client' });
  await expect(create).toBeDisabled();

  await dialog.getByLabel('Client name').fill('E2E never saved');
  await dialog.getByLabel('Contact full name').fill('Robin Test');
  await dialog.getByLabel('Contact phone').fill('+44 20 7946 0000');
  await dialog.getByLabel('Staff contact point').fill('Front desk');
  // Every field but the emails: still not enough.
  await expect(create).toBeDisabled();

  // Enter adds the address — and refuses one that is not an address
  // (ClientModal.tsx addEmail, the same wording as validate.ts).
  const emails = dialog.getByLabel('Contact emails');
  await emails.fill('not-an-email');
  await emails.press('Enter');
  await expect(dialog.locator('.alert')).toHaveText('“not-an-email” is not an email address.');
  await expect(create).toBeDisabled();

  // Both policies are switches with no "not set" state: breaks off, buffer on.
  await expect(dialog.getByRole('switch', { name: /Client pays for breaks/ })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await expect(dialog.getByRole('switch', { name: /Client pays for the buffer/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('link', { name: 'E2E never saved' })).toHaveCount(0);
});

test('a new client is created through the modal and listed (§9.7)', async ({ page }) => {
  const unreachable = databaseUnreachable();
  test.skip(unreachable !== null, unreachable ?? '');

  const stamp = Date.now();
  const name = `E2E client ${stamp}`;
  const email = `e2e.client.${stamp}@example.test`;
  try {
    await openAsAdmin(page, '/clients');
    await page.locator('.topbar').getByRole('button', { name: '+ New client' }).click();
    const dialog = page.getByRole('dialog', { name: 'New client' });
    await dialog.getByLabel('Client name').fill(name);
    await dialog.getByLabel('Contact full name').fill('Robin Test');
    await dialog.getByLabel('Contact phone').fill('+44 20 7946 0000');
    await dialog.getByLabel('Staff contact point').fill('Front desk, main entrance');
    await dialog.getByLabel('Contact emails').fill(email);
    await dialog.getByLabel('Contact emails').press('Enter');
    // The chip carries its own × button (aria-label "Remove …").
    await expect(dialog.locator('.emails .chip')).toHaveCount(1);
    await expect(dialog.getByRole('button', { name: `Remove ${email}` })).toBeVisible();
    // Breaks paid: flip the default so the list has something to show for it.
    await dialog.getByRole('switch', { name: /Client pays for breaks/ }).click();
    await dialog.getByRole('button', { name: 'Create client' }).click();
    await expect(dialog).toBeHidden();

    await page.getByLabel('Search client, contact, email').fill(name);
    const row = clientRow(page, name);
    await expect(row).toHaveCount(1);
    await expect(row.locator('td[data-label="Contact"] .sub')).toHaveText(email);
    await expect(row.locator('td[data-label="Rate card roles"]')).toHaveText('no rate card yet');
    await expect(row.locator('td[data-label="Policies"]')).toHaveText(
      'Breaks: paid · Buffer: paid',
    );
    await expect(row.locator('td[data-label="Events"]')).toHaveText('0');
    // Nothing delivered is no margin, not 0% (§9.7).
    await expect(row.locator('td[data-label="Avg margin"]')).toHaveText('—');

    expect(
      sql(`select pays_breaks, pays_buffer from clients where name = ${lit(name)}`).split('\t'),
    ).toEqual(['t', 't']);
  } finally {
    // No delete through the UI exists (§9.7), so the made-up row goes by
    // hand. Best effort: the name is unique per run.
    try {
      sql(`delete from clients where name = ${lit(name)}`);
    } catch (cause) {
      console.warn(`[e2e] could not remove client ${name}: ${String(cause)}`);
    }
  }
});

test('the client card shows general info, the rate card margin and its events (§9.7)', async ({
  page,
}) => {
  await openAsAdmin(page, `/clients/${LEONARDO}`);
  test.skip(
    (await page.locator('.alert', { hasText: 'no Supabase project' }).count()) > 0,
    'No Supabase project: the card cannot be read.',
  );

  await expect(page.locator('.topbar .crumbs')).toHaveText('Clients / Leonardo Hotel St Pauls');
  await expect(
    page.locator('.topbar').getByRole('link', { name: '+ New event for this client' }),
  ).toHaveAttribute('href', `/events/new?client=${LEONARDO}`);

  // 1 · General info — and no Delete, said in words beside Edit.
  const info = block(page, /General info$/);
  await expect(info.locator('.kv')).toContainText('Marco V.');
  await expect(info.locator('.kv')).toContainText('+44 20 7074 1000');
  await expect(info.locator('.kv .chip')).toHaveText([
    'events@leonardo-stpauls.example',
    'ops@leonardo-stpauls.example',
  ]);
  await expect(info.getByText('no Delete — a client record is only ever edited')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Delete/ })).toHaveCount(0);

  // 2 · Rate card — charge, base, final (×1.1207) and margin as four figures.
  const rates = block(page, /Rate card$/);
  await expect(rates.getByRole('columnheader', { name: 'Final pay (×1.1207)' })).toBeVisible();
  const waiting = rates.locator('tbody tr').filter({ hasText: 'Waiting Staff' });
  const cells = waiting.locator('td');
  await expect(cells.nth(1)).toHaveText('£22.97');
  await expect(cells.nth(2)).toHaveText('£14.00');
  await expect(cells.nth(3)).toHaveText('£15.69');
  await expect(cells.nth(4)).toContainText('+£7.28/h');
  await expect(cells.nth(4)).toContainText('31.7%');
  await expect(waiting.locator('.chip')).toHaveText(['Black & whites', 'All black']);

  // 4 · Events · this client — the Gala opens its event page.
  const events = block(page, /Events · this client$/);
  await expect(events.getByRole('link', { name: 'Gala Dinner', exact: true })).toHaveAttribute(
    'href',
    `/events/${GALA}`,
  );
});

test('the card adds a role as a draft and Cancel drops it; Edit opens the full client (§9.7)', async ({
  page,
}) => {
  await openAsAdmin(page, `/clients/${LEONARDO}`);
  test.skip(
    (await page.locator('.alert', { hasText: 'no Supabase project' }).count()) > 0,
    'No Supabase project: the card cannot be read.',
  );

  // Barista is in the §9.8 catalogue but not on Leonardo's card, so it is
  // offered; a role already on the card is not (RateCard.tsx `unlisted`).
  const rates = block(page, /Rate card$/);
  const picker = rates.getByLabel('Add a role from the Roles catalogue');
  await expect(picker.locator('option', { hasText: /^Waiting Staff · base/ })).toHaveCount(0);
  await picker.selectOption({ label: 'Barista · base £14.50' });

  // Nothing is written until Save, and Save waits for a charge rate.
  const charge = rates.getByLabel('Charge rate for Barista');
  await expect(charge).toHaveValue('');
  // `has` takes a page-rooted locator: it is resolved inside each row.
  const draft = rates
    .locator('tbody tr')
    .filter({ has: page.getByLabel('Charge rate for Barista') });
  await expect(draft.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await expect(draft).toContainText('on Save');
  await charge.fill('23.00');
  await expect(draft.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await draft.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(rates.getByLabel('Charge rate for Barista')).toHaveCount(0);

  // Edit opens every field, the emails named as the card names them.
  await block(page, /General info$/)
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Edit client' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Client name')).toHaveValue('Leonardo Hotel St Pauls');
  await expect(dialog.getByLabel('Allocation email(s)')).toBeVisible();
  await expect(dialog.locator('.emails .chip')).toHaveCount(2);
  await expect(dialog.getByRole('button', { name: /Delete/ })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
});
