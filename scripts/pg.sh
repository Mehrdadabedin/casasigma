#!/usr/bin/env bash
# Project-local Postgres cluster for the media store.
#
# The cluster lives in .pgdata (gitignored) on port 5434 so it never collides
# with a system Postgres, and needs no administrator rights.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGDATA="$ROOT/.pgdata"
PGPORT="${PGPORT:-5434}"
PGUSER="${PGUSER:-casasigma}"
PGDATABASE="${PGDATABASE:-casasigma}"
PGTESTDATABASE="${PGTESTDATABASE:-casasigma_test}"
PGHOST=127.0.0.1

PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)}"
if [ -z "$PGBIN" ] || [ ! -x "$PGBIN/pg_ctl" ]; then
  echo "Postgres server binaries not found. Install postgresql, or set PGBIN." >&2
  exit 1
fi

psql_db() {
  "$PGBIN/psql" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$@" -v ON_ERROR_STOP=1
}

is_running() {
  "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1
}

init_cluster() {
  if [ -f "$PGDATA/PG_VERSION" ]; then
    return
  fi
  echo "Initialising cluster in $PGDATA"
  "$PGBIN/initdb" -D "$PGDATA" -U "$PGUSER" -A trust --encoding=UTF8 >/dev/null
}

start() {
  init_cluster
  if is_running; then
    echo "Postgres already running on $PGHOST:$PGPORT"
  else
    "$PGBIN/pg_ctl" -D "$PGDATA" -l "$PGDATA/server.log" -w \
      -o "-p $PGPORT -k $PGDATA -c listen_addresses=$PGHOST" start >/dev/null
    echo "Postgres started on $PGHOST:$PGPORT"
  fi

  if [ -z "$(psql_db -d postgres -tAc "select 1 from pg_database where datname = '$PGDATABASE'")" ]; then
    "$PGBIN/createdb" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$PGDATABASE"
    echo "Created database $PGDATABASE"
  fi

  psql_db -d "$PGDATABASE" -q -f "$ROOT/db/schema.sql"
  echo "Schema applied to $PGDATABASE"

  # `npm test` runs against this separate database, never the dev one. The API
  # applies the schema itself when the tests boot it.
  if [ -z "$(psql_db -d postgres -tAc "select 1 from pg_database where datname = '$PGTESTDATABASE'")" ]; then
    "$PGBIN/createdb" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$PGTESTDATABASE"
    echo "Created test database $PGTESTDATABASE"
  fi
}

stop() {
  if is_running; then
    "$PGBIN/pg_ctl" -D "$PGDATA" -m fast -w stop >/dev/null
    echo "Postgres stopped"
  else
    echo "Postgres is not running"
  fi
}

status() {
  if is_running; then
    echo "Postgres running on $PGHOST:$PGPORT (data: $PGDATA)"
  else
    echo "Postgres stopped"
  fi
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status) status ;;
  psql) shift; psql_db -d "$PGDATABASE" "$@" ;;
  *) echo "usage: $0 {start|stop|restart|status|psql}" >&2; exit 2 ;;
esac
