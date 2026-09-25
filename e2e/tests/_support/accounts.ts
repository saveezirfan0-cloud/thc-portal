import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { databaseUnreachable, lit, sql } from './db';
import { openAsAdmin } from './session';

/**
 * Back Office and Client Portal logins for the /users, /account and
 * /activity journeys (ADR-0035).
 *
 * Two ways a login comes to exist here, and they are not interchangeable:
 *
 *   inviteFromUsers()     the product's own way — a manager presses
 *                         "+ Invite user" on /users, the Back Office mints
 *                         the login with the service key and shows the
 *                         one-time set-up link. This is what the invite
 *                         journeys test, so they never seed the login.
 *   createOfficeLogin()   straight into auth.users with psql, the way
 *                         supabase/seed.sql makes its dev logins. For a
 *                         journey that needs a login of its OWN to change
 *                         (renaming the seeded admin would change the name
 *                         every other spec signs in as, while they run).
 */

/** The same ports as playwright.config.ts: the invite journeys cross apps. */
export const OFFICE_URL = 'http://127.0.0.1:3000';
export const CLIENT_URL = 'http://127.0.0.1:3002';

/** Ten characters, a letter, a number, and not in any breach list GoTrue checks. */
export const NEW_PASSWORD = 'Quayside-Heron-7315';

/** Gisela's name on `profiles` (supabase/seed.sql) — what /activity names her as. */
export const SEEDED_ADMIN_NAME = 'Gisela M.';

/** Leonardo Hotel St Pauls (supabase/seed.sql), Marco's client. */
export const SEEDED_CLIENT = {
  id: '40000000-0000-4000-8000-000000000001',
  name: 'Leonardo Hotel St Pauls',
} as const;

