import { expect, test } from '@playwright/test';
import { openAs, openAsWorker } from './_support/session';
import {
  createActivatedLogin,
  createCandidateInDocuments,
  databaseUnreachable,
  lit,
  removeCandidate,
  sql,
} from './_support/db';
import type { Candidate } from './_support/db';

/**
 * The onboarding wizard — §10.3, Appendix A, wireframes/staff/onboarding-*.html,
 * on the phone a candidate walks it on.
 *
 * As far as the seed allows: a made-up candidate in `documents` with an
 * activated login (the state E3 + /activate leave behind) walks step 1 for
 * real — through the app, into `onboarding_save_right_to_work()` — and the
 * database is then moved to the "documents submitted" state by hand,
 * because steps 2–4 need a map pin, a camera and Storage uploads that a
 * headless phone cannot supply. From there the LOCK is real again: the
 * wizard pauses on the review hub, /onboarding/5 will not open, and the
 * working screens say "Not open to you yet" until the office verifies.
 *
 * supabase/tests/393_onboarding_journey.sql walks all eleven steps on the
 * database; what this adds is the screen: the order, the disabled
 * Continue, the gender the New Starter report needs (20260926100300), and
 * — for a worker who is through — that the shift card shows the base rate
 * and nothing else.
 *
 * SERIAL, at file level: every test signs in as the same made-up person,
 * and the third moves her on from where the second left her.
 */
test.describe.configure({ mode: 'serial' });

const PASSWORD = 'Harbour-Lantern-4096';

/** The five §2.5 branches, in the order the screen lists them. */
const BRANCHES = [
  'UK or Irish citizen',
  'EU / EEA — settled or pre-settled status',
  'Work visa',
  'International student',
  'Dependant or other visa',
];

let candidate: Candidate | null = null;

test.beforeAll(() => {
  if (databaseUnreachable()) return;
  candidate = createCandidateInDocuments('wizard');
  createActivatedLogin(candidate, PASSWORD);
});

test.afterAll(() => {
  removeCandidate(candidate);
  candidate = null;
});

test.beforeEach(async ({ page }) => {
  test.skip(databaseUnreachable() !== null, databaseUnreachable() ?? undefined);
  const response = await page.goto('/login');
  test.skip(response?.status() === 503, 'No Supabase project: the Staff App refuses to serve.');
});

