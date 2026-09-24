import { execFileSync } from 'node:child_process';

/**
 * The database side of a browser journey.
 *
 * Some things a screen does can only be proved underneath it: that a GET of
 * /activate/:token did NOT spend the token, that "Send" wrote exactly one
 * `notification_outbox` row under the register's key. CI has `psql` on the
 * runner (it replays supabase/seed.sql with it) and the local stack listens
 * on 54322, so a test can ask Postgres directly. Locally, with no stack,
 * `databaseUnreachable()` says so and the caller skips with that reason —
 * a spec must never fail for want of an environment.
 *
 * Everything here runs as the `postgres` superuser, which bypasses RLS. That
 * is the point for SEEDING (a candidate, a login) and for READING a table
 * the apps cannot; it is never used to stand in for what the app under test
 * should be doing itself.
 */
export const DATABASE_URL =
  process.env['E2E_DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let probe: { ok: true } | { ok: false; reason: string } | null = null;

/** Null when psql can reach the database; otherwise the reason to skip. */
export function databaseUnreachable(): string | null {
  if (probe === null) {
    try {
      run('select 1');
      probe = { ok: true };
    } catch (cause) {
      probe = {
        ok: false,
        reason: `No database at ${DATABASE_URL} (${describe(cause)}); the CI stack is not up here.`,
      };
    }
  }
  return probe.ok ? null : probe.reason;
}

/**
 * Runs one query (or one `do $$ … $$` block) and returns its output,
 * unaligned and tab-separated, with no header. Throws on any SQL error.
 */
export function sql(query: string): string {
  return run(query);
}

/** A SQL string literal, quoted. Every value a spec makes up goes through it. */
export function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function run(query: string): string {
  return execFileSync(
    'psql',
    [DATABASE_URL, '-X', '-q', '-A', '-t', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-c', query],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 },
  ).trim();
}

function describe(cause: unknown): string {
  if (cause && typeof cause === 'object' && 'stderr' in cause) {
    const err = String((cause as { stderr?: unknown }).stderr ?? '').trim();
    if (err) return err.split('\n')[0]!;
  }
  return cause instanceof Error ? cause.message : String(cause);
}

// ---------------------------------------------------------------------
// A candidate, made the way the pipeline makes one
// ---------------------------------------------------------------------

export interface Candidate {
  staffId: string;
  email: string;
  firstName: string;
  lastName: string;
}

/**
 * One person in `documents` — where an accepted candidate stands when E3
 * lands and the wizard opens (§2.4, §2.7).
 *
 * Not an insert into `staff`: the public form's own RPC creates the row,
 * exactly as supabase/tests/393_onboarding_journey.sql does, and the two
 * status moves after it go through the row guard (`staff_status_guard`),
 * so the person exists the only way the pipeline lets one exist. The
 * email is unique per call and the mobile is in Ofcom's 07010 drama
 * range, so neither arm of the §2.12 duplicate check can match a seeded
 * worker or an earlier run.
 */
export function createCandidateInDocuments(tag: string): Candidate {
  const unique = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `e2e.${tag}.${unique}@example.test`;
  const phone = `+447010${unique.slice(-6)}`;
  const firstName = 'Sparrow';
  const lastName = 'Journey';

  sql(
    `select submit_application(${lit(firstName)}, ${lit(lastName)}, ${lit(email)}, ${lit(phone)}, date '1998-05-04', true);
     update staff set status = 'interview_completed' where email = ${lit(email)};
     update staff set status = 'documents' where email = ${lit(email)};`,
  );
  const staffId = sql(`select id from staff where email = ${lit(email)}`);
  if (!/^[0-9a-f-]{36}$/.test(staffId)) {
    throw new Error(`submit_application did not create a staff row for ${email}: [${staffId}]`);
  }
  return { staffId, email, firstName, lastName };
}

/**
 * A login for a candidate who has ALREADY activated (has a password), the
 * way supabase/seed.sql makes its dev logins: `auth.users` + identity +
 * `profiles`, `app_metadata.role = staff` (the middleware reads that and
 * nothing else, §1.4), and `staff.user_id` pointing at it. Returns the
 * user id.
 *
 * For the activation journey itself this is the wrong tool — that one
 * mints a real GoTrue token; see staff.activation.spec.ts.
 */
export function createActivatedLogin(candidate: Candidate, password: string): string {
  const userId = sql('select gen_random_uuid()');
  const fullName = `${candidate.firstName} ${candidate.lastName}`;
  sql(`
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', ${lit(userId)}, 'authenticated', 'authenticated',
            ${lit(candidate.email)}, crypt(${lit(password)}, gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"],"role":"staff"}'::jsonb,
            jsonb_build_object('full_name', ${lit(fullName)}), now(), now());
    -- GoTrue reads these into non-nullable Go strings; NULL breaks every
    -- sign-in for the row (the seed's own note).
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
            jsonb_build_object('sub', ${lit(userId)}, 'email', ${lit(candidate.email)}, 'email_verified', true),
            'email', now(), now(), now());
    insert into profiles (id, role, full_name) values (${lit(userId)}, 'staff', ${lit(fullName)})
    on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;
    update staff set user_id = ${lit(userId)} where id = ${lit(candidate.staffId)};
  `);
  return userId;
}

/**
 * Takes a made-up person out again, login and all. Best effort: a failure
 * here is logged, never thrown — the emails are unique per run and CI's
 * database is thrown away, so a leftover row costs nothing, whereas a
 * cleanup that fails a green journey would hide the result that matters.
 */
export function removeCandidate(candidate: Candidate | null): void {
  if (!candidate) return;
  try {
    sql(`
      do $$
      declare v_staff uuid := ${lit(candidate.staffId)}; v_user uuid;
      begin
        select user_id into v_user from staff where id = v_staff;
        delete from notification_outbox where recipient_staff_id = v_staff;
        delete from applications where staff_id = v_staff;
        delete from audit_log where entity_id = v_staff or (v_user is not null and actor = v_user);
        delete from onboarding_progress where staff_id = v_staff;
        delete from compliance_docs where staff_id = v_staff;
        delete from criminal_declarations where staff_id = v_staff;
        delete from staff_roles where staff_id = v_staff;
        delete from staff where id = v_staff;
        if v_user is not null then
          delete from auth.users where id = v_user;
        end if;
      end $$;
    `);
  } catch (cause) {
    console.warn(`[e2e] could not remove ${candidate.email}: ${describe(cause)}`);
  }
}
