import { type Page, expect, test } from '@playwright/test';
import { openAsAdmin } from './_support/session';
import { databaseUnreachable, lit, sql } from './_support/db';

/**
 * /staff — Scope §9.6 (the directory) and the Student visa view (§4.4/§4.5,
 * RULE-20), wireframes/backoffice/staff.html.
 *
 * Every string asserted here is one apps/office/app/staff/StaffScreen.tsx or
 * StudentVisaView.tsx renders; the words they print come from staff.ts
 * (statusLabel, employeeId, CAP_FILTER_LABEL) and the P45 stamp from
 * [id]/profile.ts (formatUkStamp). The people are supabase/seed.sql's:
 *
 *   Tom Reid        compliant, THC-00412, Waiting Staff + Bar Staff
 *   Amara Kalu      compliant, the International student branch
 *   Jonah Whitfield blocked automatically (expired passport)
 *   Beth Carter     blocked by hand, Do not return at The Dorchester
 *   Marek Nowak     inactive, left 45 days before the seed ran, "Moving abroad"
 *   Sofia Almeida   inactive, left 90 days before the seed ran
 *   #1042           removed (§1.7): listed as "Deleted account #1042"
 *   Keisha Campbell a candidate in `documents` — /onboarding's, never listed here
 *
 * Nothing here writes: the suite is fullyParallel and other specs read the
 * same people. Where there is no project the loader returns no rows and a
 * problem alert, so the tests skip rather than assert against an empty list.
 */

const TOM = { id: '20000000-0000-4000-8000-000000000002', name: 'Tom Reid', eid: 'THC-00412' };
const AMARA_ID = '20000000-0000-4000-8000-000000000001';

const rows = (page: Page) => page.locator('table.tbl tbody tr');
const search = (page: Page) =>
  page.getByRole('searchbox', { name: 'Search name, Employee ID, role' });

test.beforeEach(async ({ page }) => {
  await openAsAdmin(page, '/staff');
  test.skip(
    (await page.locator('a.staff-name').count()) === 0,
    'No seeded directory: this environment has no Supabase project.',
  );
});

test('the directory lists workers with the §9.6 columns, and no candidates', async ({ page }) => {
  // The crumb adds the four worker states up to the total (StaffScreen's
  // `crumbs`); a candidate is in none of them (`isWorker`).
  await expect(page.locator('.topbar .crumbs')).toHaveText(
    /^directory · [\d,]+ workers · \d+ compliant · \d+ blocked · \d+ inactive · \d+ removed$/,
  );

  for (const header of [
    'Name',
    'Employee ID',
    'Role(s)',
    'Rating',
    'Show-rate',
    'Compliance status',
    'Right to work',
  ]) {
    await expect(page.getByRole('columnheader', { name: header, exact: true })).toBeVisible();
  }

  // Name A–Z is the default sort and Amara sorts near the top of page one.
  await expect(page.getByRole('link', { name: 'Amara Kalu', exact: true })).toBeVisible();
  // The wireframe's pager: 15 a page by default.
  expect(await rows(page).count()).toBeLessThanOrEqual(15);

  // Keisha Campbell is a seeded candidate (status `documents`): she belongs
  // to /onboarding and the directory search does not find her.
  await search(page).fill('Keisha Campbell');
  await expect(page.getByRole('heading', { name: 'No worker matches', exact: true })).toBeVisible();
});

