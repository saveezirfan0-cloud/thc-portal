import { type Page, expect, test } from '@playwright/test';
import { openAsAdmin } from './_support/session';
import { databaseUnreachable, sql } from './_support/db';

/**
 * /reports — Scope §9.9, wireframes/backoffice/reports.html: Financial,
 * Payroll and New Starter (HMRC), each with its own CSV.
 *
 * Markup and words: apps/office/app/reports/page.tsx (the "Report" nav),
 * _components/FinancialTab.tsx, PayrollTab.tsx, PeopleTable.tsx,
 * NewStarterTab.tsx. CSV header rows: packages/pdf/src/csv.ts
 * (FINANCIAL_CSV_COLUMNS, PAYROLL_CSV_COLUMNS, NEW_STARTER_CSV_COLUMNS),
 * served by reports/export/route.ts with a UTF-8 BOM and CRLF.
 *
 * The structural tests run everywhere: the page renders its three tabs and
 * their empty tables when there is no project. The figures need the seed,
 * and a period that does not depend on the day the suite runs: every seeded
 * event is dated from `seed_friday()` (the Friday after the seed ran), so
 * the period is read from the Gala Dinner's own date. Gala Dinner (Leonardo)
 * is that Friday, Conference Lunch (ExCeL) two days later and cancelled
 * before the day, Awards Night (The Dorchester) four days later.
 */

const GALA_DINNER = '60000000-0000-4000-8000-000000000001';

const FINANCIAL_HEADER =
  'Group,Events,Payable hours,Base payroll,Holiday +12.07%,Payroll incl. holiday,Invoicing (forecast),Margin,Status';
const PAYROLL_HEADER =
  'Employee ID,Staff,Event,Client,Role,Date,Scheduled start–end,Check in,Check out,Break deduction,Payable hours,Rate,Base,Holiday,Total';
const NEW_STARTER_HEADER =
  'Staff,Employee ID,NI Number,Home address,Postcode,Country,Date of birth,Gender,First shift date,HMRC Statement,Student Loan';

const nav = (page: Page) => page.getByRole('navigation', { name: 'Report' });

/** The seed's Friday (the Gala Dinner's date); skips the test without a database. */
function seededFriday(): string {
  const unreachable = databaseUnreachable();
  test.skip(unreachable !== null, unreachable ?? undefined);
  const friday = sql(`select event_date::text from events where id = '${GALA_DINNER}'`);
  test.skip(!/^\d{4}-\d{2}-\d{2}$/.test(friday), 'The seeded Gala Dinner is missing.');
  return friday;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** reports/view-model.ts `newStarterPeriod`: the Mon–Sun week before the date's. */
function weekBefore(iso: string): { from: string; to: string } {
  const monday = addDays(iso, -((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7));
  const from = addDays(monday, -7);
  return { from, to: addDays(from, 6) };
}

/** "£1,234.56" → 1234.56 (view-model.ts `pounds`). */
function money(text: string): number {
  return Number(text.replace(/[£,\s]/g, ''));
}

/** The CSV's lines, BOM stripped (csv.ts `toCsv`). */
function lines(csv: string): string[] {
  return csv
    .slice(csv.charCodeAt(0) === 0xfeff ? 1 : 0)
    .split(/\r\n/)
    .filter((line) => line !== '');
}

test('three tabs, one per report, each with its own period control (§9.9)', async ({ page }) => {
  await openAsAdmin(page, '/reports');

  const financial = nav(page).getByRole('link', { name: 'Financial report' });
  const payroll = nav(page).getByRole('link', { name: 'Payroll report' });
  const starter = nav(page).getByRole('link', { name: 'New Starter (HMRC)' });
  await expect(financial).toHaveAttribute('aria-current', 'page');

  // Financial opens on this week: "This week" is the pressed shortcut.
  await expect(page.getByRole('link', { name: 'This week' })).toHaveClass(/primary/);
  await expect(page.getByRole('link', { name: 'Export CSV' })).toHaveAttribute(
    'href',
    /^\/reports\/export\?report=financial&from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}&by=day$/,
  );

  await payroll.click();
  await expect(page).toHaveURL(/tab=payroll/);
  await expect(payroll).toHaveAttribute('aria-current', 'page');
  // Payroll opens on last week, Mon–Sun.
  await expect(page.getByRole('link', { name: 'Last week' })).toHaveClass(/primary/);
  for (const label of ['Workers on shifts', 'Shifts', 'Total to be paid', 'Payable hours']) {
    await expect(page.locator('.kpi .k', { hasText: new RegExp(`^${label}$`) })).toBeVisible();
  }
  await expect(page.getByRole('link', { name: 'Export CSV' })).toHaveAttribute(
    'href',
    /^\/reports\/export\?report=payroll&from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/,
  );

  await starter.click();
  await expect(page).toHaveURL(/tab=newstarter/);
  await expect(starter).toHaveAttribute('aria-current', 'page');
  await expect(page.getByLabel('Pick a date')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preview' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: /^Preview · \d+ (person|people) will be in the report$/ }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Export CSV' })).toHaveAttribute(
    'href',
    /^\/reports\/export\?report=newstarter&date=\d{4}-\d{2}-\d{2}$/,
  );
});

