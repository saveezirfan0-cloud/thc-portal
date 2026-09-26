import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { databaseUnreachable, lit, sql } from './_support/db';
import { openAsAdmin } from './_support/session';

/**
 * System settings — the scope's "Django Admin": §6 (scoring weights), §3.4
 * (auto-assign limits), §2.4 (Willo stage map), §9.11 (standard radii),
 * §9.12 (sender addresses) and the completion letter requirement §4 (the
 * rota guard). There is no wireframe: docs/08 lists it as a simple form.
 *
 * The screen is apps/office/app/settings: SettingsScreen.tsx renders one
 * `Panel` per block, validate.ts holds every refusal, actions.ts writes.
 * The values asserted are the ones the migrations seed (0001_init.sql,
 * 20260922180000, 20260923100200) — which are also what data.ts falls back
 * to with no project, so the first test holds either way.
 *
 * Every other spec reads these values (auto-assign, the rota guard), so
 * nothing here changes one. The refusals are validated by the server action
 * before it writes anything; the one real save writes back the value that
 * was already there and restores the row in a `finally` regardless.
 */

/** One settings block, by its panel heading. */
const block = (page: Page, title: string) =>
  page.locator('section.panel', { has: page.getByRole('heading', { name: title, exact: true }) });

test('each block renders with its current value (§6, §3.4, §2.4, §9.12)', async ({ page }) => {
  await openAsAdmin(page, '/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'System settings' })).toBeVisible();

  // §6: 0.30 show + 0.25 rating + 0.25 proximity + 0.10 fair + 0.10 venue.
  const weights = block(page, 'Auto-assign scoring weights');
  const expected: [string, string][] = [
    ['Show rate', '0.3'],
    ['Client rating', '0.25'],
    ['Proximity', '0.25'],
    ['Fair rotation', '0.1'],
    ['Venue history', '0.1'],
  ];
  for (const [label, value] of expected) {
    await expect(weights.getByLabel(label, { exact: true })).toHaveValue(value);
  }
  await expect(weights.locator('.panel-h .pill')).toHaveText('Total 1.00');

  const limits = block(page, 'Auto-assign limits');
  await expect(limits.getByLabel('Different-venue gap (minutes)')).toHaveValue('120');
  await expect(limits.getByLabel('Escalation radius (miles)')).toHaveValue('3');

  const willo = block(page, 'Willo stage map');
  await expect(willo.getByLabel('Willo: new response')).toHaveValue('interview_completed');
  await expect(willo.getByLabel('Willo: accepted')).toHaveValue('documents');
  await expect(willo.getByLabel('Willo: rejected')).toHaveValue('rejected');

  // §9.12: exactly two sender addresses.
  const senders = block(page, 'Sender addresses');
  await expect(senders.getByLabel('Allocation sheets & timesheets')).toHaveValue(
    'timesheets@thehospitalitycompany.co.uk',
  );
  await expect(senders.getByLabel('Everything else')).toHaveValue(
    'admin@thehospitalitycompany.co.uk',
  );
});

test('weights that do not sum to 1.00 are refused, with the total shown (§6)', async ({ page }) => {
  await openAsAdmin(page, '/settings');
  const weights = block(page, 'Auto-assign scoring weights');

  await weights.getByLabel('Show rate', { exact: true }).fill('0.4');
  const total = weights.locator('.panel-h .pill');
  await expect(total).toHaveText('Total 1.10');
  await expect(total).toHaveClass(/coral/);

  // saveWeights runs validateWeights before any write (actions.ts).
  await weights.getByRole('button', { name: 'Save weights' }).click();
  await expect(weights.locator('.alert.coral')).toHaveText(
    'The five weights must add up to 1.00 — they currently add up to 1.10.',
  );

  // Back to balanced: the pill goes green again. Nothing was saved.
  await weights.getByLabel('Show rate', { exact: true }).fill('0.3');
  await expect(total).toHaveText('Total 1.00');
  await expect(total).toHaveClass(/green/);
});

test('a no-reply sender is refused: replies go to a monitored mailbox (§9.12)', async ({
  page,
}) => {
  await openAsAdmin(page, '/settings');
  const senders = block(page, 'Sender addresses');

  await senders
    .getByLabel('Allocation sheets & timesheets')
    .fill('no-reply@thehospitalitycompany.co.uk');
  // saveSenders runs validateSenders before any write (actions.ts).
  await senders.getByRole('button', { name: 'Save senders' }).click();
  await expect(senders.locator('.alert.coral')).toHaveText(
    'Timesheets sender: no-reply addresses are not used — replies go to a monitored mailbox.',
  );
});

test('the rota guard fails closed and only offers Save once the choice changes (completion letter §4)', async ({
  page,
}) => {
  await openAsAdmin(page, '/settings');
  const guard = block(page, 'Rota guard');
  const mode = guard.getByLabel('Over the 48-hour limit');
  const save = guard.getByRole('button', { name: 'Save rota guard' });

  await expect(mode).toHaveValue('block');
  await expect(save).toBeDisabled();
  await mode.selectOption('warn');
  await expect(save).toBeEnabled();
  await mode.selectOption('block');
  await expect(save).toBeDisabled();

  // The limits that are never configurable are stated on the block.
  await expect(guard.locator('.note')).toContainText('always refused');
});

test('the standard radii list every venue type with its default, saved only when moved (§9.11)', async ({
  page,
}) => {
  await openAsAdmin(page, '/settings');
  const radii = block(page, 'Standard geofence radii by venue type');
  test.skip(
    (await radii.locator('.radius-row').count()) === 0,
    'No venue types: this environment has no Supabase project.',
  );

  // 0001_init.sql's nine types, in §9.11's order (0007 sort_order).
  await expect(radii.locator('.radius-label')).toHaveText([
    'Restaurant / bar',
    'Hotel',
    'Private residence',
    'Conference or banqueting venue',
    'Exhibition centre',
    'Stadium or arena',
    'Racecourse or showground',
    'Outdoor or festival site',
    'Other',
  ]);

  const hotel = radii.locator('.radius-row').filter({ hasText: 'Hotel' });
  const slider = page.getByLabel('Hotel default radius in metres', { exact: true });
  await expect(slider).toHaveValue('150');
  await expect(hotel.locator('.radius-value')).toHaveText('150 m');
  await expect(hotel.getByRole('button', { name: 'Save' })).toBeDisabled();

  // The keyboard moves the native range input one 50 m step; nothing is
  // written until Save, which this test never presses.
  await slider.press('ArrowRight');
  await expect(hotel.locator('.radius-value')).toHaveText('200 m');
  await expect(hotel.getByRole('button', { name: 'Save' })).toBeEnabled();
  await slider.press('ArrowLeft');
  await expect(hotel.locator('.radius-value')).toHaveText('150 m');
  await expect(hotel.getByRole('button', { name: 'Save' })).toBeDisabled();
});

test('Save limits writes the settings row and says so (§3.4)', async ({ page }) => {
  const unreachable = databaseUnreachable();
  test.skip(unreachable !== null, unreachable ?? '');

  const keys = ['booked_elsewhere_gap_minutes', 'escalation_radius_miles'] as const;
  const before = new Map(
    keys.map((key) => [key, sql(`select value::text from settings where key = ${lit(key)}`)]),
  );
  try {
    await openAsAdmin(page, '/settings');
    const limits = block(page, 'Auto-assign limits');

    // What the screen shows is what the row holds.
    const gap = sql(
      `select value #>> '{}' from settings where key = 'booked_elsewhere_gap_minutes'`,
    );
    const miles = sql(`select value #>> '{}' from settings where key = 'escalation_radius_miles'`);
    await expect(limits.getByLabel('Different-venue gap (minutes)')).toHaveValue(
      String(Number(gap)),
    );
    await expect(limits.getByLabel('Escalation radius (miles)')).toHaveValue(String(Number(miles)));

    // Saved unchanged: a real round trip through the action and RLS that
    // leaves every other spec's auto-assign reading the same numbers.
    await limits.getByRole('button', { name: 'Save limits' }).click();
    // Any .alert, not only the green one: a refusal is a coral alert
    // carrying the server's message, and that message is the diagnosis
    // (the first run of this test found "permission denied for function
    // is_edge_base_url" on every save; 20260930150100).
    await expect(limits.locator('.alert')).toHaveText('Saved.');
    await expect(limits.locator('.alert')).toHaveClass(/\bgreen\b/);
    expect(
      Number(sql(`select value #>> '{}' from settings where key = 'booked_elsewhere_gap_minutes'`)),
    ).toBe(Number(gap));
  } finally {
    // Put the rows back exactly as they were, JSON spelling and all.
    for (const [key, value] of before) {
      try {
        sql(
          value === ''
            ? `delete from settings where key = ${lit(key)}`
            : `update settings set value = ${lit(value)}::jsonb where key = ${lit(key)}`,
        );
      } catch (cause) {
        console.warn(`[e2e] could not restore setting ${key}: ${String(cause)}`);
      }
    }
  }
});
