import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { openAs } from './_support/session';
import { databaseUnreachable, lit, sql } from './_support/db';
import {
  PASSWORD,
  bookConfirmed,
  createStartedDay,
  createWorker,
  markCheckedIn,
  removeDay,
  runTag,
} from './_support/shift-day';
import type { Day, Worker } from './_support/shift-day';

/**
 * The day of the shift, in the browser — §5.1 (Check-in / Check-out),
 * §3.2 strict buffer and RULE-15, §10.4 shift screen, §10.6 step 3;
 * wireframes/staff/shift-detail.html states (d)–(g) and (m).
 *
 * Audit 25.09 item 54: "nothing for check-in/out in the browser". The rules
 * themselves are the database's (`attempt_check_in` / `check_out`,
 * 20260930100000) and pgTAP holds them (070, 140, 240); what only a browser
 * can show is the screen doing its part — asking the phone for a fix,
 * sending it, and rendering what came back — and that the press lands in
 * `check_logs` as the RPC would write it. There is no selfie or camera at
 * check-in: ShiftScreen.tsx asks `navigator.geolocation` and nothing else,
 * so Playwright's granted permission and `setGeolocation` are the whole
 * device.
 *
 * Each block builds its own day (e2e/tests/_support/shift-day.ts): a
 * compliant worker with a login, today's event at the seeded Leonardo Royal
 * Hotel, one Waiting Staff section that started ten minutes ago, the
 * booking confirmed and ready. Ten minutes in, the check-in is inside the
 * 30-minute grace and therefore Late, check-out is already open, and a
 * RULE-15 turn-away is the paid one.
 *
 * Needs the CI stack: psql on 54322 to build and read the day. Skipped,
 * with the reason, where there is none.
 */

/** The phone reports the venue's own point: 0 m from the centre, inside any fence (§5.1). */
async function onSite(context: BrowserContext, day: Day): Promise<void> {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({
    latitude: day.venue.latitude,
    longitude: day.venue.longitude,
    accuracy: 10,
  });
}

async function skipWithoutStack(page: Page): Promise<void> {
  test.skip(databaseUnreachable() !== null, databaseUnreachable() ?? undefined);
  const response = await page.goto('/login');
  test.skip(response?.status() === 503, 'No Supabase project: the Staff App refuses to serve.');
}

