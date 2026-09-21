import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * Shift Builder — Scope §3.2, §3.4, wireframes/backoffice/shift-builder.html.
 *
 * These run against a Back Office with no Supabase project, which is what CI
 * builds. That leaves the directories empty, so the checks below are the ones
 * that do not need seeded data: the panel order the scope prescribes, the
 * four-hour floor, the buffer display, the allocation default, and the fact
 * that Save stays disabled until every section is valid. Journeys that need a
 * client and a venue belong with the seeded suite.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/events/new');
  // With no Supabase project the middleware degrades open and the builder
  // renders, which is the CI build these assertions describe. Point the same
  // build at a real project and every route is gated, so the suite would
  // otherwise report ten "heading not found" failures for one missing session.
  test.skip(
    page.url().includes('/login'),
    'Back Office is gated: run against the ungated CI build, or sign in first.',
  );
});

/** One role section, by position. Its labels repeat, so scope before asking. */
const section = (page: Page, index = 0) => page.locator('.rolesec').nth(index);

/** The auto-assign track is what a person clicks; the checkbox is hidden. */
const autoAssign = (scope: Locator) => scope.locator('label.switch');

test('the builder follows the scope order: client & venue → date → roles → contact', async ({
  page,
}) => {
  for (const heading of [
    '1 · Client & venue',
    '2 · Date & overall window',
    '3 · Roles',
    '4 · On-site contact & instructions',
  ]) {
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  }
});

test('every typed time says which zone it is in (§1.8)', async ({ page }) => {
  await expect(page.getByLabel('Overall start (UK time)')).toBeVisible();
  await expect(page.getByLabel('Overall end (UK time)')).toBeVisible();

  await page.getByRole('button', { name: '+ Add role' }).click();
  await expect(section(page).getByLabel('Start (UK time)')).toBeVisible();
  await expect(section(page).getByLabel('End (UK time)')).toBeVisible();
});

test('Save is disabled until the event is complete (§3.2)', async ({ page }) => {
  const save = page.getByRole('button', { name: 'Save event' });
  await expect(save).toBeDisabled();
  await expect(page.getByTestId('save-blockers')).toContainText('Choose a client');
  await expect(page.getByTestId('save-blockers')).toContainText('Add at least one role');
});

test('a role added now is pre-filled with the overall window, then edited alone (§3.2)', async ({
  page,
}) => {
  await page.getByLabel('Overall start (UK time)').fill('09:00');
  await page.getByLabel('Overall end (UK time)').fill('17:00');
  await page.getByRole('button', { name: '+ Add role' }).click();

  await expect(section(page).getByLabel('Start (UK time)')).toHaveValue('09:00');
  await expect(section(page).getByLabel('End (UK time)')).toHaveValue('17:00');

  // Moving the section does not move the overall window it came from.
  await section(page).getByLabel('Start (UK time)').fill('17:00');
  await expect(page.getByLabel('Overall start (UK time)')).toHaveValue('09:00');
});

test('a section under four hours is rejected and blocks Save (§3.2)', async ({ page }) => {
  await page.getByLabel('Date').fill('2026-09-18');
  await page.getByRole('button', { name: '+ Add role' }).click();
  await section(page).getByLabel('Start (UK time)').fill('18:00');
  await section(page).getByLabel('End (UK time)').fill('21:00');

  await expect(page.getByText('Minimum shift length is 4 hours')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save event' })).toBeDisabled();

  // Four hours exactly is enough, and the error goes.
  await section(page).getByLabel('End (UK time)').fill('22:00');
  await expect(page.getByText('Minimum shift length is 4 hours')).toHaveCount(0);
});

test('a role may end after midnight (§3.2)', async ({ page }) => {
  await page.getByLabel('Date').fill('2026-09-18');
  await page.getByRole('button', { name: '+ Add role' }).click();
  await section(page).getByLabel('Start (UK time)').fill('17:00');
  await section(page).getByLabel('End (UK time)').fill('01:30');

  await expect(page.getByText('Minimum shift length is 4 hours')).toHaveCount(0);
  await expect(section(page).getByText('8.5 h')).toBeVisible();
});

test('the buffer is absolute and never collapses into the total (§3.2)', async ({ page }) => {
  await page.getByRole('button', { name: '+ Add role' }).click();
  await section(page).getByLabel('Headcount').fill('6');
  await section(page).getByLabel('Buffer').fill('1');

  await expect(section(page).locator('.rh').getByText('6 (+1)')).toBeVisible();
  await expect(section(page).getByLabel('Confirmation target')).toHaveValue('6 (+1) = 7');
  // The header shows the pair, never the collapsed total.
  await expect(section(page).locator('.rh').getByText('7', { exact: true })).toHaveCount(0);
});

test('allocation defaults to headcount + buffer and then stays put (§3.4)', async ({ page }) => {
  await page.getByRole('button', { name: '+ Add role' }).click();
  await section(page).getByLabel('Headcount').fill('12');
  await section(page).getByLabel('Buffer').fill('2');
  await expect(section(page).getByLabel('Allocation per hour')).toHaveValue('14');

  // Once the manager types their own, headcount stops driving it.
  await section(page).getByLabel('Allocation per hour').fill('6');
  await section(page).getByLabel('Headcount').fill('20');
  await expect(section(page).getByLabel('Allocation per hour')).toHaveValue('6');
});

test('auto-assign is on by default at event and role level (§3.4)', async ({ page }) => {
  const eventSwitch = autoAssign(page.locator('.side'));
  await expect(eventSwitch.getByRole('checkbox')).toBeChecked();

  await page.getByRole('button', { name: '+ Add role' }).click();
  const roleSwitch = autoAssign(section(page));
  await expect(roleSwitch.getByRole('checkbox')).toBeChecked();

  // A role turned off — because the client asked for a named person — stays
  // off when the event switch is flicked (§3.4).
  await roleSwitch.click();
  await expect(roleSwitch.getByRole('checkbox')).not.toBeChecked();

  await eventSwitch.click();
  await eventSwitch.click();
  await expect(eventSwitch.getByRole('checkbox')).toBeChecked();
  await expect(roleSwitch.getByRole('checkbox')).not.toBeChecked();
});

test('the summary window is derived from the roles, earliest to latest (RULE-18)', async ({
  page,
}) => {
  await page.getByLabel('Date').fill('2026-09-18');

  await page.getByRole('button', { name: '+ Add role' }).click();
  await section(page, 0).getByLabel('Start (UK time)').fill('07:00');
  await section(page, 0).getByLabel('End (UK time)').fill('15:00');

  await page.getByRole('button', { name: '+ Add role' }).click();
  await section(page, 1).getByLabel('Start (UK time)').fill('17:00');
  await section(page, 1).getByLabel('End (UK time)').fill('23:30');

  const summary = page.locator('.sumrow', { hasText: 'Derived event window' });
  await expect(summary).toContainText('07:00');
  await expect(summary).toContainText('23:30');
});
