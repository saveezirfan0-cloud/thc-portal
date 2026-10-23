import { type Page, expect, test } from '@playwright/test';
import { createOfficeLogin, removeLogin, unique } from './_support/accounts';
import { databaseUnreachable, lit, sql } from './_support/db';
import { openAs, openAsAdmin } from './_support/session';

/**
 * Tickets (ADR-0202) — the Ticket button, /tickets, the owner's own scope
 * label and time, and what nobody else can see.
 *
 * Markup and words: apps/office/app/_components/ReportButton.tsx,
 * DictateButton.tsx, TimerChip.tsx and apps/office/app/tickets/*
 * (TicketTriage, TicketUpdates, TicketTracking, TimeReportScreen).
 *
 * Two logins, because the whole point is that they see different pages: a
 * manager made for this file reports and follows up, and the seeded owner
 * (Gisela M.) is the one login `ticket_tracker_allowed()` lets see the scope
 * label and the time, once the setting `ticket_tracking_emails` names the login (an empty list means nobody). The
 * title carries a unique tag so a retry or a parallel run never meets the
 * previous one's ticket, and everything is removed afterwards, best effort.
 *
 * The sandbox has no microphone, so the dictation step stands in a speech
 * recogniser that hands back a phrase; the screen's own handling of what a
 * recogniser returns is what is under test.
 */

const PASSWORD = 'Quayside-Heron-7315';
const OWNER_NAME = 'Gisela M.';

const FAKE_SPEECH = `
  class FakeRecognition {
    start() { window.__rec = this; }
    stop() { window.__rec = null; if (this.onend) this.onend(); }
    abort() { window.__rec = null; }
  }
  window.SpeechRecognition = FakeRecognition;
  window.__say = (phrase) => {
    const r = window.__rec;
    if (!r) throw new Error('not listening');
    r.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: phrase } }] });
  };
`;

test.describe.configure({ mode: 'serial' });

let reporterEmail: string | null = null;
let trackingBefore = '[]';
const tag = unique();
const TITLE = `E2E export button ${tag}`;

test.beforeAll(() => {
  const unreachable = databaseUnreachable();
  test.skip(unreachable !== null, unreachable ?? '');
  const login = createOfficeLogin({
    tag: 'tickets',
    fullName: `Tickets Reporter ${tag}`,
    password: PASSWORD,
  });
  reporterEmail = login.email;
  trackingBefore = sql(`select value::text from settings where key = 'ticket_tracking_emails'`);
  sql(
    `update settings set value = '["gisela@thehospitalitycompany.example"]'::jsonb where key = 'ticket_tracking_emails'`,
  );
  sql(`update profiles set office_role = 'manager' where id = ${lit(login.userId)}`);
});

test.afterAll(() => {
  if (databaseUnreachable()) return;
  try {
    sql(
      `update settings set value = ${lit(trackingBefore)}::jsonb where key = 'ticket_tracking_emails'`,
    );
    sql(`
      delete from notification_outbox where template = 'TK1' and payload ->> 'title' = ${lit(TITLE)};
      delete from tickets where title = ${lit(TITLE)};
    `);
  } catch (cause) {
    console.warn(`[e2e] could not remove the tickets: ${String(cause)}`);
  }
  removeLogin(reporterEmail);
});

const ticketId = () => sql(`select id from tickets where title = ${lit(TITLE)}`);

async function dictate(page: Page, button: string, phrase: string) {
  await page.getByRole('button', { name: button }).click();
  await expect(page.getByText('Listening… speak now')).toBeVisible();
  await page.evaluate(
    (p) => (window as unknown as { __say: (t: string) => void }).__say(p),
    phrase,
  );
  await page.getByRole('button', { name: 'Stop dictating' }).click();
}

