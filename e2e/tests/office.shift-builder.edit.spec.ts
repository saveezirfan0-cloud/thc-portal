import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openAsAdmin } from './_support/session';

/**
 * Shift Builder in its edit and locked states — Scope §3.2, §3.5 (N11),
 * wireframes/backoffice/shift-builder.html. office.shift-builder.spec.ts
 * covers /events/new; these need the seeded events, so they skip where the
 * route 404s for want of a project.
 *
 *   Gala Dinner   next Friday, upcoming — editable; Waiting Staff 17:00–23:30
 *                 with confirmed workers, so a moved start asks them to
 *                 re-confirm (§3.5, N11)
 *   Lunch Service two weeks ago — every field locked, the work is on the board
 *
 * Nothing here presses Save: the seed is shared with every other spec.
 */

const GALA = '60000000-0000-4000-8000-000000000001';
const LUNCH = '60000000-0000-4000-8000-000000000006';

async function openEdit(page: Page, id: string): Promise<void> {
  await openAsAdmin(page, `/events/${id}/edit`);
  test.skip(
    (await page.locator('.builder').count()) === 0 || (await page.title()).includes('404'),
    'No seeded event: this environment has no Supabase project.',
  );
}

test('moving a role start flags the confirmed workers for re-confirmation (§3.5, N11)', async ({
  page,
}) => {
  await openEdit(page, GALA);
  await expect(page.getByText(/^Editing Gala Dinner/)).toBeVisible();

  // Sections read in start order: Chef 07:00, Kitchen Porter 09:00, Waiting
  // Staff 17:00 — the one with confirmed bookings in the seed.
  // Filter on the header, not the section: every section's role picker lists
  // "Waiting Staff" as an option, so `hasText` would match all three.
  const waiting = page
    .locator('.rolesec')
    .filter({ has: page.locator('.rh b', { hasText: 'Waiting Staff' }) });
  await expect(waiting.getByLabel('Start (UK time)')).toHaveValue('17:00');
  await expect(waiting.getByText(/confirmed will be asked to re-confirm/)).toHaveCount(0);

  await waiting.getByLabel('Start (UK time)').fill('18:00');

  await expect(waiting.getByText(/^\d+ confirmed will be asked to re-confirm$/)).toBeVisible();
  await expect(waiting.locator('.hint', { hasText: 'was 17:00' })).toBeVisible();

  // Put it back and the warning goes: nothing is queued for an unchanged time.
  await waiting.getByLabel('Start (UK time)').fill('17:00');
  await expect(waiting.getByText(/confirmed will be asked to re-confirm/)).toHaveCount(0);
});

test('a role with workers booked cannot be removed from the event (§3.2)', async ({ page }) => {
  await openEdit(page, GALA);
  const waiting = page
    .locator('.rolesec')
    .filter({ has: page.locator('.rh b', { hasText: 'Waiting Staff' }) });
  await expect(waiting.getByRole('button', { name: 'Remove' })).toBeDisabled();
});

test('a started or past event is locked and sends the manager to the board (§3.2)', async ({
  page,
}) => {
  await openEdit(page, LUNCH);

  await expect(page.getByText('Editing is locked')).toBeVisible();
  await expect(page.locator('.builder.locked')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save event' })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Open event board →' })).toHaveAttribute(
    'href',
    `/events/${LUNCH}`,
  );

  // Every section is collapsed to its summary — no field to type into.
  await expect(page.locator('.rolesec.collapsed').first()).toBeVisible();
  // getByLabel is a case-insensitive substring match, so scope to the
  // sections: the overall window's "Overall start (UK time)" is still drawn.
  await expect(page.locator('.rolesec').getByLabel('Start (UK time)')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '+ Add role' })).toBeDisabled();
});
