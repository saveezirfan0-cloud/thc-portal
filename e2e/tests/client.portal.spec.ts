import { expect, test, type Page } from '@playwright/test';
import { openAsClient } from './_support/session';
import { databaseUnreachable, lit, sql } from './_support/db';

/**
 * Client Portal — §11.1 the event list, §11.2 the event page, §11.5
 * feedback — signed in as the seeded client contact (docs/13 C1).
 *
 * Marco V. (supabase/seed.sql) belongs to Leonardo Hotel St Pauls, which
 * owns exactly two seeded events:
 *
 *   Gala Dinner     next Friday · upcoming · Chef 2 · Kitchen Porter 3 (+1)
 *                   · Waiting Staff 12 (+2); one KP invitation and three
 *                   Waiting invitations still open, one self-application
 *   Lunch Service   two weeks ago · completed · six `worked` bookings
 *
 * The Product Launch (Mandarin Oriental) is somebody else's. What this file
 * proves is what ADR-0004 and §11.1 are most emphatic about: the customer
 * sees their own events and nothing else, the confirmed line-up and nothing
 * about how it was chosen, and no money anywhere. Counts are asserted by
 * shape rather than by number, because the staff and office projects run
 * against the same database at the same time and one of them may be
 * accepting an invitation while this reads the row.
 *
 * `supabase/tests/160_client_portal.sql` holds the same rules at the view
 * layer, where they actually live; this is the screen over them.
 */

/** Leonardo Hotel St Pauls (Marco's) */
const GALA_DINNER = '60000000-0000-4000-8000-000000000001';
const LUNCH_SERVICE = '60000000-0000-4000-8000-000000000006';
/** Mandarin Oriental (Sophie's) — must be indistinguishable from nothing. */
const PRODUCT_LAUNCH = '60000000-0000-4000-8000-000000000002';

/**
 * §11.1: "No money anywhere: no pay rates, no charge rates, no margin."
 * The three seeded charge rates on Marco's two events are listed by value
 * as well, because a number leaks without its label.
 */
const MONEY = [
  'pay rate',
  'charge rate',
  'margin',
  '£',
  'per hour',
  '/h',
  '30.69',
  '21.23',
  '22.97',
];

/** Invited · Potential pool · Unavailable · Auto-assign stay internal (§11.2). */
const SELECTION = ['potential pool', 'unavailable', 'auto-assign', 'auto invite', 'invited'];

/** Ben Ashworth holds the open Kitchen Porter invitation on the Gala Dinner. */
const INVITED_ONLY = 'Ben Ashworth';

async function skipUnlessServing(page: Page): Promise<void> {
  const response = await page.goto('/client');
  // Since 7d28ba4 the middleware fails closed: an app built without a
  // Supabase project answers 503 rather than rendering an ungated shell.
  // That is the environment saying it cannot run this suite, in its own
  // words, and the only condition under which it is skipped.
  test.skip(response?.status() === 503, 'No Supabase project: the Client Portal refuses to serve.');
}

async function bodyText(page: Page): Promise<string> {
  return (await page.locator('body').innerText()).toLowerCase();
}

test.beforeEach(async ({ page }) => {
  await skipUnlessServing(page);
});

test('the bare domain lands on the event list', async ({ page }) => {
  await openAsClient(page, '/client');
  await page.goto('/');
  await expect(page).toHaveURL(/\/client$/);
});

test('the portal serves its own shell: a top bar and no sidebar (§11.1)', async ({ page }) => {
  await openAsClient(page, '/client');
  await expect(page.getByRole('heading', { name: 'Your events' })).toBeVisible();
  const top = page.locator('header.ctop');
  await expect(top).toBeVisible();
  await expect(top).toContainText('Client Portal');
  // Who is signed in, from their own profile row (profiles_self).
  await expect(top).toContainText('Marco V.');
  // wireframes/client/events.html: "top bar only, no sidebar (the client has
  // one list and one page per event)". The Back Office rail must not appear
  // here — §1.4 keeps the customer out of the back office entirely.
  await expect(page.locator('aside.sidebar')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Scheduling|Compliance|Payroll/ })).toHaveCount(0);
});

