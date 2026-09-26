import { type Page, expect, test } from '@playwright/test';
import { openAsAdmin } from './_support/session';
import { databaseUnreachable, lit, sql } from './_support/db';

/**
 * /staff/:id — Scope §9.6 (the profile), wireframes/backoffice/staff-profile.html.
 *
 * Selectors and words come from apps/office/app/staff/[id]/: ProfileScreen.tsx
 * (header, KPI tiles, the "Profile sections" tabs, the blocked banner),
 * Documents.tsx (rows, Verify / Reject, the closing summary from
 * profile.ts `complianceSummary`), Shifts.tsx, and the Reject dialog shared
 * with /compliance (compliance/ReviewDialogs.tsx).
 *
 * The people are supabase/seed.sql's:
 *
 *   Tom Reid        compliant, THC-00412, passport verified, contract signed
 *   Priya Sharma    compliant, EU settled — a plain weekly limit
 *   Keisha Campbell candidate in `documents` with a PENDING passport
 *   Beth Carter     blocked by a manager, with a reason
 *   Marek Nowak     inactive (left through the app)
 *
 * Nothing is written. The one dialog opened (Reject) is closed with Cancel,
 * and Verify is never pressed: on a passport it verifies on the click
 * (compliance/queue.ts `verifyStep` → 'verify'). The P45 request's office
 * side is the directory's Inactive tab, not the profile — see
 * office.staff.spec.ts.
 */

const TOM = '20000000-0000-4000-8000-000000000002';
const PRIYA = '20000000-0000-4000-8000-000000000003';
const BETH = '20000000-0000-4000-8000-000000000022';
const MAREK = '20000000-0000-4000-8000-000000000023';
const KEISHA = '20000000-0000-4000-8000-000000000034';

/** Opens a profile; skips when the page could not read it (no project). */
async function openProfile(page: Page, id: string): Promise<void> {
  await openAsAdmin(page, `/staff/${id}`);
  test.skip(
    (await page.locator('.phead h2').count()) === 0,
    'No seeded profile: this environment has no Supabase project.',
  );
}

const tab = (page: Page, name: RegExp) =>
  page.getByRole('tablist', { name: 'Profile sections' }).getByRole('tab', { name });

const kpi = (page: Page, label: string) =>
  page.locator('.kpi', { has: page.locator('.k', { hasText: label }) });

test("a worker's profile: header, five KPIs and the five sections (§9.6)", async ({ page }) => {
  await openProfile(page, TOM);

  await expect(page.getByRole('heading', { level: 2, name: 'Tom Reid' })).toBeVisible();
  await expect(page.locator('.phead .who .pill').first()).toHaveText('Compliant');
  await expect(page.locator('.phead')).toContainText('Employee ID THC-00412');
  await expect(
    page.locator('.topbar .crumbs').getByRole('link', { name: 'Directory' }),
  ).toHaveAttribute('href', '/staff');

  for (const label of ['Shifts worked', 'Hours this week', 'No-shows', 'Rating', 'Show-rate']) {
    await expect(kpi(page, label)).toBeVisible();
  }

  await expect(tab(page, /^Overview/)).toHaveAttribute('aria-selected', 'true');
  for (const name of [/^Documents/, /^Client qualification/, /^Shifts/, /^Feedback/]) {
    await expect(tab(page, name)).toHaveAttribute('aria-selected', 'false');
  }
});

test('Hours this week is worked over the calculated limit, with the reason (§9.6, RULE-20)', async ({
  page,
}) => {
  const unreachable = databaseUnreachable();
  test.skip(unreachable !== null, unreachable ?? undefined);
  await openProfile(page, PRIYA);

  // The cap the database calculates for today (the view's own expression);
  // the tile prints "worked / cap" and never lets anyone type it.
  const [hours = ''] = sql(
    `select coalesce(weekly_cap_hours(s.id, (now() at time zone 'Europe/London')::date)::text, '')
       from staff s where s.id = ${lit(PRIYA)}`,
  ).split('\t');
  const cap = hours === '' ? '—' : hours;

  const tile = kpi(page, 'Hours this week');
  await expect(tile.locator('.v')).toHaveText(new RegExp(`^\\d+(\\.\\d)? / ${cap}$`));
  await expect(tile.locator('input')).toHaveCount(0);
  // profile.ts hoursThisWeek: "worked · N h booked · <capReason>".
  await expect(tile.locator('.d')).toContainText(/^worked · \d+(\.\d)? h booked · /);
  if (hours !== '') await expect(tile.locator('.d')).toContainText(`${hours} h — `);
  // The same reason sits in the header's facts line.
  await expect(page.locator('.phead .facts')).toContainText('Weekly limit');
});

