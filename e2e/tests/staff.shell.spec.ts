import { expect, test, type Page } from '@playwright/test';

/**
 * The Staff App's PWA shell — Scope §10.1, §10.2, §10.5.
 *
 * Two halves:
 *
 *   · the chrome, the manifest, the service worker and the auth screens,
 *     which need the app to be serving;
 *   · the four app-lock cases (§10.1), which need a worker in each state.
 *     `supabase/seed.sql` ships two staff logins and both are compliant,
 *     and the seed is another session's file, so these move ONE seeded
 *     worker (Amara) through the four states with the service key CI
 *     already exports, and put her back afterwards.
 *
 * Nothing here is skipped on `process.env.CI`. The app itself is asked:
 * since 7d28ba4 the middleware fails closed, so a staff app built without
 * NEXT_PUBLIC_SUPABASE_URL answers 503 on every route — and a 503 is the
 * environment saying it cannot run this suite, in its own words.
 */

const AMARA_STAFF_ID = '20000000-0000-4000-8000-000000000001';
const AMARA_EMAIL = 'amara.kalu@example.com';
const PASSWORD = 'password123';

/** A reason no worker may ever see (§9.6). Written, then looked for. */
const INTERNAL_REASON = 'INTERNAL-ONLY-REASON-DO-NOT-SHOW-THE-WORKER';

const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'];
const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];

/** True when the app is actually serving rather than answering 503. */
async function serving(page: Page): Promise<boolean> {
  const response = await page.request.get('/install');
  return response.status() !== 503;
}

