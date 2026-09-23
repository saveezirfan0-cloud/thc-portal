#!/usr/bin/env bash
# =====================================================================
# Local stand-in for `supabase start && supabase test db`, for sandboxes
# with no Docker (docs/14 §7). Builds a throwaway PostgreSQL 16 cluster
# shaped like Supabase (anon/authenticated/service_role, auth.uid(),
# storage.objects, vault), applies every migration in order, runs
# seed.sql, then pg_prove over supabase/tests.
#
# Needs, as root (Debian/Ubuntu):
#   apt-get install postgresql-16 postgresql-16-postgis-3 postgresql-16-pgtap \
#                   postgresql-16-cron libtap-parser-sourcehandler-pgtap-perl
# pg_net has no package; a no-op stub is written below the first time.
#
# usage: scripts/pgtest-local.sh [repo_dir] [port]
#        TESTS="120_apply.sql 290_staff_directory.sql" scripts/pgtest-local.sh
#
# Expected locally: 002 assertions 6–7 fail (ADR-0010 — postgres owns
# PostGIS here, so the spatial_ref_sys gap is closed locally and open on
# Supabase). Anything else failing is real.
# =====================================================================
set -euo pipefail
EXT=/usr/share/postgresql/16/extension
if [ ! -f $EXT/pg_net.control ]; then
  printf "comment = 'local no-op stub of pg_net'\ndefault_version = '0.1'\nrelocatable = false\nschema = public\n" > $EXT/pg_net.control
  cat > $EXT/pg_net--0.1.sql <<'SQL'
create schema if not exists net;
create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb, timeout_milliseconds int default 5000) returns bigint language sql as $$ select 1::bigint $$;
create or replace function net.http_get(url text, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb, timeout_milliseconds int default 5000) returns bigint language sql as $$ select 1::bigint $$;
SQL
fi
REPO=$(cd "${1:-$PWD}" && pwd); PORT=${2:-$((50000 + RANDOM % 9000))}
BIN=/usr/lib/postgresql/16/bin; DIR=/tmp/thc-pg-$PORT
rm -rf "$DIR"; mkdir -p "$DIR"; chown postgres "$DIR"
su postgres -c "$BIN/initdb -D $DIR/data -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null"
su postgres -c "$BIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR -c shared_preload_libraries=pg_cron -c cron.database_name=postgres -c timezone=UTC' -l $DIR/log start -w >/dev/null"
trap 'su postgres -c "$BIN/pg_ctl -D $DIR/data stop -m immediate >/dev/null" || true; rm -rf "$DIR"' EXIT
export PGHOST=$DIR PGPORT=$PORT PGUSER=postgres PGDATABASE=postgres
P="psql -X -q -v ON_ERROR_STOP=1"
$P <<'SQL' >/dev/null
create role anon nologin noinherit; create role authenticated nologin noinherit; create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit; grant anon, authenticated, service_role to authenticator;
create role supabase_admin superuser; create role supabase_storage_admin; create role supabase_auth_admin;
grant anon, authenticated, service_role to postgres;
create schema extensions; create schema auth; create schema storage; create schema vault;
create extension pgcrypto with schema extensions;
alter database postgres set search_path = "$user", public, extensions;
set search_path = public, extensions;
create table auth.users (instance_id uuid, id uuid primary key, aud text, role text, email text, encrypted_password text,
  email_confirmed_at timestamptz, raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}',
  created_at timestamptz default now(), updated_at timestamptz default now(), phone text, last_sign_in_at timestamptz,
  confirmation_token text default '', recovery_token text default '', email_change_token_new text default '', email_change text default '',
  is_sso_user boolean default false, deleted_at timestamptz, banned_until timestamptz, is_anonymous boolean default false);
create table auth.identities (id uuid default gen_random_uuid() primary key, provider_id text, user_id uuid references auth.users on delete cascade,
  identity_data jsonb, provider text, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'sub')), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(coalesce(current_setting('request.jwt.claim.role', true), (nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'role')), '')::text $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb $$;
create table storage.buckets (id text primary key, name text not null unique, owner uuid, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], avif_autodetection boolean default false, created_at timestamptz default now(), updated_at timestamptz default now());
create table storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text references storage.buckets, name text, owner uuid, owner_id text,
  metadata jsonb, user_metadata jsonb, path_tokens text[] generated always as (string_to_array(name, '/')) stored, version text,
  created_at timestamptz default now(), updated_at timestamptz default now(), last_accessed_at timestamptz default now());
alter table storage.objects enable row level security; alter table storage.buckets enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'),1)-1] $$;
create function storage.filename(name text) returns text language sql immutable as $$ select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'),1)] $$;
create function storage.extension(name text) returns text language sql immutable as $$ select reverse(split_part(reverse(name), '.', 1)) $$;
create table vault.secrets (id uuid default gen_random_uuid() primary key, name text, secret text);
create view vault.decrypted_secrets as select id, name, secret, secret as decrypted_secret from vault.secrets;
grant usage on schema auth, storage, extensions to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects, storage.buckets to anon, authenticated, service_role;
grant all on auth.users to service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create extension pgtap with schema extensions;
SQL
for f in "$REPO"/supabase/migrations/*.sql; do
  $P -f "$f" >/dev/null 2>"$DIR/err" || { echo "MIGRATION FAILED: $(basename "$f")"; cat "$DIR/err"; exit 1; }
done
echo "migrations: $(ls "$REPO"/supabase/migrations/*.sql | wc -l) applied"
[ -f "$REPO/supabase/seed.sql" ] && { $P -f "$REPO/supabase/seed.sql" >/dev/null 2>"$DIR/err" || { echo "SEED FAILED"; cat "$DIR/err"; exit 1; }; echo "seed: ok"; }
cd "$REPO/supabase/tests"
if [ -n "${TESTS:-}" ]; then pg_prove --ext .sql $TESTS; else pg_prove -r --ext .sql --ext .pg . ; fi
