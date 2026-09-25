import { expect, type Page } from '@playwright/test';

/**
 * Opens a gated Back Office route, signing in first if the gate is live.
 *
 * The suite has to work in two environments. In CI `supabase start` is up and
 * the apps are pointed at it, so role routing (§1.4) redirects an anonymous
 * visitor to /login and a session is needed. On a developer machine with no
 * Supabase project the middleware passes everything through, and there is
 * nothing to sign in to. Rather than branch on an environment variable —
 * which goes stale the moment CI changes — this asks the app: if it sent us
 * to /login, sign in; otherwise carry on.
 *
 * Gisela is the seeded admin from supabase/seed.sql; Tom Reid is one of the
 * two seeded workers, and the one `seed.sql` links to a staff record; Marco
 * V. is the seeded client contact at Leonardo Hotel St Pauls.
 */
const ADMIN_EMAIL = 'gisela@thehospitalitycompany.example';
const PASSWORD = 'password123';
const WORKER_EMAIL = 'tom.reid@example.com';
const CLIENT_EMAIL = 'marco@leonardo-stpauls.example';

/**
 * Signs in as anyone — a login a spec has just created for itself, say.
 * The three named fixtures below are this with the seeded accounts.
 */
export async function openAs(
  page: Page,
  path: string,
  email: string,
  password: string = PASSWORD,
): Promise<void> {
  return open(page, path, email, password);
}

async function open(page: Page, path: string, email: string, password = PASSWORD): Promise<void> {
  await page.goto(path);
  if (!new URL(page.url()).pathname.startsWith('/login')) return;

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // The middleware's `next` carries the pathname only, so a route that
  // depends on its query string has to be asked for again by hand.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  await page.goto(path);
  await expect(page).not.toHaveURL(/\/login/);
}

export async function openAsAdmin(page: Page, path: string): Promise<void> {
  return open(page, path, ADMIN_EMAIL);
}

/**
 * The Staff App's own gate (§1.4). Tom holds `worked`, `confirmed` and
 * `invited` bookings in the seed, which is what makes all three tabs render
 * something rather than an empty state.
 */
export async function openAsWorker(page: Page, path: string): Promise<void> {
  return open(page, path, WORKER_EMAIL);
}

/**
 * The Client Portal's gate (§1.4, §11.1). Marco's profile carries
 * `client_id` = Leonardo Hotel St Pauls, which owns two seeded events: the
 * Gala Dinner (next Friday, upcoming) and the Lunch Service (two weeks ago,
 * completed, every booking `worked`). Everything else in the seed belongs
 * to another customer and must be invisible to him.
 */
export async function openAsClient(page: Page, path: string): Promise<void> {
  return open(page, path, CLIENT_EMAIL);
}