/** Moves the seeded worker into a state. Service key: no RLS, no session. */
async function setStaff(fields: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${supabaseUrl}/rest/v1/staff?id=eq.${AMARA_STAFF_ID}`, {
    method: 'PATCH',
    headers: {
      apikey: serviceKey as string,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(fields),
  });
  if (!response.ok) throw new Error(`seeding the lock state failed: ${response.status}`);
}

const COMPLIANT = {
  status: 'compliant',
  block_kind: null,
  block_reason: null,
  quiz_attempts: 0,
  left_at: null,
  leave_reason: null,
};

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  if (!new URL(page.url()).pathname.startsWith('/login')) return;
  await page.getByLabel('Email').fill(AMARA_EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

test.describe('PWA shell (§10.1, §10.5)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      !(await serving(page)),
      'The staff app is answering 503: no Supabase in this environment.',
    );
  });

  test('the manifest is installable: standalone, named, three icons', async ({ page }) => {
    const response = await page.request.get('/manifest.webmanifest');
    expect(response.ok()).toBeTruthy();
    const manifest = (await response.json()) as {
      display: string;
      name: string;
      theme_color: string;
      start_url: string;
      icons: { sizes: string; purpose?: string }[];
    };
    // Installability is what unlocks Web Push on iOS 16.4+ (§10.5), so
    // these are load-bearing rather than cosmetic.
    expect(manifest.display).toBe('standalone');
    expect(manifest.name).toContain('Hospitality');
    expect(manifest.start_url).toBe('/shifts');
    expect(manifest.icons.map((i) => i.sizes)).toContain('512x512');
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBeTruthy();
  });

  test('the service worker is served, and is not answered with a redirect to /login', async ({
    page,
  }) => {
    const response = await page.request.get('/sw.js');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('javascript');
    const body = await response.text();
    // The two things the PWA is judged on: a precache manifest and a push
    // handler. Without the second, §8 does not exist on a phone.
    expect(body).toContain('precache');
    expect(body).toContain('push');
  });

  test('the install screen explains Add to Home Screen without a session', async ({ page }) => {
    await page.goto('/install');
    await expect(page).toHaveURL(/\/install/);
    await expect(page.getByText('Install the app').first()).toBeVisible();
    await expect(page.getByText('Add to Home Screen')).toBeVisible();
  });

  test('the offline shell renders on its own', async ({ page }) => {
    await page.goto('/offline');
    await expect(page.getByRole('heading', { name: /offline/i })).toBeVisible();
  });
});

test.describe('Auth A0–A3 (§10.2)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      !(await serving(page)),
      'The staff app is answering 503: no Supabase in this environment.',
    );
  });

  test('A0 offers the way out: Forgot password', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await expect(page).toHaveURL(/\/forgot/);
    await expect(page.getByRole('heading', { name: /Forgot your password/i })).toBeVisible();
  });

  test('A1 → A2 says the same thing whether or not the account exists (§1.7)', async ({ page }) => {
    await page.goto('/forgot');
    await page.getByLabel('Email').fill('nobody-at-all@example.com');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page).toHaveURL(/\/forgot\/sent/);
    // "If … is registered" — never "we've sent you an email", which would
    // turn this screen into an account-enumeration oracle.
    await expect(page.getByText(/If .* is registered/)).toBeVisible();
  });

  test('A3 refuses to pretend a spent link still works', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/reset');
    await expect(page.getByText(/expired or has already been used/i)).toBeVisible();
  });
});

test.describe('The shell around a compliant worker (§10.1)', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    test.skip(
      !(await serving(page)),
      'The staff app is answering 503: no Supabase in this environment.',
    );
    test.skip(
      !serviceKey || !supabaseUrl,
      'No service key: cannot put a seeded worker into a state.',
    );
    await setStaff(COMPLIANT);
    await signIn(page);
  });

  test.afterAll(async () => {
    if (serviceKey && supabaseUrl) await setStaff(COMPLIANT);
  });

  test('the bottom navigation is Documents · Shifts · Invites · Radar, in that order', async ({
    page,
  }) => {
    await page.goto('/shifts');
    const nav = page.locator('nav.bottom-nav');
    await expect(nav).toBeVisible();
    // Direct children only: each tab carries inner spans for its label and
    // its count, and matching those would count eleven tabs.
    await expect(nav.locator('> a, > span')).toHaveText([
      /Documents/,
      /Shifts/,
      /Invites/,
      /Radar/,
    ]);
    // Nothing is locked for a compliant worker: the three built tabs are
    // links, and none of them carries the locked state.
    await expect(nav.locator('> a')).toHaveCount(3);
    await expect(nav.locator('.locked')).toHaveCount(0);
  });

  test('the avatar opens the profile sheet, with the help line and the P45 action', async ({
    page,
  }) => {
    await page.goto('/shifts');
    await page.getByRole('button', { name: 'Your profile' }).click();
    const sheet = page.getByRole('dialog', { name: 'Your profile' });
    await expect(sheet).toBeVisible();
    // §10.1's three links, the sign-out, the contact LINE (not a screen),
    // and §10.6's action at the very bottom.
    await expect(sheet.getByText('Profile details')).toBeVisible();
    await expect(sheet.getByText('Security settings')).toBeVisible();
    await expect(sheet.getByText('Payment information')).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await expect(sheet.getByText('admin@thehospitalitycompany.co.uk').first()).toBeVisible();
    await expect(sheet.getByText(/Request my P45/)).toBeVisible();
  });
});

test.describe('App lock — the four cases (§10.1)', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    test.skip(
      !(await serving(page)),
      'The staff app is answering 503: no Supabase in this environment.',
    );
    test.skip(
      !serviceKey || !supabaseUrl,
      'No service key: cannot put a seeded worker into a state.',
    );
    await signIn(page);
  });

  test.afterEach(async () => {
    if (serviceKey && supabaseUrl) await setStaff(COMPLIANT);
  });

  test('1 · an expired document leaves ONLY Documents open (§4.3)', async ({ page }) => {
    await setStaff({ status: 'blocked', block_kind: 'auto_document', block_reason: null });
    await page.goto('/shifts');

    await expect(page.getByText('You have been blocked — update your document.')).toBeVisible();
    // The other three tabs are not links. A locked tab that is still
    // pressable is a different promise from one that is not.
    const nav = page.locator('nav.bottom-nav');
    await expect(nav.locator('[aria-disabled="true"]')).toHaveCount(4);
    await expect(nav.locator('a')).toHaveCount(0);
    // Documents is present and is the only tab not locked. It renders as
    // text rather than a link only because the Documents hub itself is
    // still to be built (S4); the lock state it carries is the real one.
    await expect(nav.getByText('Documents')).toBeVisible();
    await expect(nav.locator('.locked')).toHaveCount(3);
  });

  test('2 · a manual block offers no Documents, and never the reason (§9.6)', async ({ page }) => {
    await setStaff({ status: 'blocked', block_kind: 'manual', block_reason: INTERNAL_REASON });
    await page.goto('/shifts');

    await expect(page.getByText('Your account is on hold.')).toBeVisible();
    await expect(page.getByText('admin@thehospitalitycompany.co.uk').first()).toBeVisible();
    // No navigation at all: there is nothing for the worker to do here.
    await expect(page.locator('nav.bottom-nav')).toHaveCount(0);
    // And the manager's note is internal. This is the assertion that
    // matters most on this screen.
    expect(await page.content()).not.toContain(INTERNAL_REASON);
  });

  test('3 · three quiz failures end in THC’s own wording (§2.9)', async ({ page }) => {
    await setStaff({ status: 'rejected', block_kind: null, quiz_attempts: 3 });
    await page.goto('/shifts');

    await expect(
      page.getByRole('heading', { name: /Health & Safety Assessment — Unsuccessful/ }),
    ).toBeVisible();
    await expect(page.getByText(/maximum number permitted at this stage/)).toBeVisible();
    await expect(page.locator('nav.bottom-nav')).toHaveCount(0);
  });

  test('4 · a leaver keeps only Payment information (§10.6)', async ({ page }) => {
    await setStaff({
      status: 'inactive',
      left_at: '2026-09-18T09:00:00Z',
      leave_reason: 'Moving away',
    });
    await page.goto('/shifts');

    await expect(page.getByText('You’ve left The Hospitality Company.')).toBeVisible();
    await expect(page.getByText(/P45 has been requested/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Payment information/ })).toBeVisible();
    // The bar stays, showing all four closed — that is the wireframe.
    const nav = page.locator('nav.bottom-nav');
    await expect(nav).toBeVisible();
    await expect(nav.locator('a')).toHaveCount(0);
  });

  test('a blocked worker can still reach the notification screen (§8)', async ({ page }) => {
    // N4 told them they were blocked and N15 will tell them they are not
    // any more, so push is exactly what a blocked worker needs most.
    await setStaff({ status: 'blocked', block_kind: 'auto_document' });
    await page.goto('/notifications');
    await expect(page.getByRole('button', { name: /Turn on notifications/ })).toBeVisible();
    // …while the navigation still shows the three tabs they cannot reach.
    await expect(page.locator('nav.bottom-nav a')).toHaveCount(0);
  });
});
