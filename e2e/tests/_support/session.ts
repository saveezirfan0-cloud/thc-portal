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
 * Gisela is the seeded admin from supabase/seed.sql.
 */
const ADMIN_EMAIL = 'gisela@thehospitalitycompany.example';
const ADMIN_PASSWORD = 'password123';

export async function openAsAdmin(page: Page, path: string): Promise<void> {
  await page.goto(path);
  if (!new URL(page.url()).pathname.startsWith('/login')) return;

  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // The middleware's `next` carries the pathname only, so a route that
  // depends on its query string has to be asked for again by hand.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  await page.goto(path);
  await expect(page).not.toHaveURL(/\/login/);
}
