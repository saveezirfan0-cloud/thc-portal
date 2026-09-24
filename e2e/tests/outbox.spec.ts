import { expect, test } from '@playwright/test';
import { openAsAdmin } from './_support/session';
import { databaseUnreachable, lit, sql } from './_support/db';

/**
 * The notification outbox — §8, §9.12, §11.4; packages/notifications.
 *
 * Every send goes through `notification_outbox` with a unique key, and a
 * re-run hits that key and does nothing. The unit tests over the register
 * pin the key's SHAPE (`outboxKey(code, subject, id)` → `code:subject:id`)
 * and the drain's decisions; what none of them prove is that a manager
 * pressing a button in a real screen produces exactly one row under it.
 *
 * The action is "Send allocation sheet" on an event board (§11.4): the
 * office draws the PDF, stores it in the `timesheets` bucket and calls
 * `queue_event_document_email()` (20260923130100), which writes one D1 row
 * keyed on the document — `D1:document:<event_documents.id>` — to the
 * contact emails on the client card. The seeded Gala Dinner belongs to
 * Leonardo Hotel St Pauls, whose card names two addresses.
 *
 * (The worker's "I'm ready" was the other candidate. `mark_ready()` stamps
 * the booking and queues nothing itself — N6/N6b are the job's — so it is
 * not a notifying action, and the seed's shifts are not on "tomorrow" on
 * most days of the week anyway.)
 *
 * Needs the CI stack: psql on 54322 to read the outbox, and the service
 * key, without which Send cannot store the PDF the drain would attach.
 */
const GALA_DINNER = '60000000-0000-4000-8000-000000000001';
const CLIENT_CARD_EMAILS = 'events@leonardo-stpauls.example,ops@leonardo-stpauls.example';

test('Send allocation sheet queues exactly one D1 row under the register key (§8, §11.4)', async ({
  page,
}) => {
  test.skip(databaseUnreachable() !== null, databaseUnreachable() ?? undefined);
  test.skip(
    !process.env['SUPABASE_SERVICE_ROLE_KEY'],
    'SUPABASE_SERVICE_ROLE_KEY is not set: Send stores the PDF with it before it queues anything.',
  );
  const probe = await page.goto('/login');
  test.skip(probe?.status() === 503, 'No Supabase project: the Back Office refuses to serve.');

  await openAsAdmin(page, `/events/${GALA_DINNER}`);
  await expect(page.getByRole('heading', { name: 'Gala Dinner' })).toBeVisible();

  await page.getByRole('button', { name: 'Send allocation sheet' }).click();
  const dialog = page.getByRole('dialog', { name: 'Send allocation sheet' });
  await expect(dialog).toBeVisible();
  // From timesheets@, to the client card's contacts (§9.7, §9.12).
  await expect(dialog).toContainText('timesheets@thehospitalitycompany.co.uk');

  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes(`/api/documents/${GALA_DINNER}/send`) && r.request().method() === 'POST',
      { timeout: 60_000 },
    ),
    dialog.getByRole('button', { name: 'Send', exact: true }).click(),
  ]);
  expect(response.ok(), await response.text()).toBe(true);
  const body = (await response.json()) as { documentId: string | null; recipients: string[] };
  expect(body.documentId).toMatch(/^[0-9a-f-]{36}$/);
  expect(body.recipients).toEqual(CLIENT_CARD_EMAILS.split(','));

  // The screen reports the queue, not a send: the drain is a job.
  await expect(page.getByRole('dialog').getByRole('status')).toContainText(
    `is queued from timesheets@ to ${CLIENT_CARD_EMAILS.split(',').join(', ')}`,
  );

  // Underneath: one row, under the register's key, in the register's shape.
  const key = `D1:document:${body.documentId}`;
  expect(sql(`select count(*) from notification_outbox where key = ${lit(key)}`)).toBe('1');
  expect(
    sql(
      `select template || '|' || channel || '|' || array_to_string(recipient_emails, ',')
         from notification_outbox where key = ${lit(key)}`,
    ),
  ).toBe(`D1|email|${CLIENT_CARD_EMAILS}`);
  // The document knows its own email, so a second press on the same copy
  // would be the same key — and `on conflict (key) do nothing`.
  expect(sql(`select outbox_key from event_documents where id = ${lit(body.documentId!)}`)).toBe(key);
  // And the PO number rides on it (§11.3: one PDF per event, PO on it).
  expect(sql(`select payload ->> 'poNumber' from notification_outbox where key = ${lit(key)}`)).toBe(
    '4471-A',
  );
});
