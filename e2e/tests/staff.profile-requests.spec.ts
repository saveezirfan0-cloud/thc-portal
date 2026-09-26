import { expect, test } from '@playwright/test';
import { openAs } from './_support/session';
import { databaseUnreachable, lit, sql } from './_support/db';
import { PASSWORD, createWorker, removeDay, runTag } from './_support/shift-day';
import type { Worker } from './_support/shift-day';

/**
 * The two things a working worker asks of the office from the app, and
 * cannot take back from it:
 *
 *   §10.6  Request my P45 — the profile sheet, a two-step confirm, and the
 *          app closing to the leaver screen (wireframes/staff/profile.html).
 *          `request_my_p45()` → `request_p45()` (the worker leaves, E8 to
 *          the office).
 *   §10.7  Declare a criminal conviction — Documents › Declare, a confirm
 *          that says what it releases, and the Documents lock with "Thanks
 *          for telling us" (wireframes/staff/documents.html).
 *          `declare_my_conviction()` → `declare_conviction()` (a pending
 *          in-employment declaration, a conviction-review block, E9 to the
 *          office WITHOUT the text).
 *
 * Audit 25.09 item 54: "… P45 and §10.7". pgTAP 210 and 393 hold both RPCs;
 * this proves the screens reach them and say what happened. Each test has
 * its own compliant worker (e2e/tests/_support/shift-day.ts) — never the
 * seeded Tom Reid, whom other specs read in parallel and whom either
 * action would take out of work for good.
 */

let leaver: Worker | null = null;
let declarer: Worker | null = null;

test.beforeAll(() => {
  if (databaseUnreachable()) return;
  const tag = runTag('pr');
  leaver = createWorker(tag, 'Siskin', true);
  declarer = createWorker(tag, 'Linnet', true);
});

test.afterAll(() => {
  removeDay(null, [leaver, declarer]);
  leaver = null;
  declarer = null;
});

test.beforeEach(async ({ page }) => {
  test.skip(databaseUnreachable() !== null, databaseUnreachable() ?? undefined);
  const response = await page.goto('/login');
  test.skip(response?.status() === 503, 'No Supabase project: the Staff App refuses to serve.');
});

test('Request my P45: two confirmations, then the leaver screen — and the office is told (§10.6)', async ({
  page,
}) => {
  const reason = 'Moving to Leeds for a permanent job';
  await openAs(page, '/profile', leaver!.email, PASSWORD);

  // ProfileHub.tsx — the Profile tab is a screen since ADR-0042, not a
  // modal sheet: below sign-out, the long form of the button while it is
  // available.
  const hub = page.locator('.profile-hub');
  await expect(
    hub.getByRole('region', { name: 'You' }).getByText(`${leaver!.firstName} ${leaver!.lastName}`),
  ).toBeVisible();
  await hub
    .getByRole('button', { name: 'Request my P45 — leaving The Hospitality Company' })
    .click();

  // P45Flow.tsx step 1: the consequences in full, and Cancel is the
  // primary-styled action — the confirm deliberately is not.
  const flow = page.getByRole('dialog', { name: 'Leaving The Hospitality Company?' });
  await expect(flow).toContainText('P45 will be requested');
  await expect(flow).toContainText('taken off every shift you’re booked on');
  await expect(flow.getByRole('button', { name: 'Cancel' })).toHaveClass(/primary/);
  await flow.getByLabel('Reason for leaving · optional').fill(reason);
  await flow.getByRole('button', { name: 'Yes, request my P45' }).click();

  // Step 2, "so this cannot be triggered by a stray tap".
  const sure = page.getByRole('dialog', {
    name: 'Are you sure? This can’t be undone from the app',
  });
  await expect(sure).toBeVisible();
  await sure.getByRole('button', { name: 'Request my P45', exact: true }).click();

  // LockScreen.tsx, the leaver case (§10.6 step 7).
  await expect(
    page.getByRole('heading', { name: 'You’ve left The Hospitality Company.' }),
  ).toBeVisible();
  await expect(
    page.getByText('Your P45 has been requested and the office will be in touch.'),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Payment information — earnings history' }),
  ).toBeVisible();

  // Underneath: the worker is a leaver, with the reason they gave …
  expect(
    sql(`select status || '|' || (left_at is not null) || '|' || leave_reason
           from staff where id = ${lit(leaver!.staffId)}`),
  ).toBe(`inactive|true|${reason}`);
  // … and exactly one E8 to the office carries it (§8).
  expect(
    sql(`select count(*) || '|' || max(template) || '|' || max(payload ->> 'reason') || '|' ||
                max(array_to_string(recipient_emails, ','))
           from notification_outbox where key like ${lit(`E8:staff:${leaver!.staffId}:%`)}`),
  ).toBe(`1|E8|${reason}|admin@thehospitalitycompany.co.uk`);

  // Shifts is closed to a leaver too — the same screen, whatever the tab.
  await page.goto('/shifts');
  await expect(
    page.getByRole('heading', { name: 'You’ve left The Hospitality Company.' }),
  ).toBeVisible();
});