test('a colleague reports by voice and by typing; it is emailed to the owner', async ({
  context,
  page,
}) => {
  await context.addInitScript(FAKE_SPEECH);
  await openAs(page, '/dashboard', reporterEmail ?? '', PASSWORD);

  const dialog = page.getByRole('dialog');
  // The top bar is server-rendered before it is interactive: press until it opens.
  await expect(async () => {
    await page.getByRole('button', { name: 'Ticket', exact: true }).click();
    await expect(dialog.getByText('New ticket')).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15000 });
  await dialog.getByLabel('What kind of report?').selectOption('request');
  await dialog.getByLabel('How bad is it?').selectOption('medium');

  // Voice: a phrase lands capitalised in the field, and Stop ends the listening.
  await dictate(page, 'Dictate summary', 'e2e dictated summary');
  await expect(dialog.getByLabel('One-line summary *')).toHaveValue('E2e dictated summary');
  // The stored title carries this run's tag, so type over the dictated one.
  await dialog.getByLabel('One-line summary *').fill(TITLE);
  await dictate(page, 'Dictate details', 'we download the staff list every Monday');
  await expect(dialog.getByLabel(/^Details/)).toHaveValue(
    'We download the staff list every Monday',
  );

  await dialog.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText(/Sent as TK-\d+/)).toBeVisible();

  // One ticket, new, by the reporter, from the page they were on.
  expect(
    sql(
      `select kind || '|' || severity || '|' || status || '|' || page_path from tickets where title = ${lit(TITLE)}`,
    ),
  ).toBe('request|medium|new|/dashboard');
  // One TK1 email, to the owner's list, naming the ticket.
  expect(
    sql(
      `select count(*) from notification_outbox where template = 'TK1' and payload ->> 'title' = ${lit(TITLE)} and payload ->> 'variant' = 'new'`,
    ),
  ).toBe('1');
  expect(
    sql(
      `select recipient_emails[1] from notification_outbox where template = 'TK1' and payload ->> 'title' = ${lit(TITLE)}`,
    ),
  ).toBe('saveezirfan@gmail.com');

  // What the reporter sees: the ticket, triage, no scope label, no time.
  await page.goto(`/tickets/${ticketId()}`);
  await expect(page.getByRole('heading', { name: 'Triage' })).toBeVisible();
  await expect(page.getByText(TITLE).first()).toBeVisible();
  await expect(page.getByText('Scope and time')).toHaveCount(0);
  await expect(page.getByText('Start timer')).toHaveCount(0);
  await expect(page.getByText('Monthly time report')).toHaveCount(0);

  // The page that holds the owner's time is not found for them, nor is its file.
  expect((await page.goto('/tickets/time'))?.status()).toBe(404);
  expect((await page.request.get('/tickets/time/export')).status()).toBe(404);
});

