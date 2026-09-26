import { expect, test } from '@playwright/test';
import { openAsAdmin } from './_support/session';
import { databaseUnreachable, lit, sql } from './_support/db';
import {
  bookConfirmed,
  checkOutWithNoFix,
  createStartedDay,
  createWorker,
  markCheckedIn,
  markNoShow,
  removeDay,
  runTag,
} from './_support/shift-day';
import type { Day, Worker } from './_support/shift-day';

/**
 * Check In / Out — the live monitor and the violation log (§9.5,
 * wireframes/backoffice/checkin.html), and Get back on the event board
 * (§3.3, wireframes/backoffice/event-board.html).
 *
 * Audit 25.09 item 54: "e2e for /checkin … `getBack`". One event of the
 * spec's own (e2e/tests/_support/shift-day.ts), started ten minutes ago,
 * with the three people a manager actually has to read on it:
 *
 *   Curlew   checked in on site — "On shift"
 *   Dunlin   confirmed and absent; the office pressed No show
 *            (`office_mark_no_show()`, the board button's RPC) — "Not
 *            checked in — 30 min alert", and a No-show in the log
 *   Avocet   checked in, then checked out off site with no on-site fix —
 *            RULE-02's second trigger, raised by `check_out()` itself —
 *            "No check-out", and a No check-out in the log
 *
 * The monitor's Status column is `checkin_monitor_v`'s (pgTAP 240 holds
 * it); what this proves is the screen: the rows, the event filter, "Needs
 * attention", the log's detail window with its "(UK time)" inputs (§1.8)
 * — opened and cancelled, which must change nothing — and then Get back
 * from the board, which must resolve the same entry the log shows.
 *
 * SERIAL: Get back resolves the No-show the log test opened, and the last
 * test reads it back as resolved.
 */
test.describe.configure({ mode: 'serial' });

let day: Day | null = null;
let curlew: Worker | null = null;
let dunlin: Worker | null = null;
let avocet: Worker | null = null;
let dunlinBooking = '';
let noShowId = '';

const fullName = (w: Worker | null) => `${w!.firstName} ${w!.lastName}`;
/** The violation log's table — the page's other table is the monitor's (MonitorScreen.tsx). */
const LOG = 'table.tbl:not(.monitor-tbl)';

test.beforeAll(() => {
  if (databaseUnreachable()) return;
  const tag = runTag('ck');
  day = createStartedDay(tag, { headcount: 3, buffer: 0, strictBuffer: false });
  curlew = createWorker(tag, 'Curlew', false);
  dunlin = createWorker(tag, 'Dunlin', false);
  avocet = createWorker(tag, 'Avocet', false);
  markCheckedIn(bookConfirmed(day, curlew));
  dunlinBooking = bookConfirmed(day, dunlin);
  noShowId = markNoShow(dunlinBooking);
  const avocetBooking = bookConfirmed(day, avocet);
  markCheckedIn(avocetBooking);
  checkOutWithNoFix(avocetBooking);
});

test.afterAll(() => {
  removeDay(day, [curlew, dunlin, avocet]);
  day = null;
});

test.beforeEach(async ({ page }) => {
  test.skip(databaseUnreachable() !== null, databaseUnreachable() ?? undefined);
  const probe = await page.goto('/login');
  test.skip(probe?.status() === 503, 'No Supabase project: the Back Office refuses to serve.');
});

