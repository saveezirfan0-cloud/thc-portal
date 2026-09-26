import { type Locator, type Page, expect, test } from '@playwright/test';
import { openAsAdmin } from './_support/session';
import {
  type Candidate,
  createCandidateInDocuments,
  databaseUnreachable,
  lit,
  removeCandidate,
  sql,
} from './_support/db';

/**
 * /feedback — Scope §9.10, wireframes/backoffice/feedback.html.
 *
 * Markup and words: apps/office/app/feedback/FeedbackScreen.tsx (tabs,
 * toolbar, rows), _components/Stars.tsx (the aria-label), view-model.ts
 * (`eventLine`, `clientMetaLine`, `clientStatus`, `quoted`, `hrefFor`) and
 * _components/FeedbackDialogs.tsx (the Edit dialog's title).
 *
 * supabase/seed.sql writes no feedback at all, so the rows are made here:
 * one worker created for this file (unique name, never a seeded person),
 * one client entry on the seeded Awards Night (The Dorchester) and one
 * office entry by Gisela M. not tied to an event. The Lunch Service is left
 * alone — client.portal.spec.ts clears the client entries on it. The only
 * write through the screen is "Mark as read", on an entry the test itself
 * inserted. Everything is removed afterwards, best effort.
 */

const AWARDS_NIGHT = '60000000-0000-4000-8000-000000000005';
const DORCHESTER = '40000000-0000-4000-8000-000000000003';
const LEONARDO = '40000000-0000-4000-8000-000000000001';
/** Gisela M., the seeded admin every office spec signs in as. */
const GISELA = '10000000-0000-4000-8000-000000000001';

const clientList = (page: Page) => page.getByRole('list', { name: 'Client feedback' });
const officeList = (page: Page) => page.getByRole('list', { name: 'Office feedback' });
const entry = (list: Locator, text: string) =>
  list.getByRole('listitem').filter({ hasText: `“${text}”` });

