#!/usr/bin/env bash
# Restauración verificada de un respaldo lógico.
#
# Uso:
#   TARGET_DATABASE_URL=postgresql://user:pass@host:5432/db_restore \
#   ./infra/backups/restore-postgres.sh ./backups/truco-20260101T000000Z.dump
#
# El script NO toca el dump: sólo restaura. Pensado para ensayos de restauración
# (CI o staging) y para recuperación real, siempre contra una base vacía o descartable.
set -Eeuo pipefail

dump="${1:-}"
if [ -z "$dump" ] || [ ! -f "$dump" ]; then
  echo "Uso: TARGET_DATABASE_URL=... $0 <archivo.dump>" >&2
  exit 1
fi
: "${TARGET_DATABASE_URL:?Falta TARGET_DATABASE_URL}"

if [ -f "${dump}.sha256" ]; then
  echo "[restore] Verificando checksum"
  (cd "$(dirname "$dump")" && sha256sum --check "$(basename "$dump").sha256")
fi

echo "[restore] Restaurando ${dump}"
pg_restore \
  --dbname="$TARGET_DATABASE_URL" \
  --clean --if-exists \
  --no-owner --no-acl \
  --exit-on-error \
  --single-transaction \
  "$dump"

echo "[restore] Verificando tablas críticas"
psql "$TARGET_DATABASE_URL" --no-psqlrc -v ON_ERROR_STOP=1 <<'SQL'
SELECT 'users' AS tabla, count(*) FROM users
UNION ALL SELECT 'matches', count(*) FROM matches
UNION ALL SELECT 'match_events', count(*) FROM match_events
UNION ALL SELECT 'audit_logs', count(*) FROM audit_logs
ORDER BY tabla;
SQL

echo "[restore] OK."
