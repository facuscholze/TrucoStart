# Runbooks operativos (`RUNBOOKS.md`)

Guía operativa del MVP: desarrollo local, observabilidad, SLO/alertas, respaldos y
restauración, rotación de claves, incidentes y drenaje del game-server.

> **Alcance real:** todo lo que requiere Docker, despliegue o carga de usuarios **no se
> ejecutó en el sandbox de desarrollo de M8** (no tiene Docker ni permite cargas grandes).
> Los procedimientos que dependen de eso están marcados **«pendiente de verificar en infra»**
> y automatizados en GitHub Actions cuando es posible.

---

## 1. Desarrollo local rápido

1. Copiar configuración base:
   ```bash
   cp .env.example .env
   ```
2. Levantar PostgreSQL 16 + Redis 7:
   ```bash
   docker compose up -d
   ```
3. Instalar y levantar aplicaciones:
   ```bash
   pnpm install
   pnpm dev
   ```
4. Verificar salud:
   ```bash
   curl -fsS http://localhost:3001/v1/health
   curl -fsS http://localhost:3001/v1/ready
   ```

---

## 2. Observabilidad

### 2.1 Logs estructurados

- Ambos servicios emiten **JSON** por stdout (pino) con `service`, `env` y, cuando existe,
  `correlationId`.
- `apps/api` acepta y propaga `x-correlation-id` (si el cliente no manda uno válido, genera
  24 hex). El `game-server` hace lo mismo en su HTTP interno y en el handshake WebSocket, y
  la API reenvía el id en las llamadas internas firmadas.
- **Nunca** se registran emails, cookies, tokens, contraseñas, manos ni ids de cartas:
  `LOG_REDACT_PATHS` (pino) + `redactLogPayload()` en el código comparten la misma lista
  (`packages/shared/src/observability/logging.ts`, test `observability.spec.ts`).
- El log de request usa el **patrón de ruta** (`/users/:id`), nunca la URL con ids o query
  string, para no filtrar datos personales ni inflar series.

```bash
# Seguir una request puntual de punta a punta
curl -H 'x-correlation-id: debug-0001' http://localhost:3001/v1/health
# En los logs de api y game-server buscar "debug-0001"
```

### 2.2 Métricas Prometheus

`GET /v1/metrics` (API) expone:

| Métrica                                                        | Tipo          | Qué mide                                |
| -------------------------------------------------------------- | ------------- | --------------------------------------- |
| `truco_http_requests_total{method,route,status}`               | counter       | Requests por ruta declarada y estado    |
| `truco_http_request_duration_seconds`                          | histogram     | Latencia HTTP                           |
| `truco_http_errors_total{error_code}`                          | counter       | Errores por código                      |
| `truco_active_matches`                                         | gauge         | Partidas sin terminar                   |
| `truco_open_reports`                                           | gauge         | Reportes `OPEN`/`IN_REVIEW`             |
| `truco_admin_sessions_active`                                  | gauge         | Sesiones del panel vigentes             |
| `truco_jobs_pending{queue}` / `truco_jobs_failed_total{queue}` | gauge/counter | Cola BullMQ `match-lifecycle`           |
| `truco_ws_connections`                                         | gauge         | Conexiones WS (desde el game-server)    |
| `truco_rooms_by_status{status}`                                | gauge         | Salas por estado (desde el game-server) |
| `truco_ws_reconnections_total`                                 | counter       | Reconexiones aceptadas                  |
| `truco_ws_errors_total`                                        | counter       | Errores de WebSocket                    |
| `truco_action_duration_seconds{action}`                        | histogram     | Latencia de acciones de juego           |

- **Protección:** `Authorization: Bearer $METRICS_TOKEN`. Sin token configurado responde
  **503** (falla cerrado); con token inválido, **401**. La comparación es en tiempo constante.
- El game-server expone las mismas series en `GET /internal/metrics` (Bearer
  `INTERNAL_RPC_SECRET`); la API las consume y las re-publica para tener una sola URL.

```bash
export METRICS_TOKEN=$(openssl rand -hex 32)
curl -fsS -H "Authorization: Bearer $METRICS_TOKEN" http://localhost:3001/v1/metrics | head
```

Scrape y alertas listos para usar:

```bash
infra/prometheus/prometheus.yml     # job truco-api con credentials_file
infra/prometheus/alerts.yml         # SLOs (5xx, latencia, jobs, salas)
infra/grafana/dashboards/truco-mvp.json
infra/grafana/provisioning/…        # datasource + provider automáticos
```

El dashboard se importa con el datasource `Prometheus` (variable `DS_PROMETHEUS`).

