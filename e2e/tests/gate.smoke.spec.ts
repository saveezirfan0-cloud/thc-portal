import { expect, test } from '@playwright/test';

/**
 * Role routing (§1.4), the first of the two gates in front of row-level
 * security. Runs per project, so each app is checked against its own
 * middleware.
 *
 * Two of the three need a Supabase project to mean anything. Every
 * middleware degrades open without one — "render the shell rather than
 * redirect-looping" — so against the build CI produces there is no redirect
 * to assert, and the two tests below failed in all three apps rather than
 * telling anyone the gate was broken. They are skipped when the app is
 * ungated, the way the Shift Builder suite already skips itself when it is
 * gated: the same condition read from the other side.
 *
 * The third test needs no project and runs everywhere.
 */
test('an unauthenticated visitor is sent to sign in', async ({ page }) => {
  const response = await page.goto('/');
  test.skip(
    !page.url().includes('/login'),
    'No Supabase project: the middleware degrades open, so there is no redirect to assert.',
  );
  expect(response?.ok()).toBe(true);
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('the redirect remembers where the visitor was going', async ({ page }) => {
  await page.goto('/reports');
  test.skip(
    !page.url().includes('/login'),
    'No Supabase project: the middleware degrades open, so there is no redirect to assert.',
  );
  await expect(page).toHaveURL(/[?&]next=%2Freports/);
});

test('a sign-in page is reachable without a session', async ({ page }) => {
  const response = await page.goto('/login');
  expect(response?.ok()).toBe(true);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

/**
 * §1.4: "the client never sees the back office and vice versa". The Back
 * Office refuses a signed-in non-admin twice over — signIn() drops the
 * session and shows the generic message (`wireframes/backoffice/login.html`:
 * a client-portal account "is refused the same way" as a wrong password),
 * and the middleware answers any later request from a wrong-role session
 * with the 403 interstitial rather than the shell. Tom Reid is the seeded
 * worker (`_support/session.ts`), so this runs on the office project only;
 * the other two apps have their own gates and their own wrong roles.
 */
test('a worker signing in to the Back Office is refused like a wrong password', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'office',
    'The Back Office gate; the seeded worker is its wrong role.',
  );
  await page.goto('/');
  test.skip(
    !page.url().includes('/login'),
    'No Supabase project: the middleware degrades open, so there is no refusal to assert.',
  );

  await page.getByLabel('Email').fill('tom.reid@example.com');
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();

  // The same message a wrong password gets: nothing says "this is a staff
  // account" (§1.4, login.html error state).
  const alert = page.getByRole('status');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('Email or password is incorrect');
  await expect(alert).not.toContainText(/staff|worker|client|role/i);

  // Still on the sign-in card, and never the Back Office chrome.
  await expect(page).toHaveURL(/\/login/);
  await expect(page.locator('aside.sidebar')).toHaveCount(0);

  // The session was dropped, so a gated route asks to sign in again rather
  // than serving the shell or the wrong-app page.
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.locator('aside.sidebar')).toHaveCount(0);
});