test.describe('on site: check in, then check out (§5.1)', () => {
  // One worker, one booking, moved on by each test in turn.
  test.describe.configure({ mode: 'serial' });

  let day: Day | null = null;
  let worker: Worker | null = null;
  let booking = '';

  test.beforeAll(() => {
    if (databaseUnreachable()) return;
    const tag = runTag('io');
    day = createStartedDay(tag, { headcount: 2, buffer: 0, strictBuffer: false });
    worker = createWorker(tag, 'Kestrel', true);
    booking = bookConfirmed(day, worker);
  });

  test.afterAll(() => {
    removeDay(day, [worker]);
    day = null;
    worker = null;
  });

  test.beforeEach(async ({ page }) => {
    await skipWithoutStack(page);
  });

  test('inside the geofence, Check in goes through — and ten minutes in it is Late (§5.1)', async ({
    context,
    page,
  }) => {
    await onSite(context, day!);
    await openAs(page, `/shifts/${booking}`, worker!.email, PASSWORD);

    // StaffShell's title is `${eventTitle} · ${roleName}` (shifts/[id]/page.tsx).
    await expect(page.getByText(`${day!.eventTitle} · Waiting Staff`)).toBeVisible();
    // The fix arrived and is inside the fence: GpsChip's "<b>On site</b> · 0 m
    // from the venue centre" (ShiftScreen.tsx), and only then is the button live.
    await expect(page.getByText('On site', { exact: true })).toBeVisible();
    const checkIn = page.getByRole('button', { name: 'Check in — verify GPS' });
    await expect(checkIn).toBeEnabled();
    // The window line quotes the section's start, not the event's (RULE-18).
    await expect(page.getByText(/after \d{2}:\d{2} you’re marked Late/i)).toBeVisible();

    await checkIn.click();

    // CHECK_IN_MESSAGES.checked_in_late (shifts/[id]/messages.ts), then the
    // refreshed booking: HeadRow's "Checked in" pill and a live Check out.
    await expect(page.getByText('You’re checked in, and marked as arriving late.')).toBeVisible();
    await expect(page.getByText('Checked in', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check out' })).toBeEnabled();
    await expect(page.getByRole('button', { name: /Check in/ })).toHaveCount(0);

    // Underneath: the accepted press, on site, and the booking moved to
    // `worked` (§3.6) — written by attempt_check_in(), not by the screen.
    expect(
      sql(`select b.status || '|' || cl.outcome || '|' || cl.on_site_verified || '|' ||
                  (cl.distance_m <= ${day!.venue.radiusM})
             from bookings b join check_logs cl on cl.booking_id = b.id
            where b.id = ${lit(booking)} and cl.check_in_at is not null`),
    ).toBe('worked|checked_in|true|true');
    // The 30-minute grace: after the start is Late, with the minutes counted
    // from the ROLE section's start (§5.1, RULE-18).
    const [type, minutes] = sql(
      `select type, minutes_late from violations where booking_id = ${lit(booking)}`,
    ).split('\t');
    expect(type).toBe('late');
    expect(Number(minutes)).toBeGreaterThanOrEqual(10);
    expect(Number(minutes)).toBeLessThan(30);
  });

  test('while checked in, Request my P45 waits — "Available once you’ve checked out" (§10.6)', async ({
    page,
  }) => {
    await openAs(page, '/profile', worker!.email, PASSWORD);
    // ProfileHub.tsx (ADR-0042): the unavailable button is plain "Request my P45",
    // with p45Availability()'s hint beside it (profile/lock.ts).
    await expect(page.getByRole('button', { name: 'Request my P45', exact: true })).toBeDisabled();
    await expect(page.getByText("Available once you've checked out")).toBeVisible();
  });

  test('Check out on site records the press and says how the shift came out (§5.1, RULE-14)', async ({
    context,
    page,
  }) => {
    await onSite(context, day!);
    await openAs(page, `/shifts/${booking}`, worker!.email, PASSWORD);
    await expect(page.getByText('Checked in', { exact: true })).toBeVisible();
    await expect(page.getByText('Check-out works from anywhere until')).toBeVisible();

    // press.ts takes a fresh reading at the press (CHECK_OUT_FIX, audit D14).
    await page.getByRole('button', { name: 'Check out' }).click();

    // FullScreens.tsx ShiftCompleteScreen: the check-out stamp in the
    // viewer's own clock (§1.8), the base rate and nothing else (§9.8).
    await expect(
      page.getByRole('heading', { name: `Shift complete — thank you, ${worker!.firstName}` }),
    ).toBeVisible();
    await expect(page.getByText(/^Checked out · \d{2}:\d{2}$/)).toBeVisible();
    await expect(page.locator('.kv', { hasText: 'Hourly rate' })).toContainText('£14.00 / h');
    await expect(page.getByText('before tax · base rate only')).toBeVisible();
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('22.97');
    // Pressed hours before the end: no four-hour floor (RULE-14).
    await expect(page.getByText('Short shifts are paid a four-hour minimum')).toHaveCount(0);

    // Underneath: an on-site check-out on the accepted log, and — pressed
    // more than 15 minutes before the section's end — "Left early" beside
    // the Late from check-in (D5, ADR-0035). No No check-out: the finish is
    // known.
    expect(
      sql(`select (check_out_at is not null) || '|' || check_out_on_site || '|' ||
                  (check_out_pressed_at is not null)
             from check_logs
            where booking_id = ${lit(booking)} and check_in_at is not null`),
    ).toBe('true|true|true');
    expect(
      sql(`select string_agg(type::text, ',' order by type::text)
             from violations where booking_id = ${lit(booking)}`),
    ).toBe('late,left_early');
    expect(sql(`select status from bookings where id = ${lit(booking)}`)).toBe('worked');
  });
});

test.describe('strict buffer: the headcount is already on site (§3.2, RULE-15)', () => {
  let day: Day | null = null;
  let first: Worker | null = null;
  let late: Worker | null = null;
  let booking = '';

  test.beforeAll(() => {
    if (databaseUnreachable()) return;
    const tag = runTag('ta');
    // Headcount 1 (+1), and the client does not pay for its buffer: the
    // first to check in works, anyone after is turned away.
    day = createStartedDay(tag, { headcount: 1, buffer: 1, strictBuffer: true });
    first = createWorker(tag, 'Plover', false);
    late = createWorker(tag, 'Heron', true);
    markCheckedIn(bookConfirmed(day, first));
    booking = bookConfirmed(day, late);
  });

  test.afterAll(() => {
    removeDay(day, [first, late]);
    day = null;
    first = null;
    late = null;
  });

  test('a later arrival is thanked and turned away — paid four hours, being inside the grace', async ({
    context,
    page,
  }) => {
    await skipWithoutStack(page);
    await onSite(context, day!);
    await openAs(page, `/shifts/${booking}`, late!.email, PASSWORD);

    // Nothing on the screen says the section is full: the press is what
    // finds out, in the database (check_in_decision), under the section lock.
    const checkIn = page.getByRole('button', { name: 'Check in — verify GPS' });
    await expect(checkIn).toBeEnabled();
    await checkIn.click();

    // TurnedAwayScreen.tsx, in @thc/domain's TURNED_AWAY_COPY and
    // turnedAwayMessage(240) (packages/domain/src/staff.ts).
    const screen = page.locator('[data-static="turned_away"]');
    await expect(screen).toBeVisible();
    await expect(screen.getByText('Not needed today', { exact: true })).toBeVisible();
    await expect(screen.getByRole('heading', { name: 'Thanks for coming' })).toBeVisible();
    await expect(screen).toContainText('this shift is already fully staffed');
    await expect(screen).toContainText('you’ll be paid for 4 hours');
    await expect(screen.getByRole('link', { name: 'OK, I understand' })).toHaveAttribute(
      'href',
      '/shifts',
    );
    await expect(page.getByRole('button', { name: /Check in/ })).toHaveCount(0);

    // Underneath: the attempt is logged as turned away, with no check-in
    // stamp, and the booking is terminal; the one slot is still the first
    // worker's (RULE-15).
    expect(
      sql(`select b.status || '|' || cl.outcome || '|' || (cl.check_in_at is null)
             from bookings b join check_logs cl on cl.booking_id = b.id
            where b.id = ${lit(booking)}`),
    ).toBe('turned_away|turned_away|true');
    expect(
      sql(`select count(*) from check_logs cl join bookings b on b.id = cl.booking_id
            where b.shift_id = ${lit(day!.shiftId)} and cl.outcome = 'checked_in'`),
    ).toBe('1');

    // And it stays that way: the next visit reads the logged attempt's
    // RULE-15 minutes from staff_shift_detail(), never the phone's clock.
    await page.reload();
    await expect(page.locator('[data-static="turned_away"]')).toContainText(
      'you’ll be paid for 4 hours',
    );
    await expect(page.getByRole('button', { name: /Check in/ })).toHaveCount(0);
  });
});

test.describe('out of radius: the distance in red and no check-in (§5.1)', () => {
  let day: Day | null = null;
  let worker: Worker | null = null;
  let booking = '';

  test.beforeAll(() => {
    if (databaseUnreachable()) return;
    const tag = runTag('or');
    day = createStartedDay(tag, { headcount: 2, buffer: 0, strictBuffer: false });
    worker = createWorker(tag, 'Lapwing', true);
    booking = bookConfirmed(day, worker);
  });

  test.afterAll(() => {
    removeDay(day, [worker]);
    day = null;
    worker = null;
  });

  test('1.1 km away the button is disabled and the chip gives the distance; walking in turns it on', async ({
    context,
    page,
  }) => {
    await skipWithoutStack(page);
    await context.grantPermissions(['geolocation']);
    // 0.01° of latitude north of the venue: about 1.1 km, far outside 150 m.
    await context.setGeolocation({
      latitude: day!.venue.latitude + 0.01,
      longitude: day!.venue.longitude,
      accuracy: 10,
    });
    await openAs(page, `/shifts/${booking}`, worker!.email, PASSWORD);

    const checkIn = page.getByRole('button', { name: 'Check in — verify GPS' });
    await expect(checkIn).toBeDisabled();
    // GpsChip's off-site state is the red one (`.gps.bad`, packages/ui).
    const chip = page.locator('.gps.bad');
    await expect(chip).toContainText('You’re 1.1 km from the venue.');
    await expect(chip).toContainText(`Check-in opens within ${day!.venue.radiusM} m`);
    // Nothing was pressed, so nothing is logged (§1.5).
    expect(sql(`select count(*) from check_logs where booking_id = ${lit(booking)}`)).toBe('0');

    // ADR-0152: the screen follows the worker; at the door the button turns on.
    await context.setGeolocation({
      latitude: day!.venue.latitude,
      longitude: day!.venue.longitude,
      accuracy: 10,
    });
    await page.getByRole('button', { name: 'Refresh location' }).click();
    await expect(checkIn).toBeEnabled();
    await expect(page.locator('.gps.bad')).toHaveCount(0);
  });
});

test.describe('never checked out: booking_tick raises No check-out at end + 4 h (RULE-02, BG-09)', () => {
  let day: Day | null = null;
  let worker: Worker | null = null;
  let booking = '';

  test.beforeAll(() => {
    if (databaseUnreachable()) return;
    const tag = runTag('nc');
    // A four-hour section that started 8 h 5 min ago: it ended 4 h 5 min
    // ago, so the check-out button locked five minutes ago.
    day = createStartedDay(tag, {
      headcount: 2,
      buffer: 0,
      strictBuffer: false,
      startedMinAgo: 8 * 60 + 5,
    });
    worker = createWorker(tag, 'Curlew', true);
    booking = bookConfirmed(day, worker);
    // Checked in on site at the start, and never checked out.
    sql(`
      insert into check_logs (booking_id, attempted_at, outcome, location, distance_m,
                              check_in_at, on_site_verified)
      select b.id, sr.starts_at, 'checked_in', e.venue_location, 0, sr.starts_at, true
        from bookings b join shift_requirements sr on sr.id = b.shift_id
        join events e on e.id = sr.event_id
       where b.id = ${lit(booking)};
      update bookings set status = 'worked' where id = ${lit(booking)};`);
  });

  test.afterAll(() => {
    removeDay(day, [worker]);
    day = null;
    worker = null;
  });

  test('the tick raises it, writes no finish, and the worker sees the §10.4 screen', async ({
    page,
  }) => {
    await skipWithoutStack(page);
    // What pg_cron runs every minute (supabase/functions/booking-tick calls
    // the same function). Idempotent: a second run raises nothing twice.
    sql(`select booking_tick()`);
    sql(`select booking_tick()`);
    expect(
      sql(`select count(*) || '|' || bool_and(not resolved) from violations
            where booking_id = ${lit(booking)} and type = 'no_checkout'`),
    ).toBe('1|true');
    // RULE-02: never a silent default to the scheduled end.
    expect(
      sql(`select coalesce(check_out_at::text, 'none') || '|' || coalesce(manager_finish_at::text, 'none')
             from check_logs where booking_id = ${lit(booking)} and check_in_at is not null`),
    ).toBe('none|none');
    expect(
      sql(`select pay ->> 'status' from payable_shifts_v where booking_id = ${lit(booking)}`),
    ).toBe('undetermined');

    await openAs(page, `/shifts/${booking}`, worker!.email, PASSWORD);
    const screen = page.locator('[data-static="no_checkout"]');
    await expect(screen).toBeVisible();
    await expect(screen).toContainText(
      'We didn’t receive your check-out for this shift — the office is following up with you directly.',
    );
    await expect(page.getByRole('button', { name: 'Check out' })).toHaveCount(0);
  });
});