test('the monitor lists today’s event with each worker’s live status (§9.5)', async ({ page }) => {
  await openAsAdmin(page, '/checkin');
  await expect(page.getByRole('heading', { name: 'Check In / Out' })).toBeVisible();

  // MonitorScreen.tsx: "All events today" narrows to one event by its title.
  await page
    .locator('select')
    .filter({ has: page.locator('option', { hasText: day!.eventTitle }) })
    .selectOption({ label: day!.eventTitle });

  // MonitorTable.tsx, one row per booking, the pill from STATUS_LABEL (status.ts).
  const table = page.locator('table.monitor-tbl');
  await expect(table.locator('tbody tr')).toHaveCount(3);
  const row = (w: Worker | null) => table.locator('tbody tr', { hasText: fullName(w) });
  await expect(row(curlew)).toContainText('On shift');
  await expect(row(dunlin)).toContainText('Not checked in — 30 min alert');
  await expect(row(avocet)).toContainText('No check-out');
  // Check-in is an actual stamp — the viewer's clock, no suffix; the
  // Window is scheduled — UK, labelled (§1.8).
  await expect(row(curlew).locator('td.stamp')).toHaveText(/^\d{2}:\d{2}$/);
  await expect(row(dunlin).locator('td.stamp')).toHaveText('—');
  await expect(row(curlew)).toContainText('UK time');

  // The strip above: one short, flagged (§9.5 "−1 worker").
  const card = page.locator('.evcard', { hasText: day!.eventTitle });
  await expect(card).toHaveClass(/flag/);
  await expect(card).toContainText('−1 worker');

  // "Needs attention" keeps the two a manager must act on.
  await page.getByRole('button', { name: /Needs attention/ }).click();
  await expect(table.locator('tbody tr')).toHaveCount(2);
  await expect(row(curlew)).toHaveCount(0);
});

