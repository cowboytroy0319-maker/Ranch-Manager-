#!/usr/bin/env bash
# ============================================================================
# preview-env.sh — the PREVIEW-ONLY scratch database + local preview env file.
#
#   scripts/preview-env.sh up      # idempotent: binaries → cluster → role+db → migrate → env file
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
# WHERE THE DATABASE LIVES (survives a machine replacement)
#   A machine replacement recreates the whole root filesystem and keeps only
#   /home. So the Postgres DATA directory and every credential file live under
#   /home, never under /var or /root:
#
#       data dir   : ${PREVIEW_PG_DATA:-<state dir>/ranch_preview-fs/ranch_preview-data}
#       disk image : ${PREVIEW_PG_IMAGE:-<state dir>/ranch_preview-data.img}
#       mount point: ${PREVIEW_PG_MOUNT:-<state dir>/ranch_preview-fs}
#       log        : ${PREVIEW_PG_LOG:-<state dir>/ranch_preview.log}
#       cred file  : ${PREVIEW_CRED_FILE:-<state dir>/preview-credentials}
#
#   WHY AN IMAGE + LOOP MOUNT: /home here is a virtiofs mount where chown is a
#   silent no-op (everything under /home stays root:root) and a non-root process
#   cannot reliably write. Postgres refuses to start as root AND refuses a data
#   directory with group/other bits, so a plain directory under /home is
#   unusable for the postgres OS user:
#
#       initdb: error: could not access directory ".../ranch_preview-data": Permission denied
#
#   The data therefore lives in an ext4 image file under /home, mounted at
#   $PG_DATA. Inside that filesystem ownership and modes behave normally, so the
#   postgres user owns its true data directory. Both the image and the mount
#   point are under /home, so the cluster survives a replacement; `up` remounts
#   the image and reuses the cluster already inside it.
#
#   The Postgres BINARIES are re-installable with apt, so they may live under
#   /usr; `up` reinstalls them when they are missing and then reuses the existing
#   data dir as-is (never re-initdb over it — the major version must match).
#
# SAFETY
#   * This script NEVER reads, writes or copies the production database. It only
#     ever talks to the LOCAL Postgres cluster via the `postgres` superuser
#     (peer auth over the unix socket) and to the dedicated `preview_app` role.
#   * The password lives ONLY in the chmod-600 env file and the chmod-600
#     credential file, both under /home. It is never printed, never logged,
#     never committed, and never passed in argv.
#   * Every psql/createdb call here uses a LOCAL socket/host on 127.0.0.1.
#   * Re-running `up` never drops or recreates the database.
# ============================================================================
set -euo pipefail

SITE_DIR="${SITE_DIR:-/home/team/shared/site}"
PG_STATE_DIR="${PREVIEW_PG_STATE_DIR:-/home/team/shared/.local/pg}"
PG_DATA="${PREVIEW_PG_DATA:-$PG_STATE_DIR/ranch_preview-fs/ranch_preview-data}"
PG_MOUNT="${PREVIEW_PG_MOUNT:-$PG_STATE_DIR/ranch_preview-fs}"
PG_IMAGE="${PREVIEW_PG_IMAGE:-$PG_STATE_DIR/ranch_preview-data.img}"
PG_IMAGE_SIZE_MB="${PREVIEW_PG_IMAGE_SIZE_MB:-256}"
# The log lives inside the mounted filesystem too: /home itself is not writable
# by the postgres OS user, and pg_ctl opens this file as that user.
PG_LOG="${PREVIEW_PG_LOG:-$PG_STATE_DIR/ranch_preview-fs/ranch_preview.log}"
CRED_FILE="${PREVIEW_CRED_FILE:-$PG_STATE_DIR/preview-credentials}"
# Pre-durability location; read-only fallback so an existing identity is reused.
LEGACY_CRED_FILE="${PREVIEW_LEGACY_CRED_FILE:-/root/.preview-env-credentials}"
ENV_FILE="$SITE_DIR/.preview-env"
PG_HOST="${PREVIEW_PG_HOST:-127.0.0.1}"
PG_PORT="${PREVIEW_PG_PORT:-5432}"
PG_SOCKET_DIR="${PREVIEW_PG_SOCKET_DIR:-/var/run/postgresql}"
DB_NAME="${PREVIEW_DB_NAME:-ranch_preview}"
DB_ROLE="${PREVIEW_DB_ROLE:-preview_app}"
# Database the automated tests use (see skills/local-postgres-testing).
CI_DB_NAME="${PREVIEW_CI_DB_NAME:-ranch_ci}"

