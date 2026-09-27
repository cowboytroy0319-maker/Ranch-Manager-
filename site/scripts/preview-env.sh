#!/usr/bin/env bash
# ============================================================================
# preview-env.sh — the PREVIEW-ONLY scratch database + local preview env file.
#
#   scripts/preview-env.sh up      # create role+db if missing, write .preview-env, migrate
#   scripts/preview-env.sh status  # print mode + database identity + migrations (no secrets)
#   scripts/preview-env.sh down    # remove .preview-env (the scratch DB is LEFT IN PLACE)
#
# WHAT THIS IS
#   The phone-reachable "working site" is the managed `vite dev` server in this
#   directory. `vite.config.ts` loads `.preview-env` (gitignored, chmod 600,
#   excluded from the shared-tree rsync) on `command === "serve"` ONLY, so the
#   dev server — and nothing else — runs with:
#
#       APP_ENV=preview
#       PREVIEW_DATABASE_URL=postgresql://<preview_app>@127.0.0.1:5432/ranch_preview
#       PREVIEW_ENV_EXPECTED=1
#
#   The published site never loads that file: it is named `.preview-env`, NOT
#   `.env.local`, because **Bun auto-loads `.env`/`.env.local` into `process.env`
#   for every process it starts in this directory** — including `bun run start`
#   (`serve.ts`, the published server) and a bare `bun run db:migrate`. A name Bun
#   does not recognise cannot leak preview mode into a published process, so the
#   three variables below reach the dev server through vite.config.ts ONLY.
#
# SAFETY
#   * This script NEVER reads, writes or copies the production database. It only
#     ever talks to the LOCAL Postgres cluster via the `postgres` superuser
#     (peer auth) and to the dedicated `preview_app` role.
#   * The generated password lives ONLY in two places: this directory's
#     `.preview-env` (chmod 600) and the root-only credential file (chmod 600).
#     It is never printed, never logged, never committed.
#   * Every psql/createdb call here uses a LOCAL socket/host on 127.0.0.1.
# ============================================================================
set -euo pipefail

SITE_DIR="${SITE_DIR:-/home/team/shared/site}"
CRED_FILE="${PREVIEW_CRED_FILE:-/root/.preview-env-credentials}"
ENV_FILE="$SITE_DIR/.preview-env"
PG_HOST="${PREVIEW_PG_HOST:-127.0.0.1}"
PG_PORT="${PREVIEW_PG_PORT:-5432}"
DB_NAME="${PREVIEW_DB_NAME:-ranch_preview}"
DB_ROLE="${PREVIEW_DB_ROLE:-preview_app}"

say() { printf '%s\n' "$*"; }
die() { printf 'preview-env: %s\n' "$*" >&2; exit 1; }

need_root() { [ "$(id -u)" = "0" ] || die "must run as root (needs the postgres peer account)"; }
psql_super() { runuser -u postgres -- psql -q -p "$PG_PORT" "$@"; }

ensure_cluster() {
  command -v psql >/dev/null 2>&1 || die "psql not found — is Postgres installed?"
  psql_super -tAc "SELECT 1" >/dev/null 2>&1 || die "local Postgres on $PG_HOST:$PG_PORT is not reachable"
}

# --- credentials -------------------------------------------------------------
read_cred() { # read_cred KEY
  [ -f "$CRED_FILE" ] || return 1
  grep -E "^$1=" "$CRED_FILE" | head -1 | cut -d= -f2-
}

write_creds() { # write_creds <password>
  umask 077
  cat > "$CRED_FILE" <<EOF
# Preview-only database credentials (Ranch Manager Pro).
# Consumed by site/scripts/preview-env.sh — never commit, never copy into the tree.
# Generated $(date -u +%Y-%m-%dT%H:%M:%SZ)
PREVIEW_DB_ROLE=$DB_ROLE
PREVIEW_DB_PASSWORD=$1
PREVIEW_DB_HOST=$PG_HOST
PREVIEW_DB_PORT=$PG_PORT
PREVIEW_DB_NAME=$DB_NAME
EOF
  chmod 600 "$CRED_FILE"
}

ensure_password() {
  local pw
  pw="$(read_cred PREVIEW_DB_PASSWORD || true)"
  if [ -z "$pw" ]; then
    pw="$(openssl rand -hex 24)"
    write_creds "$pw"
    say "generated a new preview-only password → $CRED_FILE (chmod 600)"
  fi
  printf '%s' "$pw"
}

# --- steps -------------------------------------------------------------------
ensure_role() { # ensure_role <password>
  # The password goes in on STDIN, never in argv (so it cannot show up in `ps`),
  # and never through a temp file (the postgres peer account could not read one).
  local pw="$1" exists
  exists="$(psql_super -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_ROLE'")"
  if [ "$exists" = "1" ]; then
    printf "ALTER ROLE %s WITH LOGIN PASSWORD '%s';\n" "$DB_ROLE" "$pw" | psql_super >/dev/null
    say "role $DB_ROLE already existed — password re-applied from the credential file"
  else
    printf "CREATE ROLE %s LOGIN PASSWORD '%s';\n" "$DB_ROLE" "$pw" | psql_super >/dev/null
    say "created role $DB_ROLE (LOGIN, no superuser, no CREATEDB)"
  fi
}

ensure_database() {
  local exists
  exists="$(psql_super -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'")"
  if [ "$exists" = "1" ]; then
    say "database $DB_NAME already exists — left exactly as it is (never dropped/recreated)"
  else
    runuser -u postgres -- createdb -p "$PG_PORT" -O "$DB_ROLE" "$DB_NAME"
    say "created database $DB_NAME owned by $DB_ROLE"
  fi
}