test('two tabs, never one list: the client channel is read-only (§9.10)', async ({ page }) => {
  await openAsAdmin(page, '/feedback');

  const tabs = page.getByRole('tablist', { name: 'Feedback source' });
  await expect(tabs.getByRole('tab', { name: /^Client feedback/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(tabs.getByRole('tab', { name: 'Office feedback' })).toHaveAttribute(
    'aria-selected',
    'false',
  );
  await expect(clientList(page)).toBeVisible();
  await expect(page.getByText(/read-only channel — arrives from the Client Portal/)).toBeVisible();
  await expect(page.getByLabel('Filter by client')).toHaveValue('');
  await expect(
    page.getByRole('group', { name: 'Read state' }).getByRole('button', { name: 'All' }),
  ).toHaveAttribute('aria-pressed', 'true');

  await tabs.getByRole('tab', { name: 'Office feedback' }).click();
  await expect(page).toHaveURL(/\/feedback\?tab=office$/);
  await expect(officeList(page)).toBeVisible();
  await expect(page.getByLabel('Filter by author')).toHaveValue('');
  // Mark as read and the read-state filter belong to the client tab only.
  await expect(page.getByRole('group', { name: 'Read state' })).toHaveCount(0);
});

test.describe('entries about one worker', () => {
  let who: Candidate | null = null;
  let lastName = '';
  let clientText = '';
  let officeText = '';

  test.beforeAll(() => {
    const unreachable = databaseUnreachable();
    test.skip(unreachable !== null, unreachable ?? undefined);

    const unique = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    lastName = `Feedback${unique}`;
    clientText = `Client e2e ${unique}: slow to the pass`;
    officeText = `Office e2e ${unique}: covered a late call`;

    who = createCandidateInDocuments('feedback');
    sql(`update staff set last_name = ${lit(lastName)} where id = ${lit(who.staffId)}`);
    // The client entry arrives unread (as submit_client_feedback() writes
    // it); the office entry is Gisela's and counts from submission.
    sql(`
      insert into feedback (author_kind, author_id, staff_id, event_id, rating, text)
      values ('client', null, ${lit(who.staffId)}, ${lit(AWARDS_NIGHT)}, 2, ${lit(clientText)}),
             ('office', ${lit(GISELA)}, ${lit(who.staffId)}, null, 5, ${lit(officeText)});
    `);
  });

  test.afterAll(() => {
    if (!who) return;
    try {
      // As the database owner, which feedback_guard() does not bind.
      sql(`delete from feedback where staff_id = ${lit(who.staffId)}`);
    } catch (cause) {
      console.warn(`[e2e] could not remove feedback for ${who.email}: ${String(cause)}`);
    }
    removeCandidate(who);
  });

  const workerName = () => `Sparrow ${lastName}`;

  test('a client entry: stars, the worker and the event, unread and not in the rating', async ({
    page,
  }) => {
    await openAsAdmin(page, '/feedback');
    // The search is a form: it asks the server once, on Enter (§9.10).
    await page.getByRole('searchbox', { name: 'Search by staff name' }).fill(lastName);
    await page.getByRole('searchbox', { name: 'Search by staff name' }).press('Enter');
    await expect(page).toHaveURL(new RegExp(`[?&]q=${lastName}`));

    const row = entry(clientList(page), clientText);
    await expect(row).toBeVisible();
    await expect(row.locator('.stars')).toHaveAttribute('aria-label', '2 of 5 stars');
    await expect(row.locator('.stars')).toHaveText('★★☆☆☆');
    await expect(row.getByRole('link', { name: workerName() })).toHaveAttribute(
      'href',
      `/staff/${who!.staffId}`,
    );
    // eventLine(): title · client · UK day (no role — they were not booked).
    await expect(row.locator('.who .s')).toHaveText(
      /^Awards Night · The Dorchester · [A-Z][a-z]{2} \d{2} [A-Z][a-z]{2}$/,
    );
    // No portal user on the row, so the client's own name stands in.
    await expect(row.locator('.txt .m')).toHaveText(
      /^from The Dorchester \(client\) · submitted [A-Z][a-z]{2} \d{2} [A-Z][a-z]{2} \d{2}:\d{2}$/,
    );
    await expect(row.locator('.pill')).toHaveText('Unread — not in rating');
    await expect(row.getByRole('button', { name: 'Mark as read' })).toBeVisible();
    // Read-only: no Edit, and no Delete while the worker is not removed.
    await expect(row.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  });

  test('the client filter and the read state narrow the list, and live in the URL', async ({
    page,
  }) => {
    await openAsAdmin(page, `/feedback?q=${lastName}`);
    await expect(entry(clientList(page), clientText)).toBeVisible();

    await page.getByLabel('Filter by client').selectOption(DORCHESTER);
    await expect(page).toHaveURL(new RegExp(`client=${DORCHESTER}`));
    await expect(entry(clientList(page), clientText)).toBeVisible();

    await page.getByLabel('Filter by client').selectOption(LEONARDO);
    await expect(page).toHaveURL(new RegExp(`client=${LEONARDO}`));
    await expect(
      clientList(page).getByText('No client feedback matches these filters.'),
    ).toBeVisible();

    await page.getByLabel('Filter by client').selectOption(DORCHESTER);
    await expect(page).toHaveURL(new RegExp(`client=${DORCHESTER}`));
    await expect(entry(clientList(page), clientText)).toBeVisible();
    const state = page.getByRole('group', { name: 'Read state' });
    await state.getByRole('button', { name: 'Read', exact: true }).click();
    await expect(page).toHaveURL(/status=read/);
    await expect(entry(clientList(page), clientText)).toHaveCount(0);

    await state.getByRole('button', { name: /^Unread/ }).click();
    await expect(page).toHaveURL(/status=unread/);
    await expect(entry(clientList(page), clientText)).toBeVisible();
  });

  test('the office tab names the manager, and its entries can be edited (§9.10)', async ({
    page,
  }) => {
    await openAsAdmin(page, `/feedback?tab=office&q=${lastName}`);

    const row = entry(officeList(page), officeText);
    await expect(row).toBeVisible();
    await expect(row.locator('.stars')).toHaveAttribute('aria-label', '5 of 5 stars');
    await expect(row.locator('.who .s')).toHaveText('Not tied to an event');
    // The author is the manager's own name, never a generic "Office".
    await expect(row.locator('.pill')).toHaveText('Gisela M.');
    await expect(row.locator('.txt .m')).toHaveText(/^\d{2} [A-Z][a-z]{2} \d{4} · \d{2}:\d{2}$/);
    await expect(row.getByRole('button', { name: 'Mark as read' })).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'Delete' })).toBeVisible();
    await expect(
      page.getByLabel('Filter by author').locator('option', { hasText: 'Gisela M.' }),
    ).toHaveCount(1);

    // Edit opens on the entry; Cancel leaves it as it was.
    await row.getByRole('button', { name: 'Edit' }).click();
    const dialog = page.getByRole('dialog', { name: `Edit feedback · ${workerName()}` });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(row.locator('.txt .m')).not.toContainText('edited');
  });

  test('Mark as read puts a client entry into the rating, under the reader’s name', async ({
    page,
  }) => {
    // Its own entry, so the unread one above stays unread whatever order
    // the workers run these in.
    const readText = `Read e2e ${Date.now()}: excellent`;
    const id = sql(
      `insert into feedback (author_kind, author_id, staff_id, event_id, rating, text)
       values ('client', null, ${lit(who!.staffId)}, ${lit(AWARDS_NIGHT)}, 4, ${lit(readText)})
       returning id`,
    );

    await openAsAdmin(page, `/feedback?q=${lastName}`);
    const row = entry(clientList(page), readText);
    await expect(row.locator('.pill')).toHaveText('Unread — not in rating');
    await row.getByRole('button', { name: 'Mark as read' }).click();

    // clientStatus(): "Read · <reader> · 07 Sep" — the reader is Gisela.
    await expect(row.locator('.pill')).toHaveText(/^Read · Gisela M\. · \d{2} [A-Z][a-z]{2}$/);
    await expect(row.getByText('in rating', { exact: true })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Mark as read' })).toHaveCount(0);
    expect(sql(`select read_by from feedback where id = ${lit(id)}`)).toBe(GISELA);
  });
});
