import { expect, test, type Page } from '@playwright/test';
import {
  createCandidateInDocuments,
  databaseUnreachable,
  lit,
  removeCandidate,
  sql,
} from './_support/db';
import type { Candidate } from './_support/db';

/**
 * Account activation — §1.4, §2.7, §2.8 (E3), §10.2,
 * wireframes/public/activate.html, on the phone the candidate opens E3 on.
 *
 * The one rule this exists to hold: the personal link is spent by the
 * SUBMIT and never by a GET. Mail scanners open every link in an email
 * before the person does; a page that verified on load would hand every
 * candidate a dead link (apps/staff/app/activate/actions.ts). Only a
 * browser can prove that, because the page and the action are two
 * different requests and the difference between them is the whole point.
 *
 * The token is minted the way the office's Accept mints it
 * (packages/db/src/provision.ts → `auth.admin.generateLink`, type
 * `invite`): the same GoTrue Admin call over HTTP with the service key CI
 * exports, then `link_staff_account()` — the database half of
 * `onboarding_accept_with_account` (20260923180000). What comes back is
 * GoTrue's `hashed_token`, which is what E3 carries and what the page
 * verifies on submit. Whether the link is still live is read from the
 * database through `activation_preview()` — the read-only lookup the page
 * itself uses for its greeting — and `staff_account_activated()`
 * (20260924110000), which is true once the login has a password.
 *
 * Needs the CI stack: psql on 54322, and NEXT_PUBLIC_SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY for the Admin API. Skipped, with the reason,
 * where any of them is missing.
 */
const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'];
const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];

/** Ten characters, a letter, a number, none of the candidate's own name or email. */
const PASSWORD = 'Lantern-Harbour-2048';

async function admin<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey as string,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(
      `${init.method} /auth/v1/admin/${path}: ${response.status} ${await response.text()}`,
    );
  }
  return (await response.json()) as T;
}

/** provisionStaffLogin(), by hand: invite → app_metadata.role = staff → the hashed token. */
async function mintActivationToken(email: string): Promise<{ userId: string; token: string }> {
  const minted = await admin<{ id?: string; hashed_token?: string }>('generate_link', {
    method: 'POST',
    body: JSON.stringify({ type: 'invite', email }),
  });
  if (!minted.id || !minted.hashed_token) {
    throw new Error(`generate_link returned no user or no hashed_token: ${JSON.stringify(minted)}`);
  }
  await admin(`users/${minted.id}`, {
    method: 'PUT',
    body: JSON.stringify({ app_metadata: { role: 'staff' } }),
  });
  return { userId: minted.id, token: minted.hashed_token };
}

function previewName(token: string): string {
  return sql(`select coalesce(activation_preview(${lit(token)}) ->> 'firstName', '')`);
}

/**
 * "Activated" is what staff_account_activated() means — the login has a
 * password (20260924110000) — read here from auth.users directly, because
 * that function answers null to any caller who is not the office, the
 * service role or the person, and psql is none of those.
 */
function activated(staffId: string): string {
  return sql(
    `select coalesce((select coalesce(u.encrypted_password, '') <> '' from auth.users u
        join staff s on s.user_id = u.id where s.id = ${lit(staffId)}), false)`,
  );
}

async function fillAndSubmit(page: Page): Promise<void> {
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password', { exact: true }).fill(PASSWORD);
  const submit = page.getByRole('button', { name: 'Activate my account' });
  await expect(submit).toBeEnabled();
  await submit.click();
}

test.describe('/activate/:token', () => {
  let candidate: Candidate | null = null;

  test.beforeEach(async ({ page }) => {
    test.skip(databaseUnreachable() !== null, databaseUnreachable() ?? undefined);
    test.skip(
      !supabaseUrl || !serviceKey,
      'NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set: no GoTrue Admin API to mint a token with.',
    );
    const response = await page.goto('/activate');
    test.skip(response?.status() === 503, 'No Supabase project: the Staff App refuses to serve.');
  });

  test.afterEach(() => {
    removeCandidate(candidate);
    candidate = null;
  });

  test('a GET never spends the personal link; the submit does, and only once', async ({
    page,
    context,
  }) => {
    candidate = createCandidateInDocuments('activate');
    const { userId, token } = await mintActivationToken(candidate.email);
    sql(`select link_staff_account(${lit(candidate.staffId)}, ${lit(userId)})`);

    // The link is live and the login has no password: exactly the state
    // an accepted candidate is in when E3 arrives.
    expect(previewName(token)).toBe(candidate.firstName);
    expect(activated(candidate.staffId)).toBe('f');

    await test.step('opening the link — twice, as a mail scanner would — changes nothing', async () => {
      for (let visit = 0; visit < 2; visit += 1) {
        const response = await page.goto(`/activate/${token}`);
        expect(response?.ok()).toBe(true);
        await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
        // The greeting is the service-key preview; the form is there either way.
        await expect(
          page.getByRole('heading', { name: new RegExp(`Welcome, ${candidate!.firstName}`) }),
        ).toBeVisible();
        await expect(page.getByText(candidate!.email)).toBeVisible();
        await expect(page.getByRole('button', { name: 'Activate my account' })).toBeVisible();
        // Nothing to click yet: the password rules gate the button.
        await expect(page.getByRole('button', { name: 'Activate my account' })).toBeDisabled();

        expect(previewName(token), `visit ${visit + 1} spent the token`).toBe(candidate!.firstName);
        expect(activated(candidate!.staffId), `visit ${visit + 1} set a password`).toBe('f');
      }
    });

    await test.step('the submit spends it: a password is set and the wizard is next', async () => {
      await fillAndSubmit(page);
      await expect(page).toHaveURL(/\/activate\/done$/);

      expect(activated(candidate!.staffId)).toBe('t');
      // GoTrue clears the token on verify; the preview no longer finds anyone.
      expect(previewName(token)).toBe('');
      expect(
        sql(
          `select coalesce(confirmation_token, '') = ${lit(token)} from auth.users where id = ${lit(userId)}`,
        ),
      ).toBe('f');
    });

    await test.step('the same link, opened again elsewhere, is a spent link', async () => {
      // A fresh browser: no session and no retry marker from the first
      // submit. This is the candidate's phone after a friend's laptop.
      await context.clearCookies();
      await page.goto(`/activate/${token}`);
      // Nothing on load says it is dead — the page does not verify — so
      // the form shows; the action is what refuses.
      await fillAndSubmit(page);
      await expect(page.getByRole('status')).toContainText(
        'This link has expired or has already been used',
      );
      await expect(page).not.toHaveURL(/\/activate\/done$/);
      await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
    });
  });

  test('a link that is not a token at all is refused without touching the database', async ({
    page,
  }) => {
    await page.goto('/activate/not-a-token');
    await expect(page.getByRole('heading', { name: 'This link doesn’t work' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Activate my account' })).toHaveCount(0);
  });
});