### 2.3 SLO y alertas

| SLO                    | Objetivo          | Alerta                      |
| ---------------------- | ----------------- | --------------------------- |
| Disponibilidad API     | 99,5 % mensual    | `TrucoApiSinMetricas` (2 m) |
| Errores 5xx            | < 2 % en 10 m     | `TrucoErrores5xxAltos`      |
| p95 latencia de acción | < 150 ms          | `TrucoLatenciaAccionAlta`   |
| Jobs fallidos          | 0 en 10 m         | `TrucoJobsFallidos`         |
| Salas vivas            | < 500 por proceso | `TrucoSalasSinDrenar`       |

### 2.4 Trazas y errores (OTel / Sentry)

El código ya lee `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`,
`OTEL_TRACES_SAMPLER_ARG`, `SENTRY_DSN` y `SENTRY_TRACES_SAMPLE_RATE`
(`packages/shared/src/observability/tracing.ts`). **Los paquetes no están instalados** en el
repo (decisión: no cargar el MVP con SDKs opcionales). Para activarlos:

```bash
pnpm --filter @truco/api add @opentelemetry/sdk-node @sentry/node
pnpm --filter @truco/game-server add @opentelemetry/sdk-node @sentry/node

export OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp.tu-proveedor
export OTEL_SERVICE_NAME=truco-api
export SENTRY_DSN=https://<clave>@o0.ingest.sentry.io/0
pnpm dev
```

Sin los paquetes, `initializeTracing()` registra un aviso (`observabilidad_aviso`) y sigue
funcionando: la observabilidad **nunca** tumba el arranque.

---

## 3. Respaldos y restauración de PostgreSQL

Scripts: `infra/backups/backup-postgres.sh` y `infra/backups/restore-postgres.sh`.

> **Versión del cliente:** usá `pg_dump`/`pg_restore` de la **misma versión mayor que el
> servidor**. Con un cliente más nuevo (p. ej. 18 contra un servidor 16) el dump incluye
> `SET transaction_timeout` (parámetro de PG 17+) y la restauración falla. En el drill de CI
> los scripts se ejecutan dentro de la imagen `postgres:16-alpine` para garantizar la paridad.
Prueba de restauración automatizada: job `backup-restore` de `.github/workflows/ci.yml`
(migra, siembra, respalda, restaura en una base vacía y **compara conteos** de
`users`, `matches`, `match_events`, `audit_logs`).

### 3.1 Respaldo

```bash
DATABASE_URL=postgresql://truco:clave@db:5432/truco \
BACKUP_DIR=/var/backups/truco \
BACKUP_RETENTION_DAYS=14 \
./infra/backups/backup-postgres.sh
```

- `pg_dump --format=custom` + verificación con `pg_restore --list` (falla si el dump queda vacío).
- Genera `truco-<timestamp>.dump` y `.sha256`; borra archivos más viejos que la retención.
- Programar por cron en la máquina del usuario o en el proveedor:
  ```cron
  15 3 * * * cd /srv/truco && DATABASE_URL="$DATABASE_URL" BACKUP_DIR=/var/backups/truco ./infra/backups/backup-postgres.sh >> /var/log/truco-backup.log 2>&1
  ```

### 3.2 Restauración (ensayo o recuperación real)

```bash
psql "$ADMIN_URL" -c "CREATE DATABASE truco_restore"
TARGET_DATABASE_URL=postgresql://truco:clave@db:5432/truco_restore \
./infra/backups/restore-postgres.sh /var/backups/truco/truco-20260101T030000Z.dump
```

- Verifica el `.sha256` antes de restaurar.
- **Base vacía (ensayo/recuperación limpia):** `RESTORE_ATOMIC=1` restaura en una sola
  transacción y sin `--clean`. Ojo: `pg_restore` no acepta `--clean` + `--single-transaction`
  sobre una base vacía (intenta borrar objetos que no existen), por eso están separados.
- **Base con datos (sobrescribir):** modo por defecto, `--clean --if-exists`: limpia los
  objetos del dump y los recrea; si algo falla queda a medias, así que restaurá siempre
  contra una base descartable.
- El script imprime el conteo de tablas críticas para comparar contra el origen.
- **Recuperación real:** frenar API y game-server → renombrar la base dañada → restaurar en
  la base nueva → actualizar `DATABASE_URL` → arrancar y verificar `/v1/ready`.

> **Estado:** scripts y job de CI escritos, pero **no ejecutados en este sandbox** (no hay
> PostgreSQL ni Docker). El job `backup-restore` es la verificación real: mirar su resultado
> en Actions antes de confiar en el procedimiento.

---

## 4. Rotación de claves

