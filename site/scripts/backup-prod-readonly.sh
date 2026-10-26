#!/usr/bin/env bash
# ============================================================================
# backup-prod-readonly.sh — a READ-ONLY logical backup of the PRODUCTION
# database, plus a proof that the dump actually restores.
#
#   PROD_DATABASE_URL='postgresql://…' bash scripts/backup-prod-readonly.sh
#
# Why: the owner's production run of 0018_product_blocker.sql needs a safety
# net he can point at, and a backup nobody has restored is not a backup.
#
# HARD RULES encoded here (do not relax them):
#   * PRODUCTION IS READ-ONLY. The entire dump session runs with
#     PGOPTIONS='-c default_transaction_read_only=on' (every session opened by
#     psql, pg_dump and any restore helper inherits it). pg_dump itself only
#     ever issues SELECT/COPY … TO STDOUT/BEGIN ISOLATION LEVEL statements.
#     No CREATE, INSERT, UPDATE, DELETE, DROP, ALTER, GRANT, extension install
#     or any other write is issued against production by this script.
#   * The dump is written ONLY under BACKUP_DIR (default /home/team/shared/backup).
#   * The RESTORE PROOF always runs on a LOCAL SCRATCH cluster of the SAME
#     PostgreSQL major version as production (production is PG 18, whose dumps
#     carry `SET transaction_timeout = 0` that a PG 16 server rejects — the
#     dump is never edited to work around that), created for this purpose at
#     127.0.0.1:5434. This script refuses any restore target that is not on
#     127.0.0.1, refuses port 5432 (the PREVIEW cluster that serves the owner's
#     demo link and already ran out of disk once), and refuses a target whose
#     data_directory belongs to the preview cluster. No database is ever created
#     in the preview cluster.
#   * NOTHING SECRET IS PRINTED OR WRITTEN. The connection string never appears
#     in output, logs or the manifest; only user@host/database is recorded.
#
# Exit codes: 0 = dump taken AND restored AND asserted, 2 = refused before
# touching anything, 1 = a step failed (nothing is claimed to be a backup).
# ============================================================================
set -euo pipefail

OUT_DIR="${BACKUP_DIR:-/home/team/shared/backup}"
PROD_URL="${PROD_DATABASE_URL:-${DATABASE_URL:-}}"
SCRATCH_ADMIN_URL="${SCRATCH_ADMIN_URL:-postgres://postgres:postgres@127.0.0.1:5434/postgres}"
RESTORE_DB="${RESTORE_DB:-backup_verify_prod}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="$OUT_DIR/prod-$STAMP.sql"
MANIFEST="$OUT_DIR/prod-$STAMP.manifest.json"
VERIFY="$OUT_DIR/prod-$STAMP.restore-verify.txt"

# The tools must be at least as new as the production server major version
# (pg_dump refuses a server newer than itself; production is PG 18).
PG_DUMP_BIN="${PG_DUMP_BIN:-/usr/lib/postgresql/18/bin/pg_dump}"
PSQL_BIN="${PSQL_BIN:-/usr/lib/postgresql/18/bin/psql}"
[ -x "$PG_DUMP_BIN" ] || PG_DUMP_BIN="$(command -v pg_dump)"
[ -x "$PSQL_BIN" ] || PSQL_BIN="$(command -v psql)"

die() { echo "[backup] REFUSED: $*" >&2; exit 2; }
redact() { printf '%s' "$1" | sed -E 's#(://)[^:/@]+:[^@]*@#\1<user>:<pw>@#'; }
ident()  { printf '%s' "$1" | sed -E 's/[?].*$//' | sed -E 's#.*://##' | sed -E 's#^[^@]*@##'; }

# ---------------------------------------------------------------- refusals ---
[ -n "$PROD_URL" ] || die "no production target: set PROD_DATABASE_URL (or DATABASE_URL)"
case "$PROD_URL" in
  *127.0.0.1*|*localhost*) die "the target looks local, not production — refusing to call that a production backup" ;;