say() { printf '%s\n' "$*"; }
die() { printf 'preview-env: %s\n' "$*" >&2; exit 1; }

need_root() { [ "$(id -u)" = "0" ] || die "must run as root (needs the postgres peer account)"; }
as_postgres() { runuser -u postgres -- "$@"; }
psql_super() { as_postgres psql -q -h "$PG_SOCKET_DIR" -p "$PG_PORT" "$@"; }

# --- binaries ----------------------------------------------------------------
pg_bindir() {
  local d
  for d in $(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V -r); do
    if [ -x "$d/initdb" ] && [ -x "$d/pg_ctl" ]; then printf '%s' "$d"; return 0; fi
  done
  return 1
}

ensure_binaries() {
  local bin
  if bin="$(pg_bindir)"; then return 0; fi
  say "Postgres binaries are missing (a machine replacement wipes /usr) — installing them with apt…"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq >/dev/null 2>&1 || true
  apt-get install -y -qq postgresql >/dev/null 2>&1 || apt-get install -y postgresql >&2 || \
    die "could not install postgresql with apt"
  bin="$(pg_bindir)" || die "postgresql installed but initdb/pg_ctl are still missing"
  say "installed Postgres binaries in $bin"
}

# --- cluster (data dir under /home) ------------------------------------------
cluster_is_running() {
  local bin; bin="$(pg_bindir)" || return 1
  as_postgres "$bin/pg_ctl" -D "$PG_DATA" status >/dev/null 2>&1
}

ensure_data_dir() {
  local bin; bin="$(pg_bindir)" || die "postgres binaries not found"
  mkdir -p "$PG_STATE_DIR"
  chmod 755 "$PG_STATE_DIR"

  # 1. The ext4 image that actually holds the cluster (a plain file under /home,
  #    so it survives a machine replacement).
  if [ ! -s "$PG_IMAGE" ]; then
    say "creating a ${PG_IMAGE_SIZE_MB}MB ext4 image for the cluster: $PG_IMAGE"
    dd if=/dev/zero of="$PG_IMAGE" bs=1M count="$PG_IMAGE_SIZE_MB" status=none || \
      die "could not create $PG_IMAGE"
    mkfs.ext4 -q -F "$PG_IMAGE" || die "could not format $PG_IMAGE"
  else
    say "cluster image already present: $PG_IMAGE ($(du -h "$PG_IMAGE" | cut -f1)) — left untouched"
  fi

  # 2. Mount it, then keep the cluster in a subdirectory of that filesystem
  #    (initdb refuses a bare mount point: it contains lost+found).
  mkdir -p "$PG_MOUNT" "$PG_STATE_DIR"
  if mountpoint -q "$PG_MOUNT"; then
    say "filesystem already mounted at $PG_MOUNT"
  else
    mount -o loop "$PG_IMAGE" "$PG_MOUNT" || die "could not mount $PG_IMAGE at $PG_MOUNT"
    say "mounted $PG_IMAGE at $PG_MOUNT"
  fi
  install -d -o postgres -g postgres -m 700 "$PG_DATA" 2>/dev/null || mkdir -p "$PG_DATA"
  # Inside the ext4 filesystem ownership works normally (unlike /home itself).
  chown postgres:postgres "$PG_MOUNT" "$PG_DATA" 2>/dev/null || true
  chmod 700 "$PG_MOUNT" "$PG_DATA"

  # 3. Initialise once; never over an existing cluster.
  if [ -s "$PG_DATA/PG_VERSION" ]; then
    say "cluster already initialised in $PG_DATA (Postgres $(cat "$PG_DATA/PG_VERSION")) — left untouched"
    return 0
  fi
  say "initialising a new cluster in $PG_DATA (initdb as the postgres OS user)"
  as_postgres "$bin/initdb" -D "$PG_DATA" -E UTF8 --auth-local=peer --auth-host=scram-sha-256 >/dev/null
  as_postgres touch "$PG_LOG" 2>/dev/null || true
  say "cluster initialised in $PG_DATA"
}