test('Documents lists the verified set and closes with the UK-time contract stamp (§9.6, §1.8)', async ({
  page,
}) => {
  await openProfile(page, TOM);
  await tab(page, /^Documents/).click();
  await expect(tab(page, /^Documents/)).toHaveAttribute('aria-selected', 'true');

  const panel = page.locator('.panel', {
    has: page.getByRole('heading', { name: 'Documents', exact: true }),
  });
  const passport = panel.locator('.docrow', { has: page.locator('.t', { hasText: /^Passport$/ }) });
  await expect(passport.locator('.pill').first()).toHaveText('Verified');
  await expect(
    panel.locator('.docrow', { hasText: 'Criminal Record declaration · No' }),
  ).toBeVisible();
  // Nothing of Tom's waits on the office, so there is nothing to press.
  await expect(panel.getByRole('button', { name: 'Verify', exact: true })).toHaveCount(0);

  // An audit stamp: UK time, labelled, never the viewer's zone.
  await expect(
    panel.getByText(
      /^Documents verified, quiz passed\. Contract signed electronically: \d{2}\.\d{2}\.\d{4} \d{2}:\d{2} UK time$/,
    ),
  ).toBeVisible();
});

test('a pending document offers Verify and Reject; Reject asks for a reason (§4.1, §9.6)', async ({
  page,
}) => {
  await openProfile(page, KEISHA);
  await tab(page, /^Documents/).click();

  const panel = page.locator('.panel', {
    has: page.getByRole('heading', { name: 'Documents', exact: true }),
  });
  const passport = panel.locator('.docrow', { has: page.locator('.t', { hasText: /^Passport$/ }) });
  test.skip(
    (await passport.getByRole('button', { name: 'Reject', exact: true }).count()) === 0,
    "Keisha Campbell's seeded passport is no longer pending in this database.",
  );
  await expect(passport.locator('.pill').first()).toHaveText('Under review');
  await expect(passport.getByRole('button', { name: 'Verify', exact: true })).toBeVisible();
  await expect(passport.getByRole('button', { name: 'Download', exact: true })).toBeVisible();

  await passport.getByRole('button', { name: 'Reject', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Reject document', exact: true });
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole('button', { name: 'Reject document', exact: true });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(/Reason/).fill('Photo page is cut off');
  await expect(confirm).toBeEnabled();

  // Close without sending: the seed stays as it was for the other specs.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(passport.locator('.pill').first()).toHaveText('Under review');

  // A candidate's summary never ends on an empty slot (complianceSummary).
  await expect(
    panel.getByText('Onboarding in progress — not bookable yet. Contract not yet signed.'),
  ).toBeVisible();
});

test('Shifts: the history with its 90-day range, and the violation log (§9.6)', async ({
  page,
}) => {
  await openProfile(page, TOM);
  await tab(page, /^Shifts/).click();

  const history = page.locator('.panel', {
    has: page.getByRole('heading', { name: 'Shift history', exact: true }),
  });
  await expect(history.getByLabel('Shift history range')).toHaveValue('90');
  // Tom worked the Lunch Service two weeks before the seed's Friday.
  const lunch = history.locator('tbody tr', { hasText: 'Lunch Service' });
  await expect(lunch).toContainText('Leonardo Hotel St Pauls');
  await expect(lunch.locator('.chip')).toHaveText('Waiting Staff');
  for (const header of ['Scheduled', 'Check in / out', 'Payable', 'Status']) {
    await expect(history.getByRole('columnheader', { name: header, exact: true })).toBeVisible();
  }

  await expect(page.getByRole('heading', { name: 'Violation log', exact: true })).toBeVisible();
});

test('a blocked profile shows the reason first, above the header (§9.6)', async ({ page }) => {
  await openProfile(page, BETH);

  const banner = page.locator('.blocklbl');
  await expect(banner).toContainText(
    'Blocked — Left site without notifying the on-site contact — under review',
  );
  await expect(banner).toContainText('Manual block.');
  await expect(banner.getByRole('button', { name: 'Unblock', exact: true })).toBeVisible();
  // First, before anything else: the banner is the header's previous sibling.
  await expect(page.locator('.blocklbl + .phead')).toHaveCount(1);
});

test('a leaver cannot be blocked; Reset to candidate is the way back (§9.6, §2.12)', async ({
  page,
}) => {
  await openProfile(page, MAREK);
  await expect(page.locator('.phead .who .pill').first()).toHaveText('Inactive');
  await expect(page.getByRole('button', { name: 'Block', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Reset to candidate' })).toBeEnabled();

  await tab(page, /^Documents/).click();
  await expect(page.getByText(/^Left through the app — not bookable\./)).toBeVisible();
});

test('an unknown worker is a 404, not an error panel', async ({ page }) => {
  await openProfile(page, TOM);
  const response = await page.goto('/staff/00000000-0000-4000-8000-00000000dead');
  expect(response?.status()).toBe(404);
});