write_env_file() { # write_env_file <password>
  [ -d "$SITE_DIR" ] || die "site directory not found: $SITE_DIR"
  umask 077
  cat > "$ENV_FILE" <<EOF
# LOCAL PREVIEW ENVIRONMENT — gitignored, chmod 600, never committed.
# Written by scripts/preview-env.sh. Loaded by vite.config.ts ONLY when
# command === "serve" (the dev / working-site server). The built/published site
# never reads this file and stays on DATABASE_URL.
APP_ENV=preview
PREVIEW_ENV_EXPECTED=1
PREVIEW_DATABASE_URL=postgresql://$DB_ROLE:$1@$PG_HOST:$PG_PORT/$DB_NAME
EOF
  chmod 600 "$ENV_FILE"
  say "wrote $ENV_FILE (chmod 600) — APP_ENV=preview, PREVIEW_ENV_EXPECTED=1"
}

migrate() {
  local pw="$1" url
  url="postgresql://$DB_ROLE:$pw@$PG_HOST:$PG_PORT/$DB_NAME"
  if [ "${PREVIEW_ENV_SKIP_MIGRATE:-0}" = "1" ]; then
    say "skipping migrations (PREVIEW_ENV_SKIP_MIGRATE=1)"
    return 0
  fi
  say "applying migrations as $DB_ROLE (DATABASE_URL is stripped from the environment)…"
  ( cd "$SITE_DIR" && env -u DATABASE_URL \
      APP_ENV=preview PREVIEW_ENV_EXPECTED=1 PREVIEW_DATABASE_URL="$url" \
      bun run db:migrate )
}

print_identity() {
  say "  mode      : preview (APP_ENV=preview, PREVIEW_ENV_EXPECTED=1)"
  say "  db target : $DB_ROLE@$PG_HOST:$PG_PORT/$DB_NAME  (password never printed)"
}

cmd_up() {
  need_root; ensure_cluster
  local pw
  pw="$(ensure_password)"
  ensure_role "$pw"
  ensure_database
  write_env_file "$pw"
  migrate "$pw"
  say "preview environment is up:"
  print_identity
  say "  env file  : $ENV_FILE"
  say "  next      : open /preview-status on the preview URL to confirm mode + identity"
}

cmd_down() {
  if [ -f "$ENV_FILE" ]; then rm -f "$ENV_FILE"; say "removed $ENV_FILE"; else say "no $ENV_FILE"; fi
  say "the scratch database $DB_NAME is LEFT IN PLACE (drop it by hand only if the lead says so)"
}

cmd_status() {
  need_root; ensure_cluster
  say "=== preview env file ==="
  if [ -f "$ENV_FILE" ]; then
    say "  $ENV_FILE present ($(stat -c '%a' "$ENV_FILE") $(stat -c '%U:%G' "$ENV_FILE"))"
    say "  APP_ENV=$(grep -E '^APP_ENV=' "$ENV_FILE" | cut -d= -f2-)"
    say "  PREVIEW_ENV_EXPECTED=$(grep -E '^PREVIEW_ENV_EXPECTED=' "$ENV_FILE" | cut -d= -f2-)"
    local url ident
    url="$(grep -E '^PREVIEW_DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
    ident="$(printf '%s' "$url" | sed -E 's#^[a-zA-Z]+://([^:]+):[^@]*@#\1@#')"
    say "  PREVIEW_DATABASE_URL → $ident  (password stripped for display)"
  else
    say "  MISSING — run: scripts/preview-env.sh up"
  fi

  say "=== scratch database ==="
  local exists pw count
  exists="$(psql_super -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'")"
  if [ "$exists" = "1" ]; then
    pw="$(read_cred PREVIEW_DB_PASSWORD || true)"
    count="$(PGPASSWORD="$pw" psql -tA -h "$PG_HOST" -p "$PG_PORT" -U "$DB_ROLE" -d "$DB_NAME" \
      -c "SELECT count(*) FROM schema_migrations" 2>/dev/null || echo "unavailable")"
    say "  database $DB_NAME exists (owner $DB_ROLE)"
    say "  migrations applied: $count"
  else
    say "  database $DB_NAME does NOT exist — run: scripts/preview-env.sh up"
  fi

  say "=== production target comparison (host:port/dbname only) ==="
  local prod_key preview_key prod_host
  prod_key="$(printf '%s' "${DATABASE_URL:-}" | sed -E 's#^[a-zA-Z]+://[^@]*@##; s#\?.*$##')"
  prod_host="$(printf '%s' "$prod_key" | cut -d/ -f1)"
  preview_key="$PG_HOST:$PG_PORT/$DB_NAME"
  say "  preview  : $preview_key"
  say "  production: ${prod_key:-<DATABASE_URL not set in this shell>}"
  if [ -n "$prod_key" ] && [ "$prod_key" = "$preview_key" ]; then
    say "  EQUAL — the guard would REFUSE this configuration"
  else
    say "  different — the guard's preview rule passes"
  fi
  local prod_host_only
  prod_host_only="${prod_host%%:*}"
  if [ -n "$prod_host_only" ] && [ "$prod_host_only" = "$PG_HOST" ]; then
    say "  note: preview host equals the production host — the guard would REFUSE"
  else
    say "  preview host differs from the production host ${prod_host_only:-<none>}"
  fi
}

case "${1:-}" in
  up) cmd_up ;;
  down) cmd_down ;;
  status) cmd_status ;;
  *) die "usage: scripts/preview-env.sh up|down|status" ;;
esac