# A Debian-managed cluster (created by apt, under /var/lib/postgresql) grabs the
# same port and would block the /home cluster. Stop it: it is not the durable one.
stop_debian_cluster_on_port() {
  command -v pg_lsclusters >/dev/null 2>&1 || return 0
  local ver name port status
  while read -r ver name port status _rest; do
    [ -n "${port:-}" ] || continue
    [ "$port" = "$PG_PORT" ] || continue
    [ "$status" = "online" ] || continue
    say "stopping the Debian-managed cluster $ver/$name on port $PG_PORT (the /home cluster owns that port)"
    pg_ctlcluster "$ver" "$name" stop >/dev/null 2>&1 || true
  done < <(pg_lsclusters -h 2>/dev/null || true)
}

start_cluster() {
  local bin; bin="$(pg_bindir)" || die "postgres binaries not found"
  stop_debian_cluster_on_port
  if cluster_is_running; then
    say "cluster on $PG_HOST:$PG_PORT is already running from $PG_DATA"
    return 0
  fi
  install -d -o postgres -g postgres -m 2775 "$PG_SOCKET_DIR"
  say "starting the /home cluster on $PG_HOST:$PG_PORT (log: $PG_LOG)"
  as_postgres "$bin/pg_ctl" -D "$PG_DATA" -l "$PG_LOG" -w -t 60 \
    -o "-p $PG_PORT -c listen_addresses=$PG_HOST -c unix_socket_directories=$PG_SOCKET_DIR" start >/dev/null
}

ensure_cluster() {
  ensure_binaries
  ensure_data_dir
  start_cluster
  psql_super -tAc "SELECT 1" >/dev/null 2>&1 || die "local Postgres on $PG_HOST:$PG_PORT is not reachable"
}

# --- credentials -------------------------------------------------------------
read_cred() { # read_cred <file> <KEY>
  [ -f "$1" ] || return 1
  grep -E "^$2=" "$1" | head -1 | cut -d= -f2-
}

password_from_env_file() {
  [ -f "$ENV_FILE" ] || return 1
  grep -E '^PREVIEW_DATABASE_URL=' "$ENV_FILE" | head -1 | sed -nE 's#^[a-zA-Z]+://[^:]+:([^@]*)@.*#\1#p'
}

write_creds() { # write_creds <password>
  umask 077
  cat > "$CRED_FILE" <<EOF
# Preview-only database credentials (Ranch Manager Pro).
# Consumed by site/scripts/preview-env.sh — never commit, never copy into the tree.
# Lives under /home so it survives a machine replacement (/root and /var do not).
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
  # NOTE: every progress message here goes to STDERR. The caller runs this in a
  # command substitution (`pw="$(ensure_password)"`), so anything written to
  # stdout would be captured INTO the password.
  local pw
  pw="$(read_cred "$CRED_FILE" PREVIEW_DB_PASSWORD || true)"
  if [ -z "$pw" ]; then
    # Reuse the existing identity instead of generating a new one, so the
    # database name/role/password (and every URL and /preview-status fact) stay
    # exactly as they were before a machine replacement.
    pw="$(read_cred "$LEGACY_CRED_FILE" PREVIEW_DB_PASSWORD || true)"
    if [ -n "$pw" ]; then
      say "reusing the preview password from $LEGACY_CRED_FILE" >&2
    else
      pw="$(password_from_env_file || true)"
      [ -n "$pw" ] && say "reusing the preview password already in $ENV_FILE" >&2
    fi
  fi
  if [ -z "$pw" ]; then
    pw="$(openssl rand -hex 24)"
    say "generated a new preview-only password" >&2
  fi
  write_creds "$pw"
  say "credential file: $CRED_FILE (chmod 600, under /home)" >&2
  printf '%s' "$pw"
}

