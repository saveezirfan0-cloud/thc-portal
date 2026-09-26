import { type Page, expect, test } from '@playwright/test';
import { databaseUnreachable, lit, sql } from './_support/db';
import { openAsAdmin } from './_support/session';
import {
  SEEDED_VENUE,
  WAITING_STAFF,
  type Worker,
  createWorker,
  runTag,
} from './_support/shift-day';

/**
 * /dashboard — Scope §9.1.
 *
 * Two halves, because the suite has to work in two environments.
 *
 * The structural tests run everywhere: four KPIs on one row, the weekly
 * money panel with the holiday element broken out, the ten-day list, and
 * the §1.8 zone note. CI builds the Back Office with no Supabase project,
 * so those render their empty states and still prove the screen's shape.
 *
 * The one test that asserts a number skips itself when there is no
 * database to count, the way gate.smoke.spec.ts skips when the gate
 * degrades open. 35 is the open-position total in supabase/seed.sql and is
 * worked out in the test itself.
 */

/** True when the page could not reach a database, so there is nothing to count. */
async function withoutData(page: Page): Promise<boolean> {
  return (await page.locator('.alert', { hasText: 'no Supabase project' }).count()) > 0;
}

// One worker, in file order, for this file only (the config is fully
// parallel): the short-staffed test at the end seeds two open seats and
// removes them, and "Open positions = 35" above must not run beside it.
test.describe.configure({ mode: 'default' });

test('the four operational KPIs sit on one row (§9.1)', async ({ page }) => {
  await openAsAdmin(page, '/dashboard');

  const tiles = page.locator('.tilegrid .kpi');
  await expect(tiles).toHaveCount(4);
  for (const label of ['Open positions', 'On shift now', 'Staff available', 'Compliance blocks']) {
    await expect(page.locator('.tilegrid .kpi .k', { hasText: label })).toBeVisible();
  }
});

test('Open positions counts every unfilled seat in the seed (§9.1)', async ({ page }) => {
  await openAsAdmin(page, '/dashboard');
  test.skip(await withoutData(page), 'No Supabase project: there is nothing to count.');

  // supabase/seed.sql, non-cancelled sections that have not yet ended:
  //   Gala Dinner       Chef 2/2 = 0 · KP 3, 2 confirmed = 1 · Waiting 12, 9 = 3
  //   Product Launch    Bar 6, 4 confirmed = 2
  //   Wedding           Chef 2, 0 = 2 · Waiting 10, 0 = 10
  //   Awards Night      Host 4, 3 confirmed = 1 · Waiting 16, 0 = 16
  //   Conference Lunch  cancelled — nothing was sold (§3.3)
  //   Lunch Service     two weeks ago — cannot be staffed now
  // = 35, and it counts confirmed only: the invited and self-applied
  //   bookings on the Gala's waiting section are not fill (§3.2).
  const tile = page.locator('.kpi', { has: page.locator('.k', { hasText: 'Open positions' }) });
  await expect(tile.locator('.v')).toHaveText('35');
});

test('the weekly snapshot is Mon–Sun and never blends the holiday pay (§9.1, §1.5)', async ({
  page,
}) => {
  await openAsAdmin(page, '/dashboard');

  const panel = page.locator('.panel', { hasText: 'This week · financial snapshot' });
  await expect(panel).toBeVisible();
  // The forecast label is part of the number, not decoration (§9.9).
  await expect(panel.getByText('Forecast for the period')).toBeVisible();

  test.skip(await withoutData(page), 'No Supabase project: there are no figures to show.');

  await expect(panel.locator('.kpi .k', { hasText: 'Chargeable' })).toBeVisible();
  await expect(
    panel.locator('.kpi .k', { hasText: 'Payable (incl. holiday +12.07%)' }),
  ).toBeVisible();
  await expect(panel.locator('.kpi .k', { hasText: 'Gross margin' })).toBeVisible();
  // Base and holiday appear as two figures, never as one.
  await expect(panel.getByText(/^Base £/)).toBeVisible();
  await expect(panel.getByText(/^Holiday £/)).toBeVisible();

  // Mon … Sun, in that order, in the panel header.
  await expect(panel.locator('.pill').first()).toHaveText(/^Mon .* – Sun /);
});

