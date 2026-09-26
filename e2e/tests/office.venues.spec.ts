import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { databaseUnreachable, lit, sql } from './_support/db';
import { openAsAdmin } from './_support/session';

/**
 * Venues — Scope §9.11, wireframes/backoffice/venues.html.
 *
 * The screen is apps/office/app/venues: VenuesScreen.tsx (toolbar, list,
 * "On map" tab), VenueModal.tsx (New / Edit, the radius slider and the
 * read-only address), DeleteVenueModal.tsx (the soft delete) and VenueMap.tsx.
 * The seeded venues are supabase/seed.sql's eight, with the standard radii
 * from `venue_types` (0001_init.sql):
 *
 *   Leonardo Royal Hotel  hotel              150 m  (the standard)
 *   Hurst Manor           private residence  250 m  (widened from 150)
 *
 * A new venue cannot be made through the modal here: its address comes from
 * reverse geocoding the pin (§9.11), which needs a Mapbox token CI does not
 * carry. So the one write seeds a uniquely named venue with the screen's own
 * RPC (`create_venue`) and deletes it through the screen; the row is removed
 * by hand afterwards, since the screen's delete is soft.
 */

/** A list row, by the venue-name button in its first cell. */
const venueRow = (page: Page, name: string) =>
  page
    .locator('table.tbl tbody tr')
    .filter({ has: page.getByRole('button', { name, exact: true }) });

async function openVenues(page: Page): Promise<void> {
  await openAsAdmin(page, '/venues');
  test.skip(
    (await page.locator('table.tbl tbody tr').count()) === 0,
    'No seeded venues: this environment has no Supabase project.',
  );
}

test('the list shows each venue with its type, radius and any override of the default (§9.11)', async ({
  page,
}) => {
  await openVenues(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Venues' })).toBeVisible();

  // §9.11: "+ New venue" sits in the toolbar under the title, not top right.
  await expect(page.locator('.toolbar').getByRole('button', { name: '+ New venue' })).toBeVisible();
  await expect(page.locator('.topbar').getByRole('button', { name: '+ New venue' })).toHaveCount(0);

  await expect(page.locator('table.tbl thead th')).toHaveText([
    'Venue',
    'Address',
    'Type',
    'Geofence (m)',
    'Events',
    'Actions',
  ]);

  const leonardo = venueRow(page, 'Leonardo Royal Hotel');
  await expect(leonardo.locator('td[data-label="Address"]')).toHaveText(
    '10 Godliman St, London EC4V 5AJ',
  );
  await expect(leonardo.locator('td.vt')).toHaveText('Hotel');
  await expect(leonardo.locator('td[data-label="Geofence (m)"]')).toHaveText('150');
  // Coordinates as plain text under the name; geo.ts writes a true minus.
  await expect(leonardo.locator('td.name .sub')).toHaveText('51.5133, −0.0990');

  // Widened for the grounds: the list says what the standard would have been.
  const hurst = venueRow(page, 'Hurst Manor');
  await expect(hurst.locator('td.vt')).toHaveText('Private residence');
  await expect(hurst.locator('td[data-label="Geofence (m)"]')).toContainText('250');
  await expect(hurst.locator('.radius-note')).toHaveText('default 150');

  // Search runs over the name and the address.
  await page.getByLabel('Search by name and address').fill('Cuckfield');
  await expect(page.locator('table.tbl tbody tr')).toHaveCount(1);
  await expect(hurst).toHaveCount(1);
});

test('the On map tab draws every venue, one pin each, labelled with its radius (§9.11)', async ({
  page,
}) => {
  await openVenues(page);

  const tabs = page.getByRole('tablist', { name: 'Venue view' });
  await expect(tabs.getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'true');
  await tabs.getByRole('tab', { name: 'On map' }).click();
  await expect(tabs.getByRole('tab', { name: 'On map' })).toHaveAttribute('aria-selected', 'true');

  const map = page.getByRole('application', { name: "Every venue's geofence circle, to scale" });
  await expect(map).toBeVisible();
  // VenueMap.tsx: each pin is a button named "Edit <markerLabel>", and
  // markerLabel is "<name> · <radius> m".
  await expect(map.getByRole('button', { name: 'Edit Hurst Manor · 250 m' })).toHaveCount(1);
  await expect(map.getByRole('button', { name: 'Zoom in' })).toBeVisible();

  await tabs.getByRole('tab', { name: 'List' }).click();
  await expect(page.locator('table.tbl')).toBeVisible();
});

test('Edit opens the venue pre-filled, titled with its name; Cancel keeps it (§9.11)', async ({
  page,
}) => {
  await openVenues(page);

  await venueRow(page, 'Hurst Manor').getByRole('button', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Hurst Manor' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Venue name')).toHaveValue('Hurst Manor');
  await expect(dialog.getByLabel('Venue type')).toHaveValue('private_residence');
  await expect(dialog.getByLabel('Geofence radius')).toHaveValue('250');
  // The address is the pin's, read-only; the coordinates are plain text.
  await expect(dialog.getByLabel('Address')).toHaveValue('Cuckfield, Haywards Heath RH17 5LB');
  await expect(dialog.getByLabel('Address')).toHaveAttribute('readonly', '');
  await expect(dialog.locator('.coords')).toHaveText('51.0034, −0.1455');
  await expect(dialog.getByRole('button', { name: 'Save changes' })).toBeEnabled();

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(venueRow(page, 'Hurst Manor').locator('.radius-note')).toHaveText('default 150');
});

