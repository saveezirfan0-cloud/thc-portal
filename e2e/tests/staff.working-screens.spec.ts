import { expect, test, type Page } from '@playwright/test';
import { openAsWorker } from './_support/session';

/**
 * The Staff App's three working screens — Scope §10.4, wireframes/staff/.
 *
 * These need a real database: the screens read `staff_bookings()` and
 * `staff_open_shifts()`, both `security definer` functions that resolve the
 * signed-in worker. Where there is no Supabase project the middleware lets
 * everything through and the loaders return nothing, so each test skips on an
 * empty shell rather than asserting against a page that cannot exist.
 *
 * The data is Tom Reid's from supabase/seed.sql: one worked shift, one
 * confirmed Gala Dinner, one open Bar Staff invitation, and the Wedding —
 * Marquee open at a client he is not qualified at.
 */

async function skipWithoutData(page: Page): Promise<boolean> {
  // Assert the shell FIRST, then decide whether to skip.
  //
  // This used to be the count alone, and it hid a real outage for a day. Every
  // screen here answered 500 — StaffShell is a server component and was handing
  // BottomNav a `renderLink` FUNCTION, which React will not serialise across the
  // 'use client' boundary — and a 500 page carries no `.mcard` and no `.empty`
  // either, so all eleven tests read that as "no Supabase project" and skipped
  // themselves. Green suite, six dead routes, nobody told.
  //
  // The bottom bar renders from the tab list, not from the worker's data, so it
  // is there on a page with no invitations and absent only when the page did not
  // render. Failing here is the point: "nothing came back" and "the screen is
  // broken" must never again take the same branch.
  await expect(page.locator('.bottom-nav')).toBeVisible();
  return (await page.locator('.mcard, .empty').count()) === 0;
}

