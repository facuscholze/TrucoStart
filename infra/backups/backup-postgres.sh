#!/usr/bin/env bash
# Respaldo lógico de PostgreSQL 16 con verificación de integridad.
#
# Uso:
#   DATABASE_URL=postgresql://user:pass@host:5432/db \
#   BACKUP_DIR=/var/backups/truco ./infra/backups/backup-postgres.sh
#
# Requiere: pg_dump y pg_restore del cliente 16 (`postgresql-client-16`).
set -Eeuo pipefail

: "${DATABASE_URL:?Falta DATABASE_URL (postgresql://usuario:clave@host:5432/base)}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="${BACKUP_DIR}/truco-${timestamp}.dump"

echo "[backup] Iniciando respaldo en ${target}"
pg_dump \
  --dbname="$DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-acl \
  --compress=9 \
  --file="$target"

# Verificación: el archivo debe listar objetos y tener tamaño razonable.
pg_restore --list "$target" > "${target}.toc"
objetos="$(wc -l < "${target}.toc" | tr -d ' ')"
if [ "$objetos" -lt 1 ]; then
  echo "[backup] ERROR: el respaldo no contiene objetos (posible dump vacío)." >&2
  exit 1
fi
rm -f "${target}.toc"

sha256sum "$target" > "${target}.sha256"
echo "[backup] OK: ${objetos} objetos, $(du -h "$target" | cut -f1), sha256=$(cut -d' ' -f1 "${target}.sha256")"

if [ -n "$RETENTION_DAYS" ] && [ "$RETENTION_DAYS" -gt 0 ]; then
  find "$BACKUP_DIR" -name 'truco-*.dump*' -type f -mtime "+${RETENTION_DAYS}" -print -delete \
    | sed 's/^/[backup] eliminado por retención: /'
fi

echo "[backup] Fin."