test('the ten-day list puts the margin on each role row (§9.1)', async ({ page }) => {
  await openAsAdmin(page, '/dashboard');

  const panel = page.locator('.panel', { hasText: 'Upcoming events' });
  await expect(panel).toBeVisible();
  test.skip(await withoutData(page), 'No Supabase project: there are no events to list.');

  // Every role line carries its allocation, its fill and its margin.
  //
  // Scoped to `.mono`, because the fill pill is green too: `.green, .coral`
  // alone matched both `<span class="pill green">2 of 2</span>` and
  // `<span class="mono green">+£9.40/h</span>` and failed on strict mode. The
  // margin is the monospaced one — money is `.mono` everywhere in this repo.
  const firstRole = panel.locator('.dash-roles .r').first();
  await expect(firstRole).toBeVisible();
  await expect(firstRole.locator('.mono.green, .mono.coral')).toHaveText(/[+−]£\d+\.\d{2}\/h/);

  // The buffer is absolute: "6 (+1)", never "7" (§3.2).
  const allocations = await panel.locator('.dash-roles .r .mono').allInnerTexts();
  expect(allocations.some((text) => /\d+ \(\+\d+\)/.test(text))).toBe(true);
});

test('scheduled windows name their zone (§1.8)', async ({ page }) => {
  await openAsAdmin(page, '/dashboard');
  // The topbar states the reader's own zone; the column heading says which
  // zone the times under it are. The runner is in UTC, which is not
  // Europe/London for most of the year, so this asserts the note exists
  // rather than which of its two readings it took.
  await expect(page.locator('.topbar .tz')).toContainText('Europe/London');

  test.skip(await withoutData(page), 'No Supabase project: the table has no header to check.');
  await expect(page.getByRole('columnheader', { name: 'Window (UK time)' })).toBeVisible();
});

test('the sidebar points at /dashboard, and / lands there', async ({ page }) => {
  await openAsAdmin(page, '/dashboard');
  const link = page.locator('.sidebar').getByRole('link', { name: 'Dashboard' });
  await expect(link).toHaveAttribute('href', '/dashboard');
  await expect(link).toHaveClass(/active/);

  await openAsAdmin(page, '/');
  await expect(page).toHaveURL(/\/dashboard$/);
});

// ---------------------------------------------------------------------
// Short-staffed — next 48 hours (ADR-0059)
// ---------------------------------------------------------------------

interface ShortStaffedFixture {
  clientId: string;
  short: { eventId: string; title: string };
  full: { eventId: string; title: string };
  workers: Worker[];
}

/**
 * Two events of a client of this run's own, on a seeded venue, each with
 * one Waiting Staff section starting about a day from now:
 *
 *   short   headcount 3, buffer 1 — 1 confirmed      → listed, "1 of 3"
 *   full    headcount 2, buffer 1 — 2 confirmed      → not listed: the
 *           buffer left empty is THC's cover, not a shortfall (§3.2)
 *
 * The bookings are inserted as shift-day.ts inserts its own, with "I'm
 * ready" already pressed so the 12:05 day-before release (§3.5) cannot
 * take them back mid-test. Auto-assign is off on both levels so the hourly
 * rounds do not fill the short one while the test reads it.
 */
function seedShortStaffed(tag: string): ShortStaffedFixture {
  const workers = [
    createWorker(tag, 'Dunlin', false),
    createWorker(tag, 'Godwit', false),
    createWorker(tag, 'Knot', false),
  ];
  const clientId = sql(`
    insert into clients (name, contact_name, phone, staff_contact_point, contact_emails,
                         pays_breaks, pays_buffer)
    values (${lit(`E2E Short Client ${tag}`)}, 'Journey Contact', '+447700900556', 'Front desk',
            array[${lit(`client.short.${tag}@example.test`)}], true, true)
    returning id`);

  const event = (title: string, startsIn: string, headcount: number, buffer: number) => {
    const row = sql(`
      with s as (select now() + interval ${lit(startsIn)} as starts_at),
      e as (
        insert into events (client_id, venue_id, venue_name, venue_address, venue_location,
                            geofence_radius_m, title, event_date, onsite_contact, pays_breaks,
                            pays_buffer, auto_assign)
        select ${lit(clientId)}, v.id, v.name, v.address, v.location, v.geofence_radius_m,
               ${lit(title)}, (s.starts_at at time zone 'Europe/London')::date, 'Duty Manager',
               true, true, false
          from s, venues v where v.id = ${lit(SEEDED_VENUE)}
        returning id
      ), sr as (
        insert into shift_requirements (event_id, role_id, starts_at, ends_at, headcount, buffer,
                                        charge_rate, pay_rate, dress_code, auto_assign,
                                        allocation_per_hour)
        select e.id, ${lit(WAITING_STAFF)}, s.starts_at, s.starts_at + interval '5 hours',
               ${headcount}, ${buffer}, 22.97, 14.00, 'Black & whites', false,
               ${headcount + buffer}
          from e, s
        returning id, event_id
      )
      select sr.event_id, sr.id from sr`);
    const [eventId, shiftId] = row.split('\t');
    if (!shiftId || !/^[0-9a-f-]{36}$/.test(shiftId)) {
      throw new Error(`could not create ${title}: [${row}]`);
    }
    return { eventId: eventId!, shiftId, title };
  };

  const short = event(`E2E Short ${tag}`, '24 hours', 3, 1);
  const full = event(`E2E Full ${tag}`, '25 hours', 2, 1);
  const book = (shiftId: string, worker: Worker) =>
    sql(`
      insert into bookings (shift_id, staff_id, status, source, confirmed_at,
                            day_before_confirmed_at)
      values (${lit(shiftId)}, ${lit(worker.staffId)}, 'confirmed', 'manual',
              now() - interval '2 days', now())`);
  book(short.shiftId, workers[0]!);
  book(full.shiftId, workers[1]!);
  book(full.shiftId, workers[2]!);

  return {
    clientId,
    short: { eventId: short.eventId, title: short.title },
    full: { eventId: full.eventId, title: full.title },
    workers,
  };
}