test('a candidate lands on step 1 of 11, and no later step will open first (§10.3, Appendix A)', async ({
  page,
}) => {
  await openAs(page, '/onboarding', candidate!.email, PASSWORD);
  await expect(page).toHaveURL(/\/onboarding\/1$/);
  await expect(page.getByText('1/11 · Right to work')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Which describes you?' })).toBeVisible();

  // The five branches, as radios, in the scope's order.
  const options = page.getByRole('radiogroup', { name: 'Right to work' }).getByRole('radio');
  await expect(options).toHaveCount(BRANCHES.length);
  for (const [i, title] of BRANCHES.entries()) {
    await expect(options.nth(i)).toContainText(title);
    await expect(options.nth(i)).toHaveAttribute('aria-checked', 'false');
  }

  // "Continue is disabled until the step is complete", and says why.
  await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
  await expect(page.getByText('Choose one to continue')).toBeVisible();

  // No bottom navigation for a candidate (§10.1 case 1): the wizard is all
  // there is, and the chrome says so.
  await expect(page.locator('.bottom-nav')).toHaveCount(0);
  await expect(page.getByText('Onboarding', { exact: true })).toBeVisible();

  // Steps are opened in order: asking for a later one goes back to the
  // current one, never forward.
  for (const later of [2, 4, 11]) {
    await page.goto(`/onboarding/${later}`);
    await expect(page).toHaveURL(/\/onboarding\/1$/);
  }
});

test('step 1 needs Male or Female before Continue, and moves on to 2/11 (20260926100300, §9.9)', async ({
  page,
}) => {
  await openAs(page, '/onboarding/1', candidate!.email, PASSWORD);
  await page.getByRole('radio', { name: 'UK or Irish citizen' }).click();
  await expect(page.getByRole('heading', { name: 'UK / Irish citizen' })).toBeVisible();

  const next = page.getByRole('button', { name: 'Continue' });
  await expect(next).toBeDisabled();
  await expect(page.getByText('Date of birth and gender are required')).toBeVisible();

  await page.getByLabel(/Date of birth/).fill('1998-05-04');
  // The date alone used to be enough; the HMRC New Starter report takes
  // Gender (M/F), so the step now holds until it has one.
  await expect(next).toBeDisabled();
  await expect(page.getByText('Gender is required')).toBeVisible();

  const gender = page.getByRole('group', { name: 'Gender' });
  await expect(gender.getByRole('button', { name: 'Male' })).toBeVisible();
  await expect(gender.getByRole('button', { name: 'Female' })).toBeVisible();
  await gender.getByRole('button', { name: 'Male' }).click();
  await expect(gender.getByRole('button', { name: 'Male' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(next).toBeEnabled();

  await next.click();
  await expect(page).toHaveURL(/\/onboarding\/2$/);
  await expect(page.getByText('2/11 · Home address')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Where do you live?' })).toBeVisible();

  // Written by the RPC, as M, not merely held on the screen.
  expect(
    sql(
      `select gender || ':' || rtw_branch::text from staff where id = ${lit(candidate!.staffId)}`,
    ),
  ).toBe('M:uk_irish');
  expect(
    sql(
      `select rtw_at is not null from onboarding_progress where staff_id = ${lit(candidate!.staffId)}`,
    ),
  ).toBe('t');

  // Step 1 stays editable until the documents are submitted; step 3 is not
  // open yet.
  await page.goto('/onboarding/1');
  await expect(page).toHaveURL(/\/onboarding\/1$/);
  await page.goto('/onboarding/3');
  await expect(page).toHaveURL(/\/onboarding\/2$/);
});

test('with the documents submitted, everything waits for the office to verify them (§2.9, §10.1)', async ({
  page,
}) => {
  // Steps 2–4 need a map pin, a selfie and uploads; the database is put
  // where they would leave it. rtw_at is the real one from the test above.
  sql(`update onboarding_progress
          set address_at = now(), selfie_at = now(), documents_at = now()
        where staff_id = ${lit(candidate!.staffId)}`);

  await openAs(page, '/onboarding', candidate!.email, PASSWORD);
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByText('Steps 5–11 unlock once every document is verified')).toBeVisible();
  await expect(page.getByText('Onboarding', { exact: true })).toHaveCount(0);

  // The induction does not open early.
  await page.goto('/onboarding/5');
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByText('5/11')).toHaveCount(0);

  // And the working app is closed: Shifts says why and points back here.
  await page.goto('/shifts');
  await expect(page.getByRole('heading', { name: 'Not open to you yet' })).toBeVisible();
  await expect(page.getByText('Your documents are with the office.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue onboarding' })).toHaveAttribute(
    'href',
    '/onboarding',
  );
  // A locked screen shows no shift, and therefore no rate of any kind.
  expect(await page.locator('body').innerText()).not.toMatch(/£/);
});

test('a worker sees the base rate only — never the charge rate (§10.4, §11.1)', async ({
  page,
}) => {
  // Tom Reid is confirmed as Waiting Staff on the Gala Dinner: base £14.00,
  // charged to the client at £22.97. The card carries the first and must
  // not carry the second.
  await openAsWorker(page, '/shifts');
  await expect(page.locator('.bottom-nav')).toBeVisible();
  const card = page.locator('.mcard', { hasText: 'Gala Dinner' }).first();
  await expect(card).toContainText('£14.00/h');
  const body = await page.locator('body').innerText();
  expect(body).not.toContain('22.97');
  expect(body.toLowerCase()).not.toContain('charge');
  expect(body.toLowerCase()).not.toContain('margin');
});
