#!/usr/bin/env bash
# =====================================================================
# The whole product, running locally, in a sandbox with NO Docker and no
# route to *.supabase.co / *.vercel.app (Claude Code cloud sessions).
#
#   Postgres 16 :54322  — every migration + seed.sql, GoTrue's real auth schema
#   PostgREST  :54330   — /rest/v1
#   GoTrue     :9999    — /auth/v1 (built from source via the Go module proxy)
#   gateway    :54321   — stands in for Kong: NEXT_PUBLIC_SUPABASE_URL
#   office :3000 · staff :3001 · client :3002 — production builds (next start)
#
# Not running: Storage, Edge Functions, Realtime, outbound email. Pages that
# need them degrade; judge how they degrade, not that they do.
#
# usage (as root):
#   scripts/local-stack/up.sh setup      # once: apt packages, PostgREST, GoTrue → $STACK
#   scripts/local-stack/up.sh db         # (re)create the database: auth schema, migrations, seed
#   scripts/local-stack/up.sh serve      # foreground: postgres + PostgREST + GoTrue + gateway
#   scripts/local-stack/up.sh apps [office client staff]   # foreground: build + next start
#
# Run `serve` and `apps` as background tasks. Logins: every seeded user's
# password is password123 (supabase/seed.sql). Playwright from node:
#   chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
# =====================================================================
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HERE/../.." && pwd)
STACK=${STACK:-/opt/stack}; PGBIN=/usr/lib/postgresql/16/bin; PGDIR=$STACK/pg; PGPORT_=54322
JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long
mkdir -p "$STACK/run"

jwt() { # jwt <role> — a long-lived HS256 key like `supabase start` prints
  node -e "const c=require('crypto');const b=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const h=b({alg:'HS256',typ:'JWT'}),p=b({iss:'supabase-demo',role:process.argv[1],exp:1983812996});
console.log(h+'.'+p+'.'+c.createHmac('sha256','$JWT_SECRET').update(h+'.'+p).digest('base64url'))" "$1"
}

pg_up() {
  su postgres -c "$PGBIN/pg_ctl -D $PGDIR/data status" >/dev/null 2>&1 ||
    su postgres -c "$PGBIN/pg_ctl -D $PGDIR/data -o '-p $PGPORT_ -k $PGDIR -c listen_addresses=127.0.0.1 -c timezone=UTC' -l $PGDIR/log start -w" >/dev/null
}