test('the event list offers the tabs the scope names, and each holds its own document (§11.1)', async ({
  page,
}) => {
  await openAsClient(page, '/client');
  for (const label of ['Upcoming & ongoing', 'Past', 'All']) {
    // exact: "All" is also the start of "↓ Allocation sheet".
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
  }
  await expect(page.getByPlaceholder('Search events')).toBeVisible();

  // Upcoming & ongoing is the default: the Gala Dinner, with the
  // allocation sheet (downloadable before AND during, §11.3).
  const rows = page.locator('table.tbl tbody tr');
  await expect(rows.filter({ hasText: 'Gala Dinner' })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'Lunch Service' })).toHaveCount(0);
  await expect(rows.filter({ hasText: 'Gala Dinner' })).toContainText('Allocation sheet');

  // Past: the Lunch Service, whose document is now the signed timesheet.
  await page.getByRole('button', { name: /Past/i }).click();
  await expect(rows.filter({ hasText: 'Lunch Service' })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'Gala Dinner' })).toHaveCount(0);
  await expect(rows.filter({ hasText: 'Lunch Service' })).toContainText('Signed timesheet');

  // All: both — and nothing of another customer's (Product Launch, Awards
  // Night, Wedding, Conference Lunch are all elsewhere in the seed).
  await page.getByRole('button', { name: /^All/i }).click();
  await expect(rows.filter({ hasText: 'Gala Dinner' })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'Lunch Service' })).toHaveCount(1);
  for (const foreign of ['Product Launch', 'Awards Night', 'Wedding', 'Conference Lunch']) {
    await expect(rows.filter({ hasText: foreign })).toHaveCount(0);
  }
});

test('a row is name · venue · date/time · "N of M confirmed" · faces · document · details (§11.1)', async ({
  page,
}) => {
  await openAsClient(page, '/client');
  const row = page.locator('table.tbl tbody tr').filter({ hasText: 'Gala Dinner' });
  await expect(row).toContainText('Leonardo Royal Hotel');
  await expect(row).toContainText('PO 4471-A');
  // A scheduled time, UK-labelled, never a bare clock (§1.8).
  await expect(row.locator('td.win')).toContainText(/\d{2}:\d{2}/);
  // N counts confirmed only, M is the headcount — never headcount + buffer.
  // No leading \b: the pill follows the status word with no space ("Upcoming13 of 17").
  await expect(row).toContainText(/\d+ of \d+ confirmed/);
  // Faces of the confirmed workers, one avatar each.
  expect(await row.locator('.avatar').count()).toBeGreaterThan(0);
  await expect(row.getByRole('link', { name: 'Details →' })).toBeVisible();
  await row.getByRole('link', { name: 'Details →' }).click();
  await expect(page).toHaveURL(new RegExp(`/client/events/${GALA_DINNER}$`));
});

