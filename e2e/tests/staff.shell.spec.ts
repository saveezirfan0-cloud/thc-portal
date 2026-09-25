import { expect, test, type Page } from '@playwright/test';
import { databaseUnreachable, lit, sql } from './_support/db';

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

/**
 * SERIAL, AT FILE LEVEL, AND IT HAS TO BE.
 *
 * Two describes below drive the SAME seeded worker (Amara) through
 * different states with the service key, so they must never overlap.
 * `mode: 'serial'` INSIDE each describe does not achieve that: with
 * `fullyParallel: true` (e2e/playwright.config.ts) a serial describe is one
 * ordered group in one worker, and two such groups are two groups — which
 * Playwright is free to hand to two workers at once. Measured, not
 * assumed: with a configure in each describe, the two started 46 ms apart
 * on workers 0 and 1 and ran concurrently for 1.5 s; moved here, all four
 * tests ran on worker 0, in order, with no overlap.
 *
 * That race is what made "the bottom navigation is Documents · Shifts ·
 * Invites · Radar" flaky. It asserted three LINKS and found zero, because
 * the app-lock describe had just set Amara to a state where every tab is a
 * locked span — the shape the nav takes for a leaver, and for the two
 * document locks. Nothing to do with the service worker or with the app.
 *
 * If another spec file ever seeds Amara, this comes back: Playwright has
 * no cross-file lock. Use a different seeded worker there.
 */
test.describe.configure({ mode: 'serial' });

const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'];
const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];

/** True when the app is actually serving rather than answering 503. */
async function serving(page: Page): Promise<boolean> {
  const response = await page.request.get('/install');
  return response.status() !== 503;
}