| Clave                       | Efecto de rotarla                                                      | Procedimiento                                                                                                                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_SECRET`            | Invalida sesiones de jugadores y tickets WS                            | Cambiar, reiniciar API y game-server en la misma ventana (≤ 1 min). Los jugadores vuelven a entrar.                                                                                                                 |
| `INTERNAL_RPC_SECRET`       | Rompe las llamadas internas firmadas si los dos servicios no coinciden | Cambiar en API **y** game-server y reiniciar juntos; verificar `/v1/ready` y una sanción de prueba.                                                                                                                 |
| `ADMIN_TOTP_ENCRYPTION_KEY` | **Deja ilegible el secreto TOTP** guardado                             | No rotar sin re-alta: `pnpm --filter @truco/api admin:create -- --email … --role ADMIN` con la clave nueva y borrar el `admin_two_factor` viejo. La API responde `ADMIN_2FA_MISCONFIGURED` si la clave no coincide. |
| `SEED_ENCRYPTION_KEY`       | Impide descifrar semillas comprometidas de partidas viejas             | Rotar sólo con partidas terminadas; documentar la fecha de corte.                                                                                                                                                   |
| `METRICS_TOKEN`             | Corta el scrape                                                        | Actualizar token en Prometheus (`credentials_file`) y reiniciar la API.                                                                                                                                             |

---

## 5. Incidentes

### API caída

1. `curl -fsS https://api.tu-dominio/v1/health` y `/v1/ready` (ready valida base y Redis).
2. Ver logs por `errorCode` y `correlationId`; revisar `truco_http_errors_total`.
3. Si es base: ver estado del Postgres gestionado y reconexiones; último recurso, restaurar
   (sección 3.2).

### Errores 5xx

1. Dashboard «Truco Start — MVP» → panel de 5xx por `error_code`.
2. Filtrar logs por ese `correlationId` para reconstruir la request (sin datos personales).
3. Si viene de un deploy reciente: revertir la imagen (`docs/DEPLOY.md#rollback`).

### Latencia de acción

1. Comparar `truco_action_duration_seconds` por acción; revisar `truco_ws_connections` y
   `truco_rooms_by_status`.
2. Si el proceso está saturado: escalar horizontalmente el game-server (las salas tienen
   _owner lease_ en Redis) y drenar el nodo viejo (§6).

### Jobs fallidos

1. Revisar la DLQ (`match-lifecycle-dlq`) y los logs del consumer.
2. Corregir la causa y re-encolar; los jobs son idempotentes por `idempotencyKey`.

### Salas colgadas

1. `truco_rooms_by_status` sostenido y sin conexiones: revisar `IDLE_ROOM_TTL_MS` /
   `IDLE_ROOM_SWEEP_MS`.
2. El barrido destruye salas sin conexiones tras el TTL y emite `room.expired` a la API.

---

## 6. Drenaje del game-server sin cortar partidas

1. `SIGTERM` al proceso: `main.ts` marca `setDraining(true)`, deja de aceptar salas nuevas y
   cierra el servidor (`server.close()`), mientras las salas terminan o expiran.
2. El balanceador debe dejar de mandar tráfico nuevo al nodo (health check en `/health`
   devuelve 200 sólo mientras no esté drenando, ver `docs/DEPLOY.md`).
3. Verificar `truco_rooms_by_status` del nodo hasta 0 y recién entonces retirarlo.
4. Las reconexiones de jugadores van a otro nodo: la sala se recupera desde Redis
   (`getOrRecoverRoom`).

> **Pendiente de verificar en infra:** el drenaje ordenado está implementado y testeado a
> nivel de proceso, pero el comportamiento detrás de un balanceador real no se probó acá.

---

## 7. Panel administrativo

- Se sirve desde **origen distinto** al de jugadores (`admin.tu-dominio`), con `no-store`,
  `noindex` y CSP propia (`infra/docker/nginx-admin.conf`).
- Restricción por red: `ADMIN_ALLOWED_NETWORKS=10.0.0.0/8,203.0.113.7` (acepta IPv4/IPv6 y
  CIDR; vacío = sin restricción). Se evalúa **en el servidor en cada request**, antes de leer
  la cookie; una sesión robada no sirve desde otra red.
- Alta de administradores sólo por CLI y con 2FA obligatorio:
  ```bash
  pnpm --filter @truco/api admin:create -- --email admin@truco.ar --nickname Admin --password '…' --role ADMIN
  ```
- Si un admin pierde el teléfono: usar un código de recuperación (un solo uso). Si perdió
  ambos, re-alta por CLI y baja del registro viejo (`admin_two_factor`).