test('no money reaches the Client Portal, on the list or on either event (§11.1)', async ({
  page,
}) => {
  // The views underneath carry no such column, so this is a belt-and-braces
  // check on the rendered page rather than the only thing standing between
  // a customer and a rate.
  await openAsClient(page, '/client');
  for (const path of [
    '/client',
    `/client/events/${GALA_DINNER}`,
    `/client/events/${LUNCH_SERVICE}`,
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const body = await bodyText(page);
    for (const word of MONEY) {
      expect(body, `${path} must not show "${word}"`).not.toContain(word);
    }
  }
});

test('the event page shows confirmed staff only, by role, with the role window (§11.2)', async ({
  page,
}) => {
  await openAsClient(page, `/client/events/${GALA_DINNER}`);
  await expect(page.getByRole('heading', { name: 'Gala Dinner' })).toBeVisible();
  await expect(page.getByText('PO Number · 4471-A')).toBeVisible();

  // "↓ Download Allocation Sheet" in the header: a live link once the office
  // has issued one (the outbox journey may just have), a disabled button
  // until then — but present either way, before and during the event.
  await expect(
    page
      .getByRole('button', { name: '↓ Download Allocation Sheet' })
      .or(page.getByRole('link', { name: '↓ Download Allocation Sheet' })),
  ).toBeVisible();

  // Grouped by role, each panel titled with the role's own window
  // (RULE-18), in running order: Chef 07:00 before Waiting Staff 17:00.
  const panels = page.locator('section.panel h3');
  await expect(panels.filter({ hasText: 'Chef' })).toContainText(/07:00/);
  await expect(panels.filter({ hasText: 'Kitchen Porter' })).toContainText(/09:00/);
  await expect(panels.filter({ hasText: 'Waiting Staff' })).toContainText(/17:00/);
  const titles = await panels.allInnerTexts();
  expect(titles.findIndex((t) => t.startsWith('Chef'))).toBeLessThan(
    titles.findIndex((t) => t.startsWith('Waiting Staff')),
  );

  // Every card is photo · name · role.
  const cards = page.locator('.wrow');
  expect(await cards.count()).toBeGreaterThan(0);
  await expect(cards.first().locator('.avatar')).toBeVisible();
  await expect(cards.first().locator('.n')).not.toBeEmpty();
  await expect(cards.first().locator('.s')).toHaveText(/Chef|Kitchen Porter|Waiting Staff/);

  // The selection process has no representation here at all: not the
  // words, and not the people. Ben holds an open invitation and nothing
  // more, so he must be absent from a page that lists the confirmed.
  const body = await bodyText(page);
  for (const word of SELECTION) {
    expect(body).not.toContain(word);
  }
  await expect(page.getByText(INVITED_ONLY)).toHaveCount(0);
});

test('feedback is locked before the event starts, and says so (§11.2)', async ({ page }) => {
  await openAsClient(page, `/client/events/${GALA_DINNER}`);
  await expect(page.getByRole('status')).toContainText('Feedback opens once the event has started');
  const buttons = page.getByRole('button', { name: 'Leave feedback' });
  expect(await buttons.count()).toBeGreaterThan(0);
  for (const button of await buttons.all()) {
    await expect(button).toBeDisabled();
  }
});

test.describe('feedback on a started event (§11.2, §11.5)', () => {
  // One entry per worker per event, and the seed's Lunch Service is the one
  // started event Marco owns. A previous run on the same database leaves
  // "✓ Feedback sent" on every row, so the client entries for this event
  // are cleared first where psql can reach the database; where it cannot,
  // the test looks for a row still open and skips if there is none.
  const clearClientFeedback = () =>
    sql(`delete from feedback where event_id = ${lit(LUNCH_SERVICE)} and author_kind = 'client'`);

  test.beforeEach(() => {
    if (!databaseUnreachable()) clearClientFeedback();
  });
  test.afterEach(() => {
    if (!databaseUnreachable()) clearClientFeedback();
  });

  test('the button is live, opens the stars + comment popup, and becomes "✓ Feedback sent"', async ({
    page,
  }) => {
    await openAsClient(page, `/client/events/${LUNCH_SERVICE}`);
    await expect(page.getByRole('heading', { name: 'Lunch Service' })).toBeVisible();
    // After the event the header offers the signed timesheet instead.
    await expect(
      page
        .getByRole('button', { name: '↓ Download Signed Timesheet' })
        .or(page.getByRole('link', { name: '↓ Download Signed Timesheet' })),
    ).toBeVisible();
    await expect(page.getByRole('status')).toContainText('The event has started');

    // The first worker whose button is still live. `has` is evaluated per
    // row, so it must not carry a `.first()` of its own — that would match
    // every row that has one and trip strict mode below.
    const live = page.getByRole('button', { name: 'Leave feedback' }).and(page.locator(':enabled'));
    test.skip(
      (await live.count()) === 0,
      'Every row on the Lunch Service already carries feedback and psql cannot reset it here.',
    );
    const row = page.locator('.wrow').filter({ has: live }).first();
    const person = (await row.locator('.n').innerText()).trim();

    await row.getByRole('button', { name: 'Leave feedback' }).click();
    const dialog = page.getByRole('dialog', { name: `Feedback · ${person}` });
    await expect(dialog).toBeVisible();

    // Stars are required; the comment is optional (§11.2 "stars + comment").
    await dialog.getByRole('button', { name: 'Send feedback' }).click();
    await expect(dialog.getByRole('status')).toContainText('Choose a rating');
    await dialog.getByRole('radio', { name: '4 stars' }).click();
    await expect(dialog.getByRole('radio', { name: '4 stars' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await dialog.getByLabel('Comment').fill('Calm under pressure, great with the top table.');
    await dialog.getByRole('button', { name: 'Send feedback' }).click();

    await expect(dialog).toBeHidden();
    // The row re-reads from client_lineup_v.feedback_given, not from
    // screen state: the button is gone and the mark is in its place. Found
    // again by name — `row` was "the first row with a live button", which
    // this one no longer is.
    const sent = page.locator('.wrow').filter({ hasText: person }).first();
    await expect(sent.getByText('✓ Feedback sent')).toBeVisible();
    await expect(sent.getByRole('button', { name: 'Leave feedback' })).toHaveCount(0);

    // And it landed as a client entry on this event, read by nobody yet —
    // it counts toward the rating only once the office marks it read (§9.10).
    if (!databaseUnreachable()) {
      expect(
        sql(
          `select count(*) || ':' || count(read_at) from feedback
            where event_id = ${lit(LUNCH_SERVICE)} and author_kind = 'client' and rating = 4`,
        ),
      ).toBe('1:0');
    }
  });
});

test("another customer's event and a nonexistent one are the same not-found (§11.1, ADR-0004)", async ({
  page,
}) => {
  await openAsClient(page, '/client');
  // The Product Launch exists and is Sophie's. `client_portal_visible()`
  // inside the view returns no row, and the page cannot — and must not —
  // tell that apart from an id that was never issued.
  for (const id of [PRODUCT_LAUNCH, '00000000-0000-4000-8000-000000000000']) {
    const response = await page.goto(`/client/events/${id}`, { waitUntil: 'domcontentloaded' });
    expect(response?.status(), `/client/events/${id}`).toBe(404);
    await expect(page.getByText('Product Launch')).toHaveCount(0);
  }
});