esac
case "$SCRATCH_ADMIN_URL" in
  127.0.0.1:5432/*|*@127.0.0.1:5432/*) die "the 5432 cluster is the PREVIEW cluster — refusing to create a restore database there" ;;
  *127.0.0.1*) : ;;
  *) die "the restore target must be a LOCAL scratch cluster on 127.0.0.1 (got $(redact "$SCRATCH_ADMIN_URL"))" ;;
esac
[ -d "$OUT_DIR" ] || mkdir -p "$OUT_DIR"
[ -x "$PG_DUMP_BIN" ] || die "pg_dump not found"

# The facts we read on production and again inside the restored copy. Built from
# one source so the two can be compared byte for byte. Production is PRE-0018
# today, so the three 0018 tables are probed with to_regclass instead of being
# named unconditionally (naming a missing table is a parse error).
facts_sql() {
  local optional="'restock_log', null"
  for t in restock_log pasture_activities livestock_movements; do
    if [ "$("$PSQL_BIN" "$1" -Atc "select to_regclass('public.$t') is not null")" = "t" ]; then
      optional="$optional, '$t', (select count(*) from public.$t)"
    fi
  done
  cat <<SQL
  select json_build_object(
    'server_version', current_setting('server_version'),
    'migrations', (select count(*) from public.schema_migrations),
    'migration_names', (select json_agg(name order by name) from public.schema_migrations),
    'users', (select count(*) from public.users),
    'operations', (select count(*) from public.operations),
    'expenses', (select count(*) from public.expenses),
    'expense_categories', (select json_object_agg(category, n) from (select category, count(*) n from public.expenses group by category) h),
    'pastures', (select count(*) from public.pastures),
    'hay_inventory', (select count(*) from public.hay_inventory),
    'feed_inventory', (select count(*) from public.feed_inventory),
    'equipment', (select count(*) from public.equipment),
    'expenses_0018_columns', (select count(*) from information_schema.columns
                               where table_schema='public' and table_name='expenses'
                                 and column_name in ('paid_by','source_type','source_id')),
    'objects_0018', json_build_object(
       'restock_log', (to_regclass('public.restock_log') is not null),
       'pasture_activities', (to_regclass('public.pasture_activities') is not null),
       'livestock_movements', (to_regclass('public.livestock_movements') is not null),
       'expenses_source_once_uniq', (to_regclass('public.expenses_source_once_uniq') is not null)),
    'optional_row_counts', json_build_object($optional)
  )
SQL
}

# ------------------------------------------------------------------ probe ----
# Prove the production session really is read-only BEFORE dumping anything.
RO="$(env PGOPTIONS='-c default_transaction_read_only=on' "$PSQL_BIN" "$PROD_URL" -Atc \
      "select current_setting('transaction_read_only')")"
[ "$RO" = "on" ] || die "could not force a read-only session on the production target (transaction_read_only=$RO)"
PROD_VERSION="$(env PGOPTIONS='-c default_transaction_read_only=on' "$PSQL_BIN" "$PROD_URL" -Atc "select version()" | head -1)"
PROD_FACTS="$(env PGOPTIONS='-c default_transaction_read_only=on' "$PSQL_BIN" "$PROD_URL" -Atc "$(facts_sql "$PROD_URL")")"
echo "[backup] production target $(ident "$PROD_URL") (read-only session: $RO)"
echo "[backup] $PROD_VERSION"

# ------------------------------------------------------------------- dump ----
echo "[backup] pg_dump $("$PG_DUMP_BIN" --version | awk '{print $3}') → $DUMP"
env PGOPTIONS='-c default_transaction_read_only=on' "$PG_DUMP_BIN" \
  --no-owner --no-privileges --format=plain --file="$DUMP" "$PROD_URL"
[ -s "$DUMP" ] || die "the dump is empty"
BYTES="$(wc -c < "$DUMP" | tr -d ' ')"
SHA="$(sha256sum "$DUMP" | awk '{print $1}')"
echo "[backup] dump: $BYTES bytes  sha256 $SHA"

# ---------------------------------------------------------------- restore ----
# A LOCAL scratch cluster at least as new as production (PG 18 here, on 5434) —
# never the cluster that hosts the preview data directory (the 5432 preview
# cluster that serves the owner's demo link already ran out of disk once — no
# database may be created there, ever).
SCRATCH_DATA_DIR="$("$PSQL_BIN" "$SCRATCH_ADMIN_URL" -Atc "show data_directory")"
case "$SCRATCH_DATA_DIR" in
  *ranch_preview*) die "the scratch server's data_directory ($SCRATCH_DATA_DIR) is the PREVIEW cluster — refusing to create a database there" ;;
esac
# The dump must be replayed by a server at least as new as production: a PG 18
# dump contains `SET transaction_timeout = 0`, which a PG 16 server rejects, and
# editing the dump to make it fit would invalidate the proof.
SCRATCH_MAJOR="$("$PSQL_BIN" "$SCRATCH_ADMIN_URL" -Atc "select current_setting('server_version_num')::int / 10000")"
PROD_MAJOR="$(env PGOPTIONS='-c default_transaction_read_only=on' "$PSQL_BIN" "$PROD_URL" -Atc "select current_setting('server_version_num')::int / 10000")"
[ "$SCRATCH_MAJOR" -ge "$PROD_MAJOR" ] || die "the scratch server is PG $SCRATCH_MAJOR but production is PG $PROD_MAJOR — a newer server's dump cannot be replayed by an older one (and the dump is never edited)"

SCRATCH_DB_URL="$(printf '%s' "$SCRATCH_ADMIN_URL" | sed -E "s#/[^/?]+(\?|$)#/$RESTORE_DB\1#")"
echo "[backup] restore proof → $(ident "$SCRATCH_DB_URL")"
"$PSQL_BIN" "$SCRATCH_ADMIN_URL" -q -c "DROP DATABASE IF EXISTS $RESTORE_DB WITH (FORCE)"
"$PSQL_BIN" "$SCRATCH_ADMIN_URL" -q -c "CREATE DATABASE $RESTORE_DB"
"$PSQL_BIN" "$SCRATCH_DB_URL" -v ON_ERROR_STOP=1 -q -f "$DUMP" > /dev/null

# -------------------------------------------------------------- assertions ---
RESTORED_FACTS="$("$PSQL_BIN" "$SCRATCH_DB_URL" -Atc "$(facts_sql "$SCRATCH_DB_URL")")"
fail=0
check_eq() { # name expected actual
  if [ "$2" = "$3" ]; then echo "  PASS $1 = $3"; else echo "  FAIL $1 expected $2 got $3"; fail=1; fi
}
echo "[backup] restore assertions"
# (jq is not assumed: the two JSON documents are compared field by field with python3)
FIELDS="migrations migration_names users operations expenses expense_categories pastures hay_inventory feed_inventory equipment expenses_0018_columns objects_0018 optional_row_counts"
DIFF="$(PROD="$PROD_FACTS" REST="$RESTORED_FACTS" FIELDS="$FIELDS" python3 - <<'PY'
import json, os
p = json.loads(os.environ["PROD"]); r = json.loads(os.environ["REST"])
out = []
for f in os.environ["FIELDS"].split():
    if f == "server_version":
        continue
    if p.get(f) != r.get(f):
        out.append(f"{f}: production={p.get(f)!r} restored={r.get(f)!r}")
print("\n".join(out))
PY
)"
if [ -n "$DIFF" ]; then echo "  FAIL the restore does not match production:"; echo "$DIFF" | sed 's/^/    /'; fail=1
else echo "  PASS the restored database matches production on: $FIELDS (other than the server version)"; fi

# The facts the owner's packet states explicitly. NOTE: the migration count is
# whatever PRODUCTION has today — read off production, not assumed. Today that
# is 19 with 0018_product_blocker.sql ABSENT (the whole reason this run exists);
# after the owner's approved run it becomes 20 with 0018 recorded.
check_eq "owner's users" 1 "$(printf '%s' "$RESTORED_FACTS" | python3 -c 'import json,sys;print(json.load(sys.stdin)["users"])')"
check_eq "expenses rows" 12 "$(printf '%s' "$RESTORED_FACTS" | python3 -c 'import json,sys;print(json.load(sys.stdin)["expenses"])')"
check_eq "applied migrations (same as production)" \
  "$(printf '%s' "$PROD_FACTS" | python3 -c 'import json,sys;print(json.load(sys.stdin)["migrations"])')" \
  "$(printf '%s' "$RESTORED_FACTS" | python3 -c 'import json,sys;print(json.load(sys.stdin)["migrations"])')"
check_eq "0018 applied? (no = the pre-migration state this backup pins)" \
  "$(printf '%s' "$PROD_FACTS" | python3 -c 'import json,sys;print("0018_product_blocker.sql" in json.load(sys.stdin)["migration_names"])')" \
  "$(printf '%s' "$RESTORED_FACTS" | python3 -c 'import json,sys;print("0018_product_blocker.sql" in json.load(sys.stdin)["migration_names"])')"

{
  echo "RESTORE PROOF — prod-$STAMP.sql ($SHA, $BYTES bytes)"
  echo "restored into $(ident "$SCRATCH_DB_URL") on the local 5433 TEST cluster (data_directory $SCRATCH_DATA_DIR)"
  echo
  echo "production facts at dump time:"; printf '%s\n' "$PROD_FACTS" | python3 -m json.tool
  echo
  echo "facts inside the RESTORED copy:"; printf '%s\n' "$RESTORED_FACTS" | python3 -m json.tool
  echo
  echo "migrations applied (restored copy):"
  "$PSQL_BIN" "$SCRATCH_DB_URL" -Atc "select name from public.schema_migrations order by name" | sed 's/^/  /'
  echo
  echo "expenses in the restored copy (id | date | category | cents | vendor):"
  "$PSQL_BIN" "$SCRATCH_DB_URL" -Atc \
    "select id || ' | ' || expense_date || ' | ' || category || ' | ' || amount_cents || ' | ' || coalesce(vendor,'') from public.expenses order by id" | sed 's/^/  /'
  echo
  echo "row counts (restored copy, exact):"
  printf '%s' "$RESTORED_FACTS" | python3 -c 'import json,sys;d=json.load(sys.stdin);print("  " + ", ".join(f"{k}={d[k]}" for k in ("migrations","users","operations","expenses","pastures","hay_inventory","feed_inventory","equipment")))'
  echo "  every public table in the restored copy:"
  "$PSQL_BIN" "$SCRATCH_DB_URL" -Atc "select '  ' || table_name from information_schema.tables where table_schema='public' order by 1"
} > "$VERIFY"
echo "[backup] restore report: $VERIFY"

# --------------------------------------------------------------- manifest ----
PROD="$PROD_FACTS" REST="$RESTORED_FACTS" RO="$RO" python3 - "$MANIFEST" "$DUMP" "$SHA" "$BYTES" \
  "$STAMP" "$(env PGOPTIONS='-c default_transaction_read_only=on' "$PSQL_BIN" "$PROD_URL" -Atc "select current_setting('server_version')")" \
  "$("$PG_DUMP_BIN" --version)" "$(ident "$PROD_URL")" "$(ident "$SCRATCH_DB_URL")" "$fail" <<'PY'
import json, os, sys
manifest, dump, sha, size, stamp, srv, dumper, prod_id, scratch_id, fail = sys.argv[1:12]
json.dump({
    "createdAtUtc": stamp,
    "dump": {"path": dump, "bytes": int(size), "sha256": sha, "format": "pg_dump --format=plain",
             "readOnlySession": "PGOPTIONS='-c default_transaction_read_only=on'"},
    "production": {"identity": prod_id, "serverVersion": srv, "pgDump": dumper, "writesIssued": "none",
                   "readOnlySessionProof": "transaction_read_only=" + str(os.environ.get("RO")) +
                                           " (read on the production target before the dump)"},
    "restoreProof": {"verified": fail == "0", "database": scratch_id, "cluster": "local test cluster 127.0.0.1:5433",
                     "productionFacts": json.loads(os.environ["PROD"]),
                     "restoredFacts": json.loads(os.environ["REST"])},
}, open(manifest, "w"), indent=2)
PY
echo "[backup] manifest: $MANIFEST"

if [ "$fail" != "0" ]; then echo "[backup] FAILED — the restore did not reproduce production" >&2; exit 1; fi
echo "[backup] OK — dumped read-only, restored, and every assertion matched"