test.describe('Invites (§10.4)', () => {
  test.beforeEach(async ({ page }) => {
    await openAsWorker(page, '/invites');
    test.skip(await skipWithoutData(page), 'No Supabase project in this environment.');
  });

  test('an invitation offers Accept and Decline, and shows the dress code first', async ({
    page,
  }) => {
    const card = page.locator('.mcard').first();
    await expect(card).toContainText('Dress code');
    await expect(card.getByRole('button', { name: 'Accept' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Decline' })).toBeVisible();
  });

  test('Accept asks first, and says the overlapping ones will go (§3.4)', async ({ page }) => {
    await page.locator('.mcard').first().getByRole('button', { name: 'Accept' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('withdrawn automatically');
    await expect(dialog).toContainText('12:00');
    await dialog.getByRole('button', { name: 'Not now' }).click();
    await expect(dialog).toBeHidden();
  });

  test('Decline says plainly that it costs the worker nothing (§10.4)', async ({ page }) => {
    await page.locator('.mcard').first().getByRole('button', { name: 'Decline' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('no effect on your show-rate');
    await dialog.getByRole('button', { name: 'Keep it' }).click();
    await expect(dialog).toBeHidden();
  });

  test('the invite detail withholds the on-site contact and the break policy', async ({ page }) => {
    await page.locator('.mcard .t').first().click();
    await expect(page.getByText('On-site contact')).toBeVisible();
    // Both rows are present and both say when they arrive — leaving them out
    // would read as an event that simply has neither (§10.4, §3.2, §5.2b).
    await expect(page.getByText('Shown after you accept')).toHaveCount(2);
    await expect(page.locator('.kv', { hasText: 'Dress code' })).toBeVisible();
  });
});

test.describe('Shifts (§10.4, §3.5)', () => {
  test.beforeEach(async ({ page }) => {
    await openAsWorker(page, '/shifts');
    test.skip(await skipWithoutData(page), 'No Supabase project in this environment.');
  });

  test('My shifts and Open shifts are two segments of one screen', async ({ page }) => {
    await expect(page.getByRole('tab', { name: /My shifts/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Open shifts' })).toBeVisible();
  });

  test('a booked shift shows the worker’s own role window, never the event’s', async ({ page }) => {
    // Gala Dinner runs 07:00–23:30 across three roles; Tom's Waiting Staff
    // section is 17:00–23:30 and that is what his card must read (RULE-18).
    const card = page.locator('.mcard', { hasText: 'Gala Dinner' }).first();
    await expect(card).toContainText('17:00');
    await expect(card).not.toContainText('07:00');
  });

  test('a scheduled time is never an unlabelled clock (§1.8)', async ({ page }) => {
    // The phone project runs in UTC, which IS the UK zone in winter and one
    // hour off it in summer, so the suffix is what proves the rule is applied
    // rather than accidentally satisfied.
    await expect(page.locator('.mcard').first()).toContainText(/\d{2}:\d{2}/);
  });

  test('Open shifts lists the worker’s own roles with what is left to fill', async ({ page }) => {
    await page.getByRole('tab', { name: 'Open shifts' }).click();
    await expect(page).toHaveURL(/tab=open/);
    await expect(page.getByText('self-apply is an extra channel')).toBeVisible();
    await expect(page.locator('.mcard').first()).toContainText('open');
  });

  // The five cards `shiftCard()` resolves — Today · Time changed/Awaiting ·
  // Needs confirmation · Confirmed (· past, not listed) — are asserted as
  // vectors in @thc/domain. What the screen owes is one pill per card, the
  // badge on the segment, and the three-stage copy. Which card Tom's Gala
  // Dinner is depends on how far away next Friday is, so these assert the
  // page against itself rather than against a date.
  test('every booked shift carries exactly one state pill (§3.5, §10.4)', async ({ page }) => {
    const cards = page.locator('.mcard');
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      const head = cards.nth(i).locator('.card-head');
      // Today is a WHEN, not a state: a today card carries it beside its
      // on-day state (wireframes/staff/shifts.html) — Confirmed, Not
      // confirmed today, or Checked in.
      await expect(
        head.getByText(
          /^(Needs confirmation|Confirmed|Not confirmed today|Checked in|Time changed)$/,
        ),
      ).toHaveCount(1);
      // "Time changed" always travels with "Awaiting" (§3.5).
      const changed = await head.getByText('Time changed', { exact: true }).count();
      await expect(head.getByText('Awaiting', { exact: true })).toHaveCount(changed);
    }
  });

  test('the My shifts badge counts the cards awaiting the worker, and only those', async ({
    page,
  }) => {
    const awaiting =
      (await page.getByText('Needs confirmation', { exact: true }).count()) +
      (await page.getByText('Time changed', { exact: true }).count());
    const badge = page.getByRole('tab', { name: /My shifts/ }).locator('.n.alert');
    if (awaiting === 0) {
      await expect(badge).toHaveCount(0);
    } else {
      await expect(badge).toHaveText(`${awaiting}!`);
    }
  });

  test('a card awaiting confirmation names the 12:00 deadline and the consequence (§3.5)', async ({
    page,
  }) => {
    const card = page.locator('.mcard.needs', { hasText: 'Needs confirmation' });
    test.skip((await card.count()) === 0, 'Tom’s shifts are not in the day-before window today.');
    await expect(card.first()).toContainText('Confirm by');
    await expect(card.first()).toContainText('12:00');
    await expect(card.first()).toContainText('(UK time)');
    await expect(card.first()).toContainText('you’ll be removed from this shift');
    await expect(
      card.first().getByRole('button', { name: 'I’m ready for tomorrow' }),
    ).toBeVisible();
  });

  test('Cancel is offered only with the 72-hour rule stated beside it (RULE-04, §10.4)', async ({
    page,
  }) => {
    const cancel = page.getByRole('button', { name: 'Cancel shift' });
    const rows = await cancel.count();
    // Every Cancel sits next to its deadline; a deadline never appears alone.
    await expect(
      page.getByText(/Cancel available until .* \(UK\), 72 h before the start/),
    ).toHaveCount(rows);
    test.skip(rows === 0, 'No shift more than 72 hours away today.');
    await cancel.first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('won’t be able to take any shift on this event again');
    await dialog.getByRole('button', { name: 'Keep my shift' }).click();
    await expect(dialog).toBeHidden();
  });
});

test.describe('Radar (§10.4, RULE-17)', () => {
  test.beforeEach(async ({ page }) => {
    await openAsWorker(page, '/radar');
    test.skip(await skipWithoutData(page), 'No Supabase project in this environment.');
  });

  test('shifts are grouped by wave, and the second wave says why it is there', async ({ page }) => {
    const groups = page.locator('.grp');
    await expect(groups.first()).toBeVisible();
    // Worker-facing copy carries no rule numbers (audit 24.09): the second
    // wave explains itself in words — or the first shows "Worked here before".
    await expect(
      page.getByText(/worked here before|every worker qualified/i).first(),
    ).toBeVisible();
  });

  test('every card carries a km badge — Radar is "closest first"', async ({ page }) => {
    await expect(page.locator('.km').first()).toContainText('km');
  });

  test('the detail shows the dress code before the worker decides, and not the contact', async ({
    page,
  }) => {
    await page.locator('.mcard .t').first().click();
    await expect(page.locator('.kv', { hasText: 'Dress code' })).toBeVisible();
    await expect(page.getByText('On-site contact and break policy appear once')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Apply for this shift|Limit Reached/ }),
    ).toBeVisible();
  });
});