test('Payroll: base and holiday are separate columns, and a timesheet is never edited (§9.9, RULE-06)', async ({
  page,
}) => {
  await openAsAdmin(page, '/reports?tab=payroll');

  const people = page.locator('.panel', {
    has: page.getByRole('heading', { name: 'Breakdown by person', exact: true }),
  });
  for (const header of ['Staff', 'Employee ID', 'Base', 'Holiday +12.07%', 'Total payroll']) {
    await expect(people.getByRole('columnheader', { name: header, exact: true })).toBeVisible();
  }
  await expect(page.getByLabel('Search name or Employee ID')).toBeVisible();

  // The two notes under the table (PayrollTab.tsx): one row per shift, and
  // the held / read-only rule. The "changed since exported" warning itself
  // needs a shift exported and then altered, which the seed does not hold.
  await expect(page.getByText('CSV export: one row per SHIFT, never averaged')).toBeVisible();
  await expect(page.getByText(/a timesheet is never edited by hand/)).toBeVisible();
});

test('Financial: the holiday +12.07% is broken out beside base, never blended (§9.9, §1.5)', async ({
  page,
}) => {
  const friday = seededFriday();
  const from = friday;
  const to = addDays(friday, 4);
  await openAsAdmin(page, `/reports?tab=financial&from=${from}&to=${to}&by=client`);

  // Base and holiday are two figures on the payroll tile.
  const tile = page.locator('.kpi', { has: page.locator('.k', { hasText: /^Staff payroll$/ }) });
  await expect(tile).toContainText('holiday broken out — never blended');
  await expect(tile.locator('.rp-split')).toContainText(/Base £[\d,]+/);
  await expect(tile.locator('.rp-split')).toContainText(/Holiday \+12\.07% £[\d,]+/);
  // A future period is labelled as a forecast (§9.9).
  await expect(page.getByText('Forecast for the period', { exact: true })).toBeVisible();

  for (const header of ['Base payroll', 'Holiday +12.07%', 'Payroll incl. holiday']) {
    await expect(page.getByRole('columnheader', { name: header, exact: true })).toBeVisible();
  }

  // Grouped by client: the Gala Dinner under Leonardo, and ExCeL's
  // Conference Lunch struck through and excluded — cancelled before the day.
  const breakdown = page.locator('.panel', { hasText: 'Breakdown ·' });
  await expect(breakdown.locator('tbody tr', { hasText: 'Leonardo Hotel St Pauls' })).toContainText(
    'Gala Dinner',
  );
  const excel = breakdown.locator('tbody tr', { hasText: 'ExCeL London' });
  await expect(excel.locator('s')).toHaveText('Conference Lunch');
  await expect(excel.locator('.pill')).toHaveText('excluded');

  // The total row: payroll incl. holiday is base + holiday, and holiday is
  // 12.07% of base (to the penny per section, so allow the roundings).
  const cells = page.locator('tr.rp-total td');
  const base = money(await cells.nth(3).innerText());
  const holiday = money(await cells.nth(4).innerText());
  const payroll = money(await cells.nth(5).innerText());
  expect(Math.abs(base + holiday - payroll)).toBeLessThan(0.005);
  test.skip(base === 0, 'The seeded sections carry no pay in this period.');
  expect(holiday).toBeGreaterThan(0);
  expect(Math.abs(holiday - base * 0.1207)).toBeLessThan(0.5);
});

test.describe('Export CSV (§9.9)', () => {
  // page.request shares the signed-in context's cookies, so each of these
  // is the office's own download and not an anonymous GET.
  test.beforeEach(async ({ page }) => {
    await openAsAdmin(page, '/reports');
  });

  test('Financial: text/csv, the named file, the header row and the Total line', async ({
    page,
  }) => {
    const friday = seededFriday();
    const to = addDays(friday, 4);
    const response = await page.request.get(
      `/reports/export?report=financial&from=${friday}&to=${to}&by=client`,
    );
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toMatch(/^text\/csv/);
    expect(response.headers()['content-disposition']).toBe(
      `attachment; filename="THC financial ${friday} to ${to} by client.csv"`,
    );

    const rows = lines(await response.text());
    expect(rows[0]).toBe(FINANCIAL_HEADER);
    expect(rows.some((row) => row.startsWith('Leonardo Hotel St Pauls,Gala Dinner,'))).toBe(true);
    expect(rows[rows.length - 1]).toMatch(/^Total,/);
  });

  test('Payroll: one row per shift under the wireframe’s fifteen columns', async ({ page }) => {
    const friday = seededFriday();
    // The Lunch Service fortnight: its bookings are the seed's `worked` ones.
    const from = addDays(friday, -14);
    const to = addDays(friday, -8);
    const response = await page.request.get(`/reports/export?report=payroll&from=${from}&to=${to}`);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toMatch(/^text\/csv/);
    expect(response.headers()['content-disposition']).toBe(
      `attachment; filename="THC payroll ${from} to ${to}.csv"`,
    );
    const [header] = lines(await response.text());
    expect(header).toBe(PAYROLL_HEADER);
  });

  test('New Starter (HMRC): its own columns, for the week before the picked date', async ({
    page,
  }) => {
    const friday = seededFriday();
    const period = weekBefore(friday);
    const response = await page.request.get(`/reports/export?report=newstarter&date=${friday}`);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toMatch(/^text\/csv/);
    expect(response.headers()['content-disposition']).toBe(
      `attachment; filename="THC new starters (HMRC) ${period.from} to ${period.to}.csv"`,
    );
    const [header] = lines(await response.text());
    expect(header).toBe(NEW_STARTER_HEADER);
  });

  test('an unknown report is refused', async ({ page }) => {
    test.skip(databaseUnreachable() !== null, 'No database: the route answers 503 first.');
    const response = await page.request.get('/reports/export?report=everything');
    expect(response.status()).toBe(400);
  });
});