test('New venue needs a pin before it can be created; the type pre-fills the radius (§9.11)', async ({
  page,
}) => {
  await openVenues(page);

  await page.locator('.toolbar').getByRole('button', { name: '+ New venue' }).click();
  const dialog = page.getByRole('dialog', { name: 'New venue' });
  await expect(dialog).toBeVisible();
  const create = dialog.getByRole('button', { name: 'Create venue' });

  // No pin, no address, no coordinates — and nothing to create.
  await dialog.getByLabel('Venue name').fill('E2E never saved');
  await expect(dialog.getByLabel('Address')).toHaveValue('');
  await expect(dialog.getByLabel('Address')).toHaveAttribute(
    'placeholder',
    'Drop the pin to fill this in',
  );
  await expect(dialog.locator('.coords')).toHaveText('—');
  await expect(create).toBeDisabled();

  // The first type in §9.11's order is Restaurant / bar, 100 m; choosing a
  // type moves the slider to that type's standard radius.
  const radius = dialog.getByLabel('Geofence radius');
  await expect(radius).toHaveValue('100');
  await dialog.getByLabel('Venue type').selectOption({ label: 'Stadium or arena · 500 m' });
  await expect(radius).toHaveValue('500');
  await expect(
    dialog.locator('.field .hint', { hasText: 'Pre-filled from the venue type' }),
  ).toContainText('(Stadium or arena → 500 m)');

  // Clicking the map drops the pin; its coordinates appear as plain text.
  // (Whether the address then resolves depends on a Mapbox token, so the
  // Create button is not asserted past this point.)
  await dialog
    .getByRole('application', {
      name: 'Venue location — click to drop the pin, drag it to move it',
    })
    .click();
  await expect(dialog.locator('.coords')).toHaveText(/^−?\d+\.\d{4}, −?\d+\.\d{4}$/);

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(venueRow(page, 'E2E never saved')).toHaveCount(0);
});

test('Delete confirms in a modal and soft-deletes the venue out of the list (§9.11)', async ({
  page,
}) => {
  const unreachable = databaseUnreachable();
  test.skip(unreachable !== null, unreachable ?? '');

  const name = `E2E venue ${Date.now()}`;
  // The screen's own RPC (0007_venues_directory.sql), 175 m on a hotel so
  // the row carries the "default 150" note too.
  const id = sql(
    `select create_venue(${lit(name)}, ${lit('1 E2E Street, London EC1A 1AA')}, 51.5200, -0.1100, 'hotel', 175)`,
  );
  try {
    await openAsAdmin(page, '/venues');
    await page.getByLabel('Search by name and address').fill(name);
    const row = venueRow(page, name);
    await expect(row).toHaveCount(1);
    await expect(row.locator('td[data-label="Geofence (m)"]')).toContainText('175');
    await expect(row.locator('.radius-note')).toHaveText('default 150');

    await row.getByRole('button', { name: 'Delete', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete venue?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.pill')).toHaveText(name);
    await expect(dialog.getByText('This action cannot be undone.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete venue' }).click();
    await expect(dialog).toBeHidden();

    await expect(venueRow(page, name)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'No venue matches that search' })).toBeVisible();
    // Soft: the row stays, stamped, so a built event's copy still points somewhere.
    expect(sql(`select deleted_at is not null from venues where id = ${lit(id)}`)).toBe('t');
  } finally {
    try {
      sql(`delete from venues where id = ${lit(id)}`);
    } catch (cause) {
      console.warn(`[e2e] could not remove venue ${name}: ${String(cause)}`);
    }
  }
});