/** A suffix no earlier run and no parallel project can have used. */
export function unique(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

/**
 * Why this journey cannot run here, or null. Invites need everything the
 * CI browser job brings up: psql on 54322 (to clean up), and the service
 * key the Back Office mints logins with (ADR-0035 §2) — the spec cannot
 * see the server's environment, so it asks its own, which CI sets for
 * both (`pnpm turbo e2e:smoke` env in .github/workflows/ci.yml).
 */
export function inviteUnavailable(): string | null {
  const db = databaseUnreachable();
  if (db) return db;
  if (!process.env['NEXT_PUBLIC_SUPABASE_URL'] || !process.env['SUPABASE_SERVICE_ROLE_KEY']) {
    return 'NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set: the Back Office cannot mint an invite.';
  }
  return null;
}

/** True when an app refuses to serve because it was built without a Supabase project. */
export async function appUnconfigured(page: Page, url: string): Promise<boolean> {
  const response = await page.goto(url);
  return response?.status() === 503;
}

// ---------------------------------------------------------------------
// Seeded straight into the database
// ---------------------------------------------------------------------

export interface SeededLogin {
  userId: string;
  email: string;
  fullName: string;
}

/**
 * An office (or client) login that has already set its password: the
 * seed's shape — auth.users + identity + profiles, with
 * `app_metadata.role`, which is all the middleware reads (§1.4).
 */
export function createOfficeLogin(input: {
  tag: string;
  fullName: string;
  password: string;
  role?: 'admin' | 'client';
  clientId?: string | null;
}): SeededLogin {
  const role = input.role ?? 'admin';
  const email = `e2e.${input.tag}.${unique()}@example.test`;
  const userId = sql('select gen_random_uuid()');
  sql(`
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', ${lit(userId)}, 'authenticated', 'authenticated',
            ${lit(email)}, crypt(${lit(input.password)}, gen_salt('bf')), now(),
            jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', ${lit(role)}),
            jsonb_build_object('full_name', ${lit(input.fullName)}), now(), now());
    -- GoTrue reads these into non-nullable Go strings; NULL breaks every
    -- sign-in for the row (the seed's own note, and _support/db.ts).
    do $$
    declare col text;
    begin
      for col in
        select c.column_name from information_schema.columns c
         where c.table_schema = 'auth' and c.table_name = 'users'
           and c.column_name in ('confirmation_token','recovery_token','email_change',
                                 'email_change_token_new','email_change_token_current',
                                 'phone_change','phone_change_token','reauthentication_token')
           and c.data_type in ('text','character varying')
      loop
        execute format('update auth.users set %1$I = coalesce(%1$I, '''') where %1$I is null', col);
      end loop;
    end $$;
    insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), ${lit(userId)}, ${lit(userId)},
            jsonb_build_object('sub', ${lit(userId)}, 'email', ${lit(email)}, 'email_verified', true),
            'email', now(), now(), now());
    insert into profiles (id, role, full_name, client_id)
    values (${lit(userId)}, ${lit(role)}, ${lit(input.fullName)},
            ${input.clientId ? lit(input.clientId) : 'null'})
    on conflict (id) do update set role = excluded.role, full_name = excluded.full_name,
                                   client_id = excluded.client_id;
  `);
  return { userId, email, fullName: input.fullName };
}

/**
 * Takes a login a spec made — seeded or invited — out again, with the
 * audit rows about it and by it. Best effort, like removeCandidate(): the
 * addresses are unique per run and CI's database is thrown away, so a
 * leftover costs nothing, whereas a cleanup that fails a green journey
 * would hide the result that matters.
 */
export function removeLogin(email: string | null): void {
  if (!email || databaseUnreachable()) return;
  try {
    sql(`
      do $$
      declare v_user uuid;
      begin
        select id into v_user from auth.users where lower(email) = lower(${lit(email)});
        if v_user is null then return; end if;
        delete from audit_log where entity_id = v_user or actor = v_user;
        delete from auth.users where id = v_user;
      end $$;
    `);
  } catch (cause) {
    console.warn(`[e2e] could not remove ${email}: ${String(cause)}`);
  }
}

// ---------------------------------------------------------------------
// The product's own way: /users → Invite → the set-up link
// ---------------------------------------------------------------------

/**
 * Signs in to the Back Office as the seeded admin, invites one login on
 * /users and returns the set-up link the modal shows (it is shown once,
 * never emailed by the platform — ADR-0035 §3). Leaves `page` on /users
 * with the modal closed.
 */
export async function inviteFromUsers(
  page: Page,
  invitee: {
    role: 'admin' | 'client';
    fullName: string;
    email: string;
    jobTitle?: string;
    clientName?: string;
  },
): Promise<string> {
  await openAsAdmin(page, `${OFFICE_URL}/users`);
  await expect(page.getByRole('heading', { name: 'Users & access' })).toBeVisible();

  await page.getByRole('button', { name: '+ Invite user' }).click();
  const form = page.getByRole('dialog', { name: 'Invite a user' });
  await expect(form).toBeVisible();

  await form
    .getByRole('button', { name: invitee.role === 'admin' ? 'Back Office' : 'Client Portal' })
    .click();
  await form.getByLabel('Full name', { exact: true }).fill(invitee.fullName);
  await form.getByLabel('Email', { exact: true }).fill(invitee.email);
  if (invitee.role === 'admin') {
    if (invitee.jobTitle) {
      await form.getByLabel('Job title (optional)', { exact: true }).fill(invitee.jobTitle);
    }
  } else {
    await form
      .getByLabel('Client', { exact: true })
      .selectOption({ label: invitee.clientName ?? SEEDED_CLIENT.name });
  }
  await form.getByRole('button', { name: 'Create login' }).click();

  const ready = page.getByRole('dialog', { name: 'Login ready — send the link' });
  await expect(ready).toBeVisible();
  await expect(ready).toContainText(invitee.fullName);
  await expect(ready).toContainText(invitee.email);
  const link = await ready.getByLabel('Set-up link', { exact: true }).inputValue();
  await ready.getByRole('button', { name: 'Done' }).click();
  await expect(ready).toBeHidden();
  return link;
}

/**
 * Opens a set-up link in a browser of its own — no cookies from the
 * manager who made it, as on the invitee's own computer — chooses a
 * password, and submits. Returns that browser for the caller to assert
 * on and close.
 */
export async function acceptInviteLink(
  browser: Browser,
  link: string,
  password: string = NEW_PASSWORD,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Set up your login' })).toBeVisible();

  await page.getByLabel('Choose a password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password', { exact: true }).fill(password);
  const submit = page.getByRole('button', { name: 'Set password and sign in' });
  await expect(submit).toBeEnabled();
  await submit.click();
  return { context, page };
}
