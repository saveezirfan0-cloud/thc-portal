import { expect, test } from '@playwright/test';

/**
 * Client Portal — §11.1 the event list, §11.2 the event page.
 *
 * THESE DO NOT RUN ANYWHERE, and the fix is a fixture rather than an edit
 * here. They were written against an ungated portal — a local run with no
 * .env.local, where the middleware degraded open and the shell rendered
 * without a session. That state no longer exists. `7d28ba4` closed the auth
 * gate, so an app built without NEXT_PUBLIC_SUPABASE_URL now answers 503 on
 * every route instead of serving; locally the suite cannot boot at all, and
 * in CI, which points the apps at a real local Supabase, every route
 * redirects to /login and the beforeEach below skips them.
 *
 * What they need is a signed-in client session — the equivalent of the
 * openAsAdmin fixture office.shift-builder.spec.ts moved onto, which is why
 * that suite stopped skipping and this one did not. That belongs with the
 * seeded suite (docs/13 C1) rather than with a patch to this file.
 *
 * Until it exists the portal's behaviour is held by
 * supabase/tests/160_client_portal.sql and the unit tests over `rules.ts`,
 * both of which do run on every push. What is asserted below is the part
 * §11.1 is most emphatic about — the shape of the shell, and the fact that
 * no money reaches this app — so it is worth reviving, not deleting.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/client');
  // Ungated, the middleware degrades open and the portal renders. Gated —
  // which is CI since #15 — every route redirects, and these assertions
  // would otherwise report a missing heading for one missing session.
  test.skip(
    page.url().includes('/login'),
    'Client Portal is gated: run against the ungated CI build, or sign in first.',
  );
});

test('the bare domain lands on the event list', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/client$/);
});

test('the portal serves its own shell: a top bar and no sidebar (§11.1)', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Your events' })).toBeVisible();
  await expect(page.locator('header.ctop')).toBeVisible();
  // wireframes/client/events.html: "top bar only, no sidebar (the client has
  // one list and one page per event)". The Back Office rail must not appear
  // here — §1.4 keeps the customer out of the back office entirely.
  await expect(page.locator('aside.sidebar')).toHaveCount(0);
});

test('the event list offers the tabs the scope names (§11.1)', async ({ page }) => {
  for (const label of ['Upcoming & ongoing', 'Past', 'All']) {
    await expect(page.getByRole('button', { name: new RegExp(label, 'i') })).toBeVisible();
  }
  await expect(page.getByPlaceholder('Search events')).toBeVisible();
});

test('no money reaches the Client Portal (§11.1)', async ({ page }) => {
  // §11.1: "No money anywhere: no pay rates, no charge rates, no margin."
  // The views underneath carry no such column, so this is a belt-and-braces
  // check on the rendered page rather than the only thing standing between
  // a customer and a rate.
  const body = (await page.locator('body').innerText()).toLowerCase();
  for (const word of ['pay rate', 'charge rate', 'margin', '£']) {
    expect(body).not.toContain(word);
  }
});

test('the selection process is never named in the portal (§11.2)', async ({ page }) => {
  // Invited · Potential pool · Unavailable · Auto-assign stay internal to THC.
  const body = (await page.locator('body').innerText()).toLowerCase();
  for (const word of ['potential pool', 'unavailable', 'auto-assign', 'auto invite']) {
    expect(body).not.toContain(word);
  }
});

test('an event that belongs to nobody renders not-found, not a crash', async ({ page }) => {
  const response = await page.goto('/client/events/00000000-0000-4000-8000-000000000000', {
    waitUntil: 'domcontentloaded',
  });
  // Without a project the page reports that rather than 404ing; with one, a
  // stranger's id and a nonexistent id are indistinguishable by design.
  expect([200, 404]).toContain(response?.status() ?? 0);
});