/** Moves the seeded worker into a state. Service key: no RLS, no session. */
async function setStaff(fields: Record<string, unknown>): Promise<void> {
  await rest(`staff?id=eq.${AMARA_STAFF_ID}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}

/**
 * The same, for a state the §2.12 machine refuses to enter directly —
 * compliant → rejected is not an edge, and since 20260927160900 the
 * database says so to the service role too. A fixture is not a transition,
 * so this one writes as the superuser with user triggers off, and is the
 * only way `rejected` is set or undone in this file.
 */
function forceStaff(fields: Record<string, string | number | null>): void {
  const set = Object.entries(fields)
    .map(([k, v]) => `${k} = ${v === null ? 'null' : typeof v === 'number' ? v : lit(v)}`)
    .join(', ');
  sql(
    `set session_replication_role = replica; update staff set ${set} where id = ${lit(AMARA_STAFF_ID)}`,
  );
}

/** A passport that expired yesterday, for the §4.3 re-check. */
const EXPIRED_DOC_ID = '62000000-0000-4000-8000-0000000000ff';

async function rest(path: string, init: RequestInit): Promise<Response> {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey as string,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(`${init.method} ${path} failed: ${response.status}`);
  return response;
}

async function addExpiredDocument(): Promise<void> {
  await removeExpiredDocument();
  await rest('compliance_docs', {
    method: 'POST',
    body: JSON.stringify({
      id: EXPIRED_DOC_ID,
      staff_id: AMARA_STAFF_ID,
      doc_type: 'passport',
      file_path: 'documents/873/expired-passport.pdf',
      expiry_date: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
      review_status: 'verified',
      needs_manual_review: false,
    }),
  });
}

async function removeExpiredDocument(): Promise<void> {
  await rest(`compliance_docs?id=eq.${EXPIRED_DOC_ID}`, { method: 'DELETE' });
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
    // Nothing is locked for a compliant worker: all four tabs are links
    // (Documents since S4), and none of them carries the locked state.
    await expect(nav.locator('> a')).toHaveCount(4);
    await expect(nav.locator('.locked')).toHaveCount(0);
  });

  test('the avatar is the way into the profile, on every tab (§10.1)', async ({ page }) => {
    // The sheet itself is /profile (#42) — its three links, the help line
    // and the §10.6 P45 flow are asserted by that session's own tests. What
    // belongs to the chrome is that every screen carries the avatar, that
    // it goes there, and that there is no profile TAB competing with it.
    for (const path of ['/shifts', '/invites', '/radar']) {
      await page.goto(path);
      const avatar = page.locator('header.app-header a.avatar-btn');
      await expect(avatar).toHaveAttribute('href', '/profile');
      await expect(avatar).toHaveAccessibleName('Your profile');
      await expect(page.locator('nav.bottom-nav').getByText('Profile')).toHaveCount(0);
    }
  });
});

test.describe('App lock — the four cases (§10.1)', () => {
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
    // `rejected` has no edge back to compliant either; the superuser undoes
    // it the way it was set, then the ordinary reset covers the rest.
    if (!databaseUnreachable()) forceStaff({ status: 'compliant', quiz_attempts: 0 });
    if (serviceKey && supabaseUrl) await setStaff(COMPLIANT);
  });

  test('1 · an expired document locks the app before any job has run (§4.3)', async ({ page }) => {
    // The worker's ROW still says compliant: the nightly sweep has not run
    // yet. `appLock()` re-checks `compliance_blockers()` itself, so the
    // passport that expired last night closes Shifts this morning rather
    // than tonight. Nothing else in the app asks that question.
    await setStaff(COMPLIANT);
    await addExpiredDocument();
    try {
      await page.goto('/shifts');
      await expect(page.getByText('You have been blocked — update your document.')).toBeVisible();
      // The reason is the real one, read off the blocker, not a guess from
      // the status.
      await expect(page.getByText(/1 expired document/)).toBeVisible();
      await expect(page.locator('nav.bottom-nav .locked')).toHaveCount(3);
    } finally {
      await removeExpiredDocument();
    }
  });

  test('1b · a block whose document is no longer nameable says so (§4.3)', async ({ page }) => {
    // The row says `auto_document` but `compliance_blockers()` names
    // nothing — the document that caused the block has since been replaced
    // and the nightly sweep has not caught up. The tab locking is
    // identical to the test above; the COPY is not, and deliberately.
    //
    // "Update your document" would be a dead end here: there is no
    // document to name, so the worker cannot tell which one to replace,
    // and the one they might re-upload is already the good one. This
    // asserts the honest version instead.
    await setStaff({ status: 'blocked', block_kind: 'auto_document', block_reason: null });
    await page.goto('/shifts');

    await expect(page.getByText('Your account is blocked.')).toBeVisible();
    await expect(page.getByText(/nothing for you to upload/)).toBeVisible();
    // The other three tabs are not links. A locked tab that is still
    // pressable is a different promise from one that is not.
    const nav = page.locator('nav.bottom-nav');
    await expect(nav.locator('[aria-disabled="true"]')).toHaveCount(3);
    // Documents is the only tab not locked, and the only link (S4).
    await expect(nav.locator('a')).toHaveCount(1);
    await expect(nav.getByRole('link', { name: 'Documents' })).toHaveAttribute(
      'href',
      '/documents',
    );
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
    test.skip(
      Boolean(databaseUnreachable()),
      'The quiz-failed state is not an edge of the §2.12 machine; only psql can set it.',
    );
    forceStaff({ status: 'rejected', block_kind: null, quiz_attempts: 3 });
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
    // The one live action a leaver keeps (§10.6 step 7). It is a link to
    // /profile/payments, not a dead button: their earnings history has to
    // stay reachable after they leave.
    await expect(page.getByRole('link', { name: /Payment information/ })).toHaveAttribute(
      'href',
      '/profile/payments',
    );
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
    // …while the navigation shows the three tabs they cannot reach closed,
    // and Documents — the one tab a document-blocked worker keeps (§4, "sees
    // ONLY the Documents tab") — open, now that /documents exists (S4).
    const links = page.locator('nav.bottom-nav a');
    await expect(links).toHaveCount(1);
    await expect(links.first()).toHaveAttribute('href', '/documents');
  });
});