test('the violation log opens a No-show and a No check-out, with "(UK time)" inputs, and Cancel changes nothing (§9.5)', async ({
  page,
}) => {
  await openAsAdmin(page, '/checkin');
  // Unresolved only, by default (`?resolved=1` is "Show resolved", log.ts).
  await expect(page.getByRole('checkbox', { name: 'Show resolved' })).not.toBeChecked();

  // The No-show. An unresolved entry is `tr.violation` (violationRow.ts).
  const noShow = page.locator(LOG).locator('tr.violation', { hasText: fullName(dunlin) });
  await expect(noShow).toHaveCount(1);
  await expect(noShow).toContainText('No-show');
  await expect(noShow).toContainText(day!.eventTitle);
  await noShow.getByRole('button', { name: 'Details' }).click();

  // ResolveModal.tsx: "<label> — <name>", the server's Flagged-as line,
  // actual stamps in "your time", and the arrival typed in UK time. The
  // section has not ended, so the arrival is optional and there is no
  // finish field.
  let dialog = page.getByRole('dialog', { name: `No-show — ${fullName(dunlin)}` });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.kv', { hasText: 'Flagged as' })).toContainText(
    `No-show — ${day!.eventTitle}`,
  );
  await expect(dialog.locator('.kv', { hasText: 'Detected' })).toContainText('your time');
  await expect(dialog.locator('.kv', { hasText: 'Checked in' })).toContainText('never');
  await expect(dialog).toContainText('the same action as “Get back”');
  const arrived = dialog.getByLabel('Arrived at (UK time)');
  await expect(arrived).toHaveAttribute('type', 'datetime-local');
  await expect(dialog.getByText('Actual finish (UK time)')).toHaveCount(0);

  // The note is mandatory for every type: Resolve waits for it.
  const resolve = dialog.getByRole('button', { name: 'Resolve', exact: true });
  await expect(resolve).toBeDisabled();
  await dialog.locator('textarea').fill('Opened by the e2e suite and cancelled.');
  await expect(resolve).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  expect(
    sql(`select resolved::text || '|' || type from violations where id = ${lit(noShowId)}`),
  ).toBe('false|no_show');

  // The No check-out: here the finish is what the manager supplies, typed
  // in UK time, and it is required.
  const noCheckOut = page
    .locator(LOG)
    .locator('tr.violation', { hasText: fullName(avocet) })
    .filter({
      hasText: 'No check-out',
    });
  await noCheckOut.getByRole('button', { name: 'Details' }).click();
  dialog = page.getByRole('dialog', { name: `No check-out — ${fullName(avocet)}` });
  await expect(dialog).toBeVisible();
  const finish = dialog.getByLabel('Actual finish (UK time)');
  await expect(finish).toHaveAttribute('type', 'datetime-local');
  await expect(dialog.locator('label.field', { hasText: 'Actual finish (UK time)' })).toContainText(
    '*',
  );
  await dialog.locator('textarea').fill('Note without a finish.');
  // A note alone is not enough for a No check-out.
  await expect(dialog.getByRole('button', { name: 'Resolve', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  expect(
    sql(`select count(*) from violations
          where staff_id = ${lit(avocet!.staffId)} and type = 'no_checkout' and not resolved`),
  ).toBe('1');
});

test('Get back on the event board registers the no-show as arrived, Late (§3.3)', async ({
  page,
}) => {
  await openAsAdmin(page, `/events/${day!.eventId}`);
  await expect(page.getByRole('heading', { name: day!.eventTitle })).toBeVisible();

  // RoleBoard.tsx: the no-show stays in Confirmed, badged, with Get back
  // beside it. The board names people "First L." (board-model.ts shortName).
  const row = page.locator('.prow', { hasText: `${dunlin!.firstName} D.` });
  await expect(row.getByText('No show', { exact: true })).toBeVisible();
  // No payroll export yet, so BookingActions runs it without the §3.3 warning.
  // The board is a heavy client tree: a press before hydration is a click on
  // inert server HTML, so wait for the page to settle first.
  await page.waitForLoadState('networkidle');
  await row.getByRole('button', { name: 'Get back' }).click();

  // BookingActions.tsx prints a refusal in the row as role="alert"; if one
  // appears, fail with its words rather than a bare "still No show".
  await expect
    .poll(
      async () => {
        const refusal = (await row.getByRole('alert').allTextContents()).join(' ').trim();
        if (refusal) return `refused: ${refusal}`;
        return (await row.getByText('No show', { exact: true }).count()) === 0
          ? 'got back'
          : 'still No show';
      },
      { timeout: 10_000 },
    )
    .toBe('got back');
  await expect(row.getByRole('button', { name: 'Get back' })).toHaveCount(0);

  // Underneath: get_back() → resolve_violation() on the SAME entry the log
  // showed — reclassified to Late, resolved, with the board's own note;
  // an arrival written as the check-in, and the booking `worked`.
  expect(
    sql(`select type || '|' || resolved || '|' || resolution_note
           from violations where id = ${lit(noShowId)}`),
  ).toBe('late|true|Get back — registered as arrived from the event board (§3.3).');
  expect(
    sql(`select b.status || '|' || count(cl.id) filter (where cl.check_in_at is not null)
           from bookings b left join check_logs cl on cl.booking_id = b.id
          where b.id = ${lit(dunlinBooking)} group by b.status`),
  ).toBe('worked|1');
});

test('"Show resolved" brings the entry back as a record, with who resolved it (§9.5)', async ({
  page,
}) => {
  await openAsAdmin(page, '/checkin');
  // Resolved entries are gone from the default log…
  await expect(page.locator(LOG).locator('tr', { hasText: fullName(dunlin) })).toHaveCount(0);

  // …and back, dimmed, under the query's filter (audit D50).
  // A click, not `.check()`: the box is controlled by the URL (`router.push`
  // to `?resolved=1`, MonitorScreen.tsx), so it only reads as ticked once
  // the navigation lands.
  await page.getByRole('checkbox', { name: 'Show resolved' }).click();
  await expect(page).toHaveURL(/\/checkin\?resolved=1/);
  await expect(page.getByRole('checkbox', { name: 'Show resolved' })).toBeChecked();
  const entry = page.locator(LOG).locator('tr.clickable', { hasText: fullName(dunlin) });
  await expect(entry).toContainText('Late');
  await expect(entry.getByText('Resolved', { exact: true })).toBeVisible();
  await expect(entry).not.toHaveClass(/violation/);

  // The whole row opens the window; resolved, it is the audit trail, not a form.
  await entry.click();
  const dialog = page.getByRole('dialog', { name: `Late — ${fullName(dunlin)}` });
  await expect(dialog).toContainText('Resolved by Gisela M.');
  await expect(dialog.locator('blockquote')).toHaveText(
    'Get back — registered as arrived from the event board (§3.3).',
  );
  await expect(dialog.locator('textarea')).toHaveCount(0);
  // The footer's Close, not the × in the header (also labelled "Close", Modal.tsx).
  await dialog.locator('.mf').getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
});