# --- role / database / migrations --------------------------------------------
ensure_role() { # ensure_role <password>
  # The password goes in on STDIN, never in argv (so it cannot show up in `ps`),
  # and never through a temp file (the postgres peer account could not read one).
  local pw="$1" exists
  exists="$(psql_super -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_ROLE'")"
  if [ "$exists" = "1" ]; then
    printf "ALTER ROLE %s WITH LOGIN PASSWORD '%s';\n" "$DB_ROLE" "$pw" | psql_super >/dev/null
    say "role $DB_ROLE already existed — password re-applied so the identity is unchanged"
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
    as_postgres createdb -h "$PG_SOCKET_DIR" -p "$PG_PORT" -O "$DB_ROLE" "$DB_NAME"
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
  say "  data dir  : $PG_DATA (under /home, survives a machine replacement)"
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

  say "=== cluster (durable, under /home) ==="
  say "  data dir  : $PG_DATA ($([ -s "$PG_DATA/PG_VERSION" ] && echo "Postgres $(cat "$PG_DATA/PG_VERSION")" || echo missing))"
  say "  image     : $PG_IMAGE ($([ -s "$PG_IMAGE" ] && du -h "$PG_IMAGE" | cut -f1 || echo MISSING))"
  say "  mounted   : $(mountpoint -q "$PG_MOUNT" && echo "yes ($PG_MOUNT)" || echo no)"
  say "  listening : $PG_HOST:$PG_PORT ($(cluster_is_running && echo running || echo stopped))"
  say "  cred file : $CRED_FILE ($([ -f "$CRED_FILE" ] && stat -c '%a %U:%G' "$CRED_FILE" || echo MISSING))"

  say "=== scratch database ==="
  local exists pw count
  exists="$(psql_super -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'")"
  if [ "$exists" = "1" ]; then
    pw="$(read_cred "$CRED_FILE" PREVIEW_DB_PASSWORD || read_cred "$LEGACY_CRED_FILE" PREVIEW_DB_PASSWORD || true)"
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

  say "=== test database (ranch_ci, same cluster) ==="
  exists="$(psql_super -tAc "SELECT 1 FROM pg_database WHERE datname='$CI_DB_NAME'")"
  say "  database $CI_DB_NAME : $([ "$exists" = "1" ] && echo present || echo "missing (run: preview-env.sh ci)")"
}

# Create/refresh the scratch database the automated tests use, in the same
# durable cluster, so a replaced machine can run `bun test` again.
cmd_ci() {
  need_root; ensure_cluster
  local exists
  exists="$(psql_super -tAc "SELECT 1 FROM pg_database WHERE datname='$CI_DB_NAME'")"
  if [ "$exists" != "1" ]; then
    as_postgres createdb -h "$PG_SOCKET_DIR" -p "$PG_PORT" -O postgres "$CI_DB_NAME"
    say "created test database $CI_DB_NAME (owner postgres)"
  else
    say "test database $CI_DB_NAME already exists — left in place"
  fi
  say "  DATABASE_URL=postgres://postgres:<local-postgres-password>@$PG_HOST:$PG_PORT/$CI_DB_NAME"
  say "  then: cd $SITE_DIR && DATABASE_URL=… bun run db:migrate && DATABASE_URL=… bun test"
}

case "${1:-}" in
  up) cmd_up ;;
  down) cmd_down ;;
  status) cmd_status ;;
  ci) cmd_ci ;;
  *) die "usage: scripts/preview-env.sh up|down|status|ci" ;;
esac