test('the five status tabs filter the list, and Blocked shows the reason (§9.6)', async ({
  page,
}) => {
  const tabs = page.getByRole('group', { name: 'Filter by status' });
  for (const label of ['All', 'Compliant', 'Blocked', 'Inactive', 'Removed']) {
    await expect(tabs.getByRole('button', { name: new RegExp(`^${label}`) })).toBeVisible();
  }
  await expect(tabs.getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'true');

  await tabs.getByRole('button', { name: /^Blocked/ }).click();
  await expect(tabs.getByRole('button', { name: /^Blocked/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('link', { name: 'Jonah Whitfield', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: TOM.name, exact: true })).toHaveCount(0);
  // Every row's status pill says Blocked (statusLabel), never the raw enum.
  const pills = await rows(page).locator('td.status .pill').allInnerTexts();
  expect(pills.length).toBeGreaterThanOrEqual(2);
  expect(pills.every((text) => text.trim() === 'Blocked')).toBe(true);

  // Beth Carter's manual block carries its reason and her Do not return
  // (seed.sql; the reason arrives through staff_block_reason_v, admin only).
  const beth = rows(page).filter({ hasText: 'Beth Carter' });
  await expect(beth).toContainText(
    'Left site without notifying the on-site contact — under review',
  );
  await expect(beth).toContainText('Do not return: The Dorchester');

  await tabs.getByRole('button', { name: /^Removed/ }).click();
  // §1.7: a removed worker is listed under the anonymised label, not hidden.
  const removed = page.getByRole('link', { name: 'Deleted account #1042', exact: true });
  await expect(removed).toBeVisible();
  await expect(removed).toHaveClass(/removed/);
});

test('the Inactive tab is its own table: left, reason, P45 requested, newest first (§9.6, §10.6)', async ({
  page,
}) => {
  await page
    .getByRole('group', { name: 'Filter by status' })
    .getByRole('button', { name: /^Inactive/ })
    .click();

  await expect(page.getByText('Everyone who left through the app')).toBeVisible();
  for (const header of ['Left', 'Reason given', 'Last completed shift', 'Released shifts', 'P45']) {
    await expect(page.getByRole('columnheader', { name: header, exact: true })).toBeVisible();
  }

  // The office side of "Request my P45": the pill and E8's stamp, which is
  // an audit record and so UK time only (§1.8, formatUkStamp).
  const marek = rows(page).filter({ hasText: 'Marek Nowak' });
  await expect(marek).toContainText('“Moving abroad”');
  await expect(marek.locator('td[data-label="P45"] .pill')).toHaveText('Requested');
  await expect(marek.locator('td[data-label="P45"]')).toContainText(
    /E8 sent \d{2}\.\d{2}\.\d{4} \d{2}:\d{2} UK time/,
  );
  await expect(rows(page).filter({ hasText: 'Sofia Almeida' })).toContainText(
    '“Full-time role elsewhere”',
  );

  // Newest first whatever the sort says (sortRows): Marek left after Sofia.
  const names = await rows(page).locator('a.staff-name').allInnerTexts();
  expect(names.indexOf('Marek Nowak')).toBeGreaterThanOrEqual(0);
  expect(names.indexOf('Marek Nowak')).toBeLessThan(names.indexOf('Sofia Almeida'));
});

test('search runs over name, Employee ID and role; the role filter narrows too (§9.6)', async ({
  page,
}) => {
  await search(page).fill(TOM.name);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).locator('td[data-label="Employee ID"]')).toHaveText(TOM.eid);

  await search(page).fill(TOM.eid);
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByRole('link', { name: TOM.name, exact: true })).toBeVisible();

  await search(page).fill('zz-nobody-by-this-name');
  await expect(page.getByRole('heading', { name: 'No worker matches', exact: true })).toBeVisible();

  await search(page).fill('');
  await page.getByLabel('Filter by role').selectOption('Chef');
  // Luca Moretti is a seeded Chef; every listed row carries the Chef chip.
  await expect(page.getByRole('link', { name: 'Luca Moretti', exact: true })).toBeVisible();
  const chips = await rows(page).locator('td[data-label="Role(s)"]').allInnerTexts();
  expect(chips.length).toBeGreaterThan(0);
  expect(chips.every((text) => text.includes('Chef'))).toBe(true);
});

test('a name opens the profile (§9.6)', async ({ page }) => {
  await search(page).fill(TOM.name);
  await page.getByRole('link', { name: TOM.name, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/staff/${TOM.id}$`));
  await expect(page.getByRole('heading', { level: 2, name: TOM.name })).toBeVisible();
});

test.describe('the Student visa view (§4.5, RULE-20)', () => {
  test('lists the student branch with the calculated cap, which nobody types', async ({ page }) => {
    const view = page.getByRole('group', { name: 'Directory or student visa view' });
    await view.getByRole('button', { name: /^Student visa/ }).click();
    await expect(view.getByRole('button', { name: /^Student visa/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    for (const label of [
      'On the International student branch',
      '20 h · term time this week',
      '48 h · university holiday',
      '48 h · graduated',
    ]) {
      await expect(page.locator('.kpi .label', { hasText: label })).toBeVisible();
    }
    const panel = page.locator('.panel', {
      has: page.getByRole('heading', { name: 'Student visa · caps and evidence', exact: true }),
    });
    await expect(panel).toBeVisible();
    // The view's own filter replaces the role and sort selects.
    await expect(page.getByLabel('Filter by weekly cap')).toHaveValue('all');
    await expect(page.getByLabel('Filter by role')).toHaveCount(0);

    // Amara is on the International student branch; Tom (UK citizen) is not.
    const amara = panel.locator('tbody tr', { hasText: 'Amara Kalu' });
    await expect(amara).toBeVisible();
    await expect(panel.locator('tbody tr', { hasText: TOM.name })).toHaveCount(0);

    // The cap is a derived figure, printed and never an input (RULE-20).
    const cap = amara.locator('td[data-label="Current weekly cap"]');
    await expect(cap.locator('input, select, textarea')).toHaveCount(0);
    await expect(page.getByText('The cap is never typed or stored')).toBeVisible();

    // …and it is what the database calculates for today. Queried rather
    // than written down because Amara's visa ends on a fixed date
    // (2026-12-13) and the term calendar moves the band week by week.
    const unreachable = databaseUnreachable();
    test.skip(unreachable !== null, unreachable ?? undefined);
    await expect(cap.locator('.cap')).toHaveText(expectedCapLabel(AMARA_ID));
  });

  test('/staff?view=student opens on the view (the link /compliance uses)', async ({ page }) => {
    await openAsAdmin(page, '/staff?view=student');
    await expect(
      page
        .getByRole('group', { name: 'Directory or student visa view' })
        .getByRole('button', { name: /^Student visa/ }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Filter by weekly cap')).toBeVisible();
  });
});

/**
 * StudentVisaView's `capLabel`, fed by the two functions student_visa_v
 * reads for today's UK date (staff_directory_v, 20260930110500).
 */
function expectedCapLabel(staffId: string): string {
  const [hours = '', band = ''] = sql(
    `select coalesce(weekly_cap_hours(s.id, (now() at time zone 'Europe/London')::date)::text, ''),
            coalesce(weekly_cap_band(s.id, (now() at time zone 'Europe/London')::date)::text, '')
       from staff s where s.id = ${lit(staffId)}`,
  ).split('\t');
  if (hours === '') {
    return band === 'uncapped' || band === 'opted_out_none' ? '48 h/week + opt-out' : '—';
  }
  return `${hours} h/week`;
}