test('Declare a conviction: the form, the confirm, and "Thanks for telling us" — the text never shown back (§10.7)', async ({
  page,
}) => {
  const details = 'Fined for a public order offence at Highbury Corner Magistrates’ Court';
  // A month ago, in UK terms — the date input refuses a future day.
  const convicted = sql(
    `select to_char((now() at time zone 'Europe/London')::date - 30, 'YYYY-MM-DD')`,
  );

  await openAs(page, '/documents', declarer!.email, PASSWORD);
  // DocumentsHub.tsx: offered to any compliant worker (canDeclareConviction).
  await page.getByRole('link', { name: 'Declare a criminal conviction ›' }).click();
  await expect(page).toHaveURL(/\/documents\/declare$/);

  // DeclareForm.tsx: nothing to submit until there are details.
  const submit = page.getByRole('button', { name: 'Submit declaration' });
  await expect(submit).toBeDisabled();
  await expect(page.getByText('Enter the details to submit')).toBeVisible();
  await expect(page.getByText('What happens when you submit')).toBeVisible();

  // The textarea's label is "Details *" (DeclareForm.tsx → @thc/ui Field).
  await page.getByRole('textbox', { name: /^Details/ }).fill(details);
  await page.getByLabel('Date of conviction · optional').fill(convicted);
  await expect(submit).toBeEnabled();
  await submit.click();

  // The confirmation quotes the real count: no booked shifts to release.
  const sure = page.getByRole('dialog', { name: 'Are you sure?' });
  await expect(sure).toContainText('You have no booked shifts to release');
  await sure.getByRole('button', { name: 'Yes, submit' }).click();

  // Back on Documents, locked to itself, in §10.7 step 5's words
  // (DocumentsLock.tsx documentsNotice).
  await expect(page).toHaveURL(/\/documents$/);
  await expect(page.getByText('Thanks for telling us.')).toBeVisible();
  await expect(
    page.getByText('We’ve paused your upcoming shifts while the office reviews your declaration'),
  ).toBeVisible();
  // "not shown back to you on this screen after you submit".
  expect(await page.locator('body').innerText()).not.toContain('Highbury');

  // Underneath: one pending in-employment declaration with what was typed …
  expect(
    sql(`select source || '|' || answer || '|' || review_status || '|' ||
                conviction_date::text || '|' || details
           from criminal_declarations where staff_id = ${lit(declarer!.staffId)}`),
  ).toBe(`in_employment|true|pending|${convicted}|${details}`);
  // … the worker held for review (§10.7 step 4) …
  expect(
    sql(`select status || '|' || block_kind from staff where id = ${lit(declarer!.staffId)}`),
  ).toBe('blocked|conviction_review');
  // … and E9 to the office, which never carries the text itself.
  expect(
    sql(`select count(*) || '|' || bool_and(not (payload::text like '%Highbury%'))
           from notification_outbox
          where template = 'E9'
            and key in (select 'E9:declaration:' || id from criminal_declarations
                         where staff_id = ${lit(declarer!.staffId)})`),
  ).toBe('1|true');

  // Shifts is locked to Documents while the office reviews it (§10.1 case 1).
  await page.goto('/shifts');
  await expect(
    page.getByRole('heading', { name: 'Locked until your documents are in order' }),
  ).toBeVisible();
});