case "${1:-}" in
setup)
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q postgresql-16-postgis-3 postgresql-16-pgtap \
    libtap-parser-sourcehandler-pgtap-perl skopeo >/dev/null
  # PostgREST: a static binary inside the Docker Hub image (Docker Hub blobs are reachable; GitHub releases are not).
  if [ ! -x "$STACK/bin/postgrest" ]; then
    skopeo copy --override-os linux --override-arch amd64 docker://docker.io/postgrest/postgrest:v12.2.3 "dir:$STACK/postgrest-img"
    for l in "$STACK"/postgrest-img/*; do tar -tzf "$l" 2>/dev/null | grep -q 'bin/postgrest' && tar -xzf "$l" -C "$STACK"; done
  fi
  # GoTrue: Supabase's own blob CDNs are refused, the Go module proxy is not — build it.
  if [ ! -x "$STACK/gotrue-bin" ]; then
    export GOPATH=$STACK/go
    dir=$(cd "$STACK" && go mod download -json github.com/supabase/auth@master | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).Dir))")
    cp -r "$dir" "$STACK/authsrc"; chmod -R u+w "$STACK/authsrc"
    # the module zip omits internal/forks/godotenv, which go.mod replaces; use upstream
    sed -i '/joho\/godotenv.*=>/d' "$STACK/authsrc/go.mod"
    (cd "$STACK/authsrc" && go get github.com/joho/godotenv@v1.5.1 && go build -o "$STACK/gotrue-bin" .)
  fi
  # The pg_net / pg_cron stubs are created by the first run of pgtest-local.sh; borrow that.
  TESTS=001_rls_guard.sql "$REPO/scripts/pgtest-local.sh" "$REPO" >/dev/null 2>&1 || true
  echo "setup done → $STACK"
  ;;
db)
  if [ -d "$PGDIR/data" ]; then
    su postgres -c "$PGBIN/pg_ctl -D $PGDIR/data stop -m fast" >/dev/null 2>&1 || true
    mv "$PGDIR" "$STACK/pg.old.$(date +%s)"
  fi
  mkdir -p "$PGDIR"; chown postgres "$PGDIR"
  su postgres -c "$PGBIN/initdb -D $PGDIR/data -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null"
  pg_up
  export PGHOST=127.0.0.1 PGPORT=$PGPORT_ PGUSER=postgres PGDATABASE=postgres
  P="psql -X -q -v ON_ERROR_STOP=1"
  $P <<'SQL'
create role anon nologin noinherit; create role authenticated nologin noinherit; create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit password 'postgres'; grant anon, authenticated, service_role to authenticator;
create role supabase_admin superuser login password 'postgres'; create role supabase_storage_admin;
create role supabase_auth_admin login createrole noinherit password 'postgres';
grant anon, authenticated, service_role to postgres;
create schema extensions; create schema auth authorization supabase_auth_admin; create schema storage; create schema vault;
grant create on database postgres to supabase_auth_admin;
create extension pgcrypto with schema extensions; create extension "uuid-ossp" with schema extensions;
alter database postgres set search_path = "$user", public, extensions;
alter role supabase_auth_admin set search_path = auth;
alter role authenticator set statement_timeout = '8s';
SQL
  # GoTrue creates the real auth schema (the pgTAP harness only stubs it)
  (cd "$STACK" && set -a && . "$HERE/gotrue.env" && GOTRUE_DB_MIGRATIONS_PATH=$STACK/authsrc/migrations && set +a && ./gotrue-bin migrate)
  # storage + vault stand-ins and default grants: the same block pgtest-local.sh uses
  sed -n '/^create table storage.buckets/,/^grant usage on schema public/p' "$REPO/scripts/pgtest-local.sh" |
    grep -v 'grant all on auth.users' | $P
  $P <<'SQL'
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
grant usage on schema auth to postgres; grant all on all tables in schema auth to postgres, service_role;
create extension pgtap with schema extensions;
SQL
  for f in "$REPO"/supabase/migrations/*.sql; do
    $P -f "$f" >/dev/null 2>"$STACK/run/err" || { echo "MIGRATION FAILED: $(basename "$f")"; cat "$STACK/run/err"; exit 1; }
  done
  $P -f "$REPO/supabase/seed.sql" >/dev/null
  echo "db ready: $(ls "$REPO"/supabase/migrations/*.sql | wc -l) migrations + seed"
  ;;
serve)
  pg_up
  cd "$STACK"
  "$STACK/bin/postgrest" "$HERE/postgrest.conf" >"$STACK/run/postgrest.log" 2>&1 &
  (set -a; . "$HERE/gotrue.env"; GOTRUE_DB_MIGRATIONS_PATH=$STACK/authsrc/migrations; set +a; exec "$STACK/gotrue-bin" serve) >"$STACK/run/gotrue.log" 2>&1 &
  node "$HERE/gateway.mjs" >"$STACK/run/gateway.log" 2>&1 &
  wait
  ;;
apps)
  shift; apps=("${@:-office client}"); [ $# -eq 0 ] && apps=(office client)
  export NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=$(jwt anon)
  export SUPABASE_SERVICE_ROLE_KEY=$(jwt service_role) APP_TZ=Europe/London
  export NEXT_PUBLIC_OFFICE_URL=http://127.0.0.1:3000 NEXT_PUBLIC_STAFF_URL=http://127.0.0.1:3001 NEXT_PUBLIC_CLIENT_URL=http://127.0.0.1:3002
  cd "$REPO"
  pnpm turbo run build $(printf -- '--filter=@thc/%s ' "${apps[@]}") >"$STACK/run/build.log" 2>&1 ||
    { tail -n 40 "$STACK/run/build.log"; exit 1; }
  for a in "${apps[@]}"; do
    port=$(case $a in office) echo 3000;; staff) echo 3001;; client) echo 3002;; esac)
    (cd "apps/$a" && exec pnpm exec next start -p "$port") >"$STACK/run/$a.log" 2>&1 &
  done
  wait
  ;;
*) sed -n '2,25p' "$0"; exit 1 ;;
esac