/** Best effort, as removeDay() in shift-day.ts: a leftover row costs nothing. */
function removeShortStaffed(fixture: ShortStaffedFixture | null): void {
  if (!fixture) return;
  const staff = fixture.workers.map((w) => lit(w.staffId)).join(', ');
  const events = [fixture.short.eventId, fixture.full.eventId].map(lit).join(', ');
  try {
    sql(`
      do $$
      begin
        -- Cancelling the event queues N12 to its confirmed worker (§3.3).
        delete from notification_outbox where recipient_staff_id in (${staff});
        delete from audit_log where entity_id in (${events}) or entity_id in (${staff});
        delete from events where id in (${events});
        delete from bookings where staff_id in (${staff});
        delete from clients where id = ${lit(fixture.clientId)};
        delete from staff where id in (${staff});
      end $$;`);
  } catch (cause) {
    const err = cause && typeof cause === 'object' && 'stderr' in cause ? cause.stderr : cause;
    console.warn(`[e2e] could not remove the short-staffed fixture: ${String(err)}`);
  }
}

test('Short-staffed lists a role below headcount with a way to its board, and cancelling the event clears it (ADR-0059)', async ({
  page,
}) => {
  const unreachable = databaseUnreachable();
  test.skip(unreachable !== null, unreachable ?? '');

  // A caveat for whoever reads a failure next door: while this runs, the
  // seeded "Open positions = 35" above reads two more. Every spec that
  // seeds an unfilled section (shift-day.ts) shares that window.
  let fixture: ShortStaffedFixture | null = null;
  try {
    fixture = seedShortStaffed(runTag('ss'));
    const { short, full } = fixture;

    await openAsAdmin(page, '/dashboard');
    test.skip(await withoutData(page), 'No Supabase project: the panel has nothing to read.');

    const panel = page.locator('section.panel.dash-short');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('next 48 hours');
    const rows = panel.locator('tbody tr');

    await test.step('the short role is listed: confirmed of headcount, the open count, a link', async () => {
      const row = rows.filter({ hasText: short.title });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText('Waiting Staff');
      // Confirmed against HEADCOUNT; the buffer is never in it.
      await expect(row.locator('td[data-label="Confirmed"]')).toHaveText('1 of 3');
      await expect(row.locator('td[data-label="Open"]')).toHaveText('2 open');
      await expect(row.getByRole('link', { name: /Open board/ })).toHaveAttribute(
        'href',
        `/events/${short.eventId}`,
      );
      // No money on this panel (ADR-0059: a scheduler reads it too).
      await expect(row).not.toContainText('£');
    });

    await test.step('the headcount-met role is not, though its buffer is empty', async () => {
      await expect(rows.filter({ hasText: full.title })).toHaveCount(0);
    });

    await test.step('Open board, cancel the event there', async () => {
      await rows
        .filter({ hasText: short.title })
        .getByRole('link', { name: /Open board/ })
        .click();
      await expect(page).toHaveURL(new RegExp(`/events/${short.eventId}$`));
      await page.getByRole('button', { name: 'Cancel event' }).first().click();
      const dialog = page.getByRole('dialog', { name: 'Cancel this event' });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel('Reason').fill('E2E: short-staffed panel');
      await dialog.getByRole('button', { name: 'Cancel event' }).click();
      await expect(dialog).toBeHidden();
      await expect
        .poll(() =>
          sql(`select cancelled_at is not null from events where id = ${lit(short.eventId)}`),
        )
        .toBe('t');
    });

    await test.step('back on the dashboard, the cancelled event is gone from the panel', async () => {
      await page.goto('/dashboard');
      await expect(panel).toBeVisible();
      await expect(rows.filter({ hasText: short.title })).toHaveCount(0);
      await expect(rows.filter({ hasText: full.title })).toHaveCount(0);
    });
  } finally {
    removeShortStaffed(fixture);
  }
});