test('the owner labels it, times it, logs time by hand and resolves it', async ({ page }) => {
  await openAsAdmin(page, `/tickets/${ticketId()}`);
  await expect(page.getByText('Scope and time')).toBeVisible();

  // Triage: the owner takes it.
  await page.getByLabel('Owner').selectOption({ label: OWNER_NAME });
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved').first()).toBeVisible();

  // A call, as an update on the thread.
  await page.getByRole('button', { name: 'Call', exact: true }).click();
  await page.getByLabel('Add an update').fill('Spoke to them, they need a CSV now');
  await page.getByRole('button', { name: 'Add call' }).click();
  await expect(page.getByText('Spoke to them, they need a CSV now')).toBeVisible();
  // The reporter is emailed at their own address about it.
  await expect
    .poll(() =>
      sql(
        `select recipient_emails[1] from notification_outbox where template = 'TK1' and payload ->> 'title' = ${lit(TITLE)} and payload ->> 'variant' = 'reply' limit 1`,
      ),
    )
    .toBe(reporterEmail?.toLowerCase());

  // The scope label is set after the ticket exists, and is only the owner's.
  await page.getByLabel('Against the original scope').selectOption('addition');
  await page.getByRole('button', { name: 'Save label' }).click();
  await expect(page.getByText('Label saved').first()).toBeVisible();

  // The timer: worked by Claude, visible in the top bar, stopped and logged.
  await page.getByLabel('Who is working on it').selectOption('claude');
  await page.getByRole('button', { name: 'Start timer' }).click();
  await expect(page.locator('.tk-chip')).toContainText(/TK-\d+ · 00:00:\d\d/);
  await expect(page.getByText('Running', { exact: false }).first()).toBeVisible();
  // Starting it moved the New ticket to In progress.
  expect(sql(`select status from tickets where title = ${lit(TITLE)}`)).toBe('in_progress');
  await page.getByLabel('Note for this time').fill('Built the CSV export');
  await page.getByRole('button', { name: 'Stop and log' }).click();
  await expect(page.getByText('Timer stopped — time logged').first()).toBeVisible();
  await expect(page.locator('.tk-chip')).toHaveCount(0);

  // By hand: 15 minutes by the owner. Billable is ticked, because an Addition is.
  await page.getByLabel('Time spent').fill('15m');
  await page.getByLabel('Worked by', { exact: true }).selectOption('owner');
  await page.getByLabel('What was done').fill('Call about the export');
  await expect(page.getByRole('checkbox', { name: /Billable/ })).toBeChecked();
  await page.getByRole('button', { name: 'Log time' }).click();
  await expect(page.getByText('Call about the export').first()).toBeVisible();
  await expect(page.getByText(/in all/)).toContainText('16m');
  expect(
    sql(
      `select string_agg(worked_by || ':' || minutes || ':' || billable, ',' order by id) from ticket_time where ticket_id = ${lit(ticketId())}`,
    ),
  ).toBe('claude:1:true,owner:15:true');

  // Settings → Tickets is the way in from Settings, time report included for a tracker.
  await page.goto('/settings?tab=tickets');
  await expect(page.getByRole('link', { name: 'Open the ticket list' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the time report' })).toBeVisible();
  await page.goto(`/tickets/${ticketId()}`);

  // A time that is not a time is refused in words, and nothing is saved.
  await page.getByLabel('Time spent').fill('soon');
  await page.getByRole('button', { name: 'Log time' }).click();
  await expect(page.getByText(/Enter a time like 15, 15m, 1h 30m/)).toBeVisible();

  // Resolving with a note: kept, and emailed to the reporter's own address.
  await page.getByLabel('Status').selectOption('resolved');
  await page
    .getByRole('textbox', { name: 'Resolution' })
    .fill('Export button added, it downloads a CSV');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText(/has been emailed the note/)).toBeVisible();
  expect(sql(`select status || '|' || resolution from tickets where title = ${lit(TITLE)}`)).toBe(
    'resolved|Export button added, it downloads a CSV',
  );
  expect(
    sql(
      `select recipient_emails[1] from notification_outbox where template = 'TK1' and payload ->> 'title' = ${lit(TITLE)} and payload ->> 'variant' = 'resolved'`,
    ),
  ).toBe(reporterEmail?.toLowerCase());
});

test('the list shows the label and filters by it; the month report adds up the bill', async ({
  page,
}) => {
  await openAsAdmin(page, '/tickets?tab=closed&scope=addition');
  const row = page.getByRole('listitem').filter({ hasText: TITLE });
  await expect(row).toBeVisible();
  await expect(row.getByText('Addition')).toBeVisible();
  await expect(row.getByText('Resolved')).toBeVisible();

  // Filtering for another label does not find it.
  await page.goto('/tickets?tab=closed&scope=fix');
  await expect(page.getByRole('listitem').filter({ hasText: TITLE })).toHaveCount(0);

  await page.goto('/tickets/time');
  await expect(page.getByRole('heading', { name: 'Time report' })).toBeVisible();
  await expect(page.getByText('Billable').first()).toBeVisible();
  await expect(page.getByText(/^TK-\d+ · E2E export button/).first()).toBeVisible();

  // The CSV carries every entry, the label and who did the work.
  const href = await page.getByRole('link', { name: 'Download CSV' }).getAttribute('href');
  const csv = await (await page.request.get(href ?? '')).text();
  expect(csv.split('\r\n')[0]).toBe(
    'Date,Ticket,Title,Scope label,Worked by,Minutes,Hours,Billable,Note',
  );
  const mine = csv.split('\r\n').filter((line) => line.includes(TITLE));
  expect(mine).toHaveLength(2);
  expect(mine.join('\n')).toContain('Addition,Claude,1,0.02,Yes');
  expect(mine.join('\n')).toContain('Addition,Me,15,0.25,Yes,Call about the export');
});

test('an owner cannot delete a report that has time logged on it', async ({ page }) => {
  await openAsAdmin(page, `/tickets/${ticketId()}`);
  await page.getByRole('button', { name: 'Delete this report' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete this report' }).click();
  await expect(page.getByText(/has time logged against it, so it cannot be deleted/)).toBeVisible();
  expect(sql(`select count(*) from tickets where title = ${lit(TITLE)}`)).toBe('1');
});
