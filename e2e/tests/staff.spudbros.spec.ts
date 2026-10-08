import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openAs } from './_support/session';
import { databaseUnreachable, lit, sql } from './_support/db';
import { PASSWORD, createWorker, removeDay, runTag } from './_support/shift-day';
import type { Worker } from './_support/shift-day';

/**
 * SpudBros Express (ADR-0106) and the invite list (ADR-0107), through the real
 * forms and the real database: the list says who is SpudBros and what their
 * Payroll ID is, whichever link they use, and a SpudBros worker's app is a
 * Profile and nothing else.
 *
 * pgTAP 779 and 780 hold the rules; this proves the public form, the server
 * action, the RPC and the screens are wired to them.
 */
function dobForAge(age: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - age);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const unique = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const tag = unique.slice(-9);
/** The addresses and Payroll IDs this run made up, so cleanup touches nothing else. */
const person = (key: string) => ({
  email: `e2e.sb.${key}.${unique}@example.test`,
  payroll: `E2E${key.toUpperCase()}${tag}`,
});
const spudListed = person('a');
const thcListed = person('b');
const unlisted = person('c');
const ordinary = person('d');

// One worker runs the file: the invite-list rows are seeded once, in beforeAll,
// and consumed by the applications below.
test.describe.configure({ mode: 'serial' });

let spudWorker: Worker | null = null;

test.beforeAll(() => {
  if (databaseUnreachable()) return;
  sql(`
    insert into invite_roster (email, first_name, last_name, payroll_id, grp) values
      (${lit(spudListed.email)}, 'Sidney', 'Spudbros', ${lit(spudListed.payroll)}, 'spudbros'),
      (${lit(thcListed.email)},  'Thea',   'Normalton', ${lit(thcListed.payroll)}, 'thc')`);
  spudWorker = createWorker(runTag('sb'), 'Spudder', true);
  sql(`update staff set spudbros_express = true where id = ${lit(spudWorker.staffId)}`);
});

test.afterAll(() => {
  if (databaseUnreachable()) return;
  sql(
    `delete from invite_roster where email in (${[spudListed, thcListed]
      .map((p) => lit(p.email))
      .join(', ')})`,
  );
  removeDay(null, [spudWorker]);
  spudWorker = null;
});

test.beforeEach(async ({ page }) => {
  test.skip(databaseUnreachable() !== null, databaseUnreachable() ?? undefined);
  const response = await page.goto('/login');
  test.skip(response?.status() === 503, 'No Supabase project: the Staff App refuses to serve.');
});

async function apply(
  page: Page,
  path: '/apply' | '/apply/spudbros',
  who: { email: string },
  first: string,
  last: string,
  mobileSuffix: string,
) {
  // The per-caller throttle (5 an hour from one address) is not what is under
  // test, and every spec here applies from the same address.
  sql('delete from private.apply_caller_hits');
  await page.goto(path);
  await page.getByLabel('First name', { exact: true }).fill(first);
  await page.getByLabel('Surname', { exact: true }).fill(last);
  await page.getByLabel('Email', { exact: true }).fill(who.email);
  await page.getByLabel('Mobile', { exact: true }).fill(`7010 ${mobileSuffix}`);
  await page.getByLabel('Date of birth', { exact: true }).fill(dobForAge(24));
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Submit application' }).click();
  await expect(page).toHaveURL(/\/apply\/submitted$/);
}

function group(email: string): string {
  return sql(
    `select spudbros_express::text || ':' || coalesce(payroll_id, '-') from staff where email = ${lit(email)}`,
  );
}

test.describe('applying', () => {
  test('/apply/spudbros is its own page, with the same form', async ({ page }) => {
    await page.goto('/apply/spudbros');
    await expect(page.getByText('Onboarding with The Hospitality Company')).toBeVisible();
    for (const label of ['First name', 'Surname', 'Email', 'Mobile', 'Date of birth']) {
      await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    }
  });

  test('a listed SpudBros person on the ORDINARY link is marked, with their Payroll ID', async ({
    page,
  }) => {
    await apply(page, '/apply', spudListed, 'Sidney', 'Spudbros', unique.slice(-6));
    expect(group(spudListed.email)).toBe(`true:${spudListed.payroll}`);
    // The row is consumed: the table is "invited, not applied yet".
    expect(sql(`select count(*) from invite_roster where email = ${lit(spudListed.email)}`)).toBe(
      '0',
    );
  });

  test('a listed THC person on the SPUDBROS link stays THC — the list wins', async ({ page }) => {
    await apply(page, '/apply/spudbros', thcListed, 'Thea', 'Normalton', `1${unique.slice(-5)}`);
    expect(group(thcListed.email)).toBe(`false:${thcListed.payroll}`);
  });

  test('an unlisted person on the SpudBros link is marked, with no Payroll ID', async ({
    page,
  }) => {
    await apply(page, '/apply/spudbros', unlisted, 'Una', 'Unlisted', `2${unique.slice(-5)}`);
    expect(group(unlisted.email)).toBe('true:-');
  });

  test('an unlisted person on the ordinary link is an ordinary candidate', async ({ page }) => {
    await apply(page, '/apply', ordinary, 'Olive', 'Ordinary', `3${unique.slice(-5)}`);
    expect(group(ordinary.email)).toBe('false:-');
  });
});

test.describe('a SpudBros Express worker in the Staff App', () => {
  test('sees the Connecteam tag, and Documents stays open to them (ADR-0106)', async ({ page }) => {
    await openAs(page, '/profile', spudWorker!.email, PASSWORD);
    await expect(
      page.getByText('SpudBros Express Staff Only – scheduling on Connecteam').first(),
    ).toBeVisible();

    // Documents is where they renew a document: it must not bounce them back.
    await page.goto('/documents');
    await expect(page.getByText('Documents and details are under Profile')).toHaveCount(0);
  });

  test('has no shifts: the Shifts tab is the lock screen', async ({ page }) => {
    await openAs(page, '/shifts', spudWorker!.email, PASSWORD);
    await expect(
      page.getByText('SpudBros Express Staff Only – scheduling on Connecteam').first(),
    ).toBeVisible();
  });
});
