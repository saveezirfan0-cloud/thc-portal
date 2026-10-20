import { expect, test } from '@playwright/test';
import { openAsAdmin } from './_support/session';
import { databaseUnreachable, lit, sql } from './_support/db';
import {
  checkOutWithNoFix,
  bookConfirmed,
  createStartedDay,
  createWorker,
  removeDay,
  runTag,
} from './_support/shift-day';
import type { Day, Worker } from './_support/shift-day';

/**
 * Resolving a No check-out from the §9.5 violation log, for real — the
 * other check-in spec opens the window and cancels.
 *
 * §9.5: Resolve needs "Actual finish (UK time)"; the server rejects a value
 * before the worker's check-in or in the future and the dialog stays open
 * with the reason; there is no upper bound against the scheduled end. That
 * finish becomes the check-out for RULE-01, and RULE-14's four-hour floor
 * comes back once the violation is resolved (§5.2). A resolved entry is
 * the audit trail: the note, the manager, and the finish they entered.
 *
 * One section of the spec's own that ended ten minutes ago (so the press
 * below is not a Left early, which would block the floor for good): the
 * worker checked in at the start and pressed Check out off site with no
 * on-site fix — RULE-02's second trigger, raised by `check_out()`.
 */
test.describe.configure({ mode: 'serial' });

let day: Day | null = null;
let worker: Worker | null = null;
let booking = '';

const LOG = 'table.tbl:not(.monitor-tbl)';

/** An instant as the manager types it: UK date (dd/mm/yyyy) and 24-hour time. */
function ukTyped(expression: string): { date: string; time: string } {
  const [date, time] = sql(
    `select to_char((${expression}) at time zone 'Europe/London', 'DD/MM/YYYY|HH24:MI')`,
  ).split('|');
  return { date: date!, time: time! };
}

test.beforeAll(() => {
  if (databaseUnreachable()) return;
  const tag = runTag('rv');
  day = createStartedDay(tag, {
    headcount: 2,
    buffer: 0,
    strictBuffer: false,
    startedMinAgo: 4 * 60 + 10,
  });
  worker = createWorker(tag, 'Godwit', false);
  booking = bookConfirmed(day, worker);
  // On the first whole minute after the start, so the paid clock starts at
  // the check-in (ADR-0095) and the hour the manager types is exactly 60.
  sql(`
    insert into check_logs (booking_id, attempted_at, outcome, location, distance_m,
                            check_in_at, on_site_verified)
    select b.id, date_trunc('minute', sr.starts_at) + interval '1 minute', 'checked_in', e.venue_location, 0,
           date_trunc('minute', sr.starts_at) + interval '1 minute', true
      from bookings b join shift_requirements sr on sr.id = b.shift_id
      join events e on e.id = sr.event_id
     where b.id = ${lit(booking)};
    update bookings set status = 'worked' where id = ${lit(booking)};`);
  checkOutWithNoFix(booking);
});

test.afterAll(() => {
  removeDay(day, [worker]);
  day = null;
  worker = null;
});

test.beforeEach(async ({ page }) => {
  test.skip(databaseUnreachable() !== null, databaseUnreachable() ?? undefined);
  const probe = await page.goto('/login');
  test.skip(probe?.status() === 503, 'No Supabase project: the Back Office refuses to serve.');
});

test('a finish before the check-in or in the future is refused in the dialog; a real one settles the shift and restores the floor (§9.5, RULE-02, RULE-14)', async ({
  page,
}) => {
  // Before: undetermined, never a silent default (RULE-02).
  expect(
    sql(`select pay ->> 'status' from payable_shifts_v where booking_id = ${lit(booking)}`),
  ).toBe('undetermined');

  await openAsAdmin(page, '/checkin');
  const name = `${worker!.firstName} ${worker!.lastName}`;
  await page
    .locator(LOG)
    .locator('tr.violation', { hasText: name })
    .filter({ hasText: 'No check-out' })
    .click();
  const dialog = page.getByRole('dialog', { name: `No check-out — ${name}` });
  await expect(dialog).toBeVisible();

  const finish = dialog.getByRole('group', { name: /Actual finish \(UK time\)/ });
  const type = async (at: { date: string; time: string }) => {
    await finish.getByLabel('Date').fill(at.date);
    await finish.getByLabel('Time').fill(at.time);
    await finish.getByLabel('Time').blur();
  };
  const resolve = dialog.getByRole('button', { name: 'Resolve', exact: true });
  await dialog.locator('textarea').fill('Rang the worker: they left an hour into the shift.');

  const checkIn = `(select check_in_at from check_logs where booking_id = ${lit(booking)} and check_in_at is not null)`;
  await type(ukTyped(`${checkIn} - interval '1 hour'`));
  await resolve.click();
  await expect(dialog).toContainText(
    'That finish time is before the worker checked in. Enter the time they actually left.',
  );

  await type(ukTyped(`now() + interval '2 hours'`));
  await resolve.click();
  await expect(dialog).toContainText(
    'That finish time is in the future. Enter the time they actually left.',
  );
  // Still open, still unresolved.
  expect(
    sql(`select resolved::text from violations
          where booking_id = ${lit(booking)} and type = 'no_checkout'`),
  ).toBe('false');

  await type(ukTyped(`${checkIn} + interval '1 hour'`));
  await resolve.click();
  await expect(dialog).toBeHidden();

  // The entered finish is the check-out RULE-01 prices: 60 minutes worked,
  // and with the No check-out resolved the four-hour floor applies (§5.2).
  expect(
    sql(`select (pay ->> 'status') || '|' || (pay ->> 'workedMin') || '|' ||
                (pay ->> 'payableMin') || '|' || (pay ->> 'floorApplied')
           from payable_shifts_v where booking_id = ${lit(booking)}`),
  ).toBe('settled|60|240|true');

  // The audit trail: Show resolved, then the same window as a record.
  await page.getByRole('checkbox', { name: 'Show resolved' }).click();
  await expect(page).toHaveURL(/\/checkin\?resolved=1/);
  await page
    .locator(LOG)
    .locator('tr.clickable', { hasText: name })
    .filter({ hasText: 'No check-out' })
    .click();
  const record = page.getByRole('dialog', { name: `No check-out — ${name}` });
  await expect(record).toContainText('Resolved by Gisela M.');
  await expect(record.locator('blockquote')).toHaveText(
    'Rang the worker: they left an hour into the shift.',
  );
  const entered = ukTyped(`${checkIn} + interval '1 hour'`);
  await expect(record.locator('.kv', { hasText: 'Actual finish entered' })).toContainText(
    `${entered.time} UK`,
  );
  await expect(record.locator('textarea')).toHaveCount(0);
});
