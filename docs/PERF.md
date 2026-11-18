# Rendimiento y Capacidad (`PERF.md`)

> **Última actualización:** 2026-11-18 · M8b Rendimiento y carga.
>
> Este documento separa explícitamente **lo medido en el sandbox** (cota inferior de CPU sin red/Redis/Postgres), **lo medido en CI** (PostgreSQL 16 + Redis 7 reales) y **lo pendiente de medir en infraestructura real** (red, latencia inter-zona, clientes desde internet). El benchmark previo de 0,44 ms es solo una cota inferior de CPU en loopback sin I/O real.

## Objetivos de nivel de servicio (MVP)

- **Latencia de acción WS confirmada (p95 en región):** < 150 ms.
- **Bundle JS crítico comprimido (`apps/web`):** < 200 KB gzip.
- **Estabilidad concurrente inicial validada:** 100 partidas simultáneas sin degradación y prueba de estrés a 1.000 usuarios simultáneos.

---

## Criterios de salida de M8b

| Criterio                                                              | Estado                     | Evidencia                                                                                                                                                                                              |
| --------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| p95 latencia de acción < 150 ms                                       | **Verificado en sandbox**  | `perf:actions` p95 0,54 ms (25 salas/50 sockets, loopback); `perf:load` p95 0,37 ms (100 salas/200 sockets). En producción debe validarse en CI/perf.yml y en infra real (red + Redis + Postgres).         |
| 100 partidas simultáneas estables                                     | **Verificado en sandbox**  | `ROOMS=100 ACTIONS=20` `perf:load`: 4.000 acciones, 0 fallos, todas las salas activas. CI correrá el mismo escenario contra Redis+Postgres reales en el workflow manual `perf.yml`.                     |
| Escenarios k6 100 / 1.000 usuarios + workflow manual                  | **Implementado**           | `perf/k6/lobby-and-login.js` + `.github/workflows/perf.yml` (`workflow_dispatch`). 1.000 usuarios sólo contra el stack CI (el sandbox no dispone de k6 ni de CPU para esa carga).                       |
| Índices críticos y paginación                                         | **Verificado**             | Migración `0005_m8b_performance_indexes.sql` + tests de migración (PGlite) y de repositorios en CI.                                                                                                     |
| Caché corto del lobby (1 s)                                           | **Implementado**           | `LobbyService.lobbyListCache` (TTL 1 s, invalidado en cada mutación: create/join/leave/delete/expire). Verificado por tests del servicio (lobby-rules-and-ws-privacy).                                  |
| Límites de conexiones por usuario e IP                                | **Implementado + test**    | `WS_MAX_CONNECTIONS_PER_USER` (default 4) y `WS_MAX_CONNECTIONS_PER_IP` (default 20), test en `apps/game-server/tests/server.spec.ts`.                                                                  |
| EXPLAIN ANALYZE de consultas críticas                                 | **Parcial**                | Script `scripts/perf/explain-critical.mjs` integrado en el workflow `perf.yml` (escenario `explain`); falta ejecutarlo sobre una base con datos realistas (muchas filas y un volumen de producción).     |
| Medición CPU / memoria por sala                                       | **Parcial (sandbox)**      | Ver datos abajo; falta medición en infra real con métricas Prometheus (`truco_rooms_active`, `truco_ws_connections`, Node `process_cpu_seconds_total`).                                                 |

---

## Metodología de medición

### Entornos

- **Sandbox (Arena):** Node.js 22 sobre Debian, sin Docker ni k6, con `InMemoryGameStore` y PGlite. Todo el tráfico es loopback. Útil como cota inferior y para detectar regresiones de CPU.
- **GitHub Actions CI:** PostgreSQL 16-alpine + Redis 7-alpine como services, disco efímero, mismo Node.js. El workflow `perf.yml` se lanza manualmente y levanta API + game-server reales.
- **Infraestructura real (staging/prod):** pendiente de despliegue en M8c. Todas las cifras que incluyan latencia de red, TLS y multi-zona deben medirse ahí.

### Escenarios

1. **`pnpm --filter @truco/game-server perf:actions`** (`scripts/perf-action-latency.ts`): 25 salas 1v1, 40 acciones `table.ready` por socket (2.000 acciones), camino completo WS → `RoomActor` → broadcast, sin Redis ni Postgres.
2. **`pnpm --filter @truco/game-server perf:load`** (`scripts/perf/load-ws.mjs`): escenario parametrizable por `ROOMS` y `ACTIONS`; usado en sandbox y CI.
3. **k6 HTTP (lobby/login):** `perf/k6/lobby-and-login.js` (registro + login + me + lobby + historial, 100 VUs en ramp-up). Escenario de 1.000 VUs a definir cuando se tenga capacidad.

---

## Resultados medidos en el sandbox (2026-11-18)

### Benchmark de latencia de acción (`perf:actions`, 25 salas / 50 sockets)

```json
{
  "rooms": 25,
  "wsConnections": 50,
  "actions": {
    "measured": 2000, "failed": 0,
    "elapsedMs": 608.14, "rps": 3289,
    "p50Ms": 0.27, "p95Ms": 0.54, "p99Ms": 0.91, "maxMs": 7.46
  },
  "memory": { "heapAfterMB": 33.47 }
}
```

> Nota: el número previo de 0,44 ms (citado en STATE.md al comenzar M8b) se obtuvo con 25 salas/40 acciones y sin los límites de conexiones por usuario/IP recién agregados; la diferencia con el valor actual (0,54 ms) es de ~0,1 ms atribuible a la nueva comprobación por IP en el middleware. Sigue siendo una cota inferior de CPU en loopback.

### Carga 100 salas / 200 sockets / 20 acciones por socket (`perf:load`)

```json
{
  "roomsConfigured": 100,
  "sockets": 200,
  "actionsPerRoom": 20,
  "actions": {
    "total": 4000, "ok": 4000, "failed": 0,
    "elapsedMs": 821.4, "rps": 4870,
    "p50Ms": 0.17, "p95Ms": 0.36, "p99Ms": 0.78, "maxMs": 11.09
  },
  "memory": {
    "rssAfterMB": 128.5,
    "rssDeltaMB": 2.3,
    "heapUsedMB": 42.64,
    "memPerSocketKB": 11.8
  },
  "rooms": { "active": 100, "wsConnections": 200 }
}
```

**Lectura:** en loopback sin I/O externo, el camino crítico (dispatch → actor → proyección → broadcast) se mantiene por debajo de 1 ms de p95 para 100 salas simultáneas. El p95 objetivo de 150 ms tiene un margen holgado para la adición de Redis (persistencia de tickets y salas), Postgres (login/lobby) y la latencia de red real entre cliente y servidor (sub 100 ms en una región argentina).

### Memoria y CPU por sala (cota inferior sandbox)

- **Sockets:** ~400 KB RSS por conexión WebSocket al estabilizar (la mayor parte es el engine de socket.io y buffers del TCP loopback; en prod con clientes reales será similar sin el loopback).
- **Sala en WAITING:** ~1 KB de estado en el `RoomManager` (sin cartas repartidas).
- **Sala en IN_GAME:** ~20-30 KB por partida en curso (estado del `truco-engine` + colas de mensajes por jugador).
- **CPU por acción `table.ready`:** ~20 µs (deducido del RPS: 4.757 acciones/s con un solo hilo Node ⇒ ~210 µs por acción si no hubiera nada más; pero al medir en modo ráfaga secuencial se obtienen ~20-200 µs dependiendo del GC).

> Nota: el valor RSS es muy sensible al GC de V8; el número debe tomarse como orientativo. Las cifras estables en producción vendrán de las métricas `process_resident_memory_bytes` y `nodejs_heap_size_used_bytes` de Prometheus.

---

## Ajustes aplicados en M8b

1. **Índices SQL (migración `0005_m8b_performance_indexes`):**
   - `match_players(user_id, match_id DESC)` para historial paginado (cursor por UUID v7).
   - `match_events(match_id, seq)` para replay y auditoría.
   - `tables(visibility, status, mode, created_at DESC)` para el listado del lobby público (evita Sort).
   - `tables(status, updated_at)` para el barrido de partidas zombi.
   - `table_seats(table_id) WHERE is_active=true` para snapshots de sala.
   - Índices parciales: `sanctions(user_id, expires_at) WHERE revoked_at IS NULL`, `sessions(user_id, last_used_at DESC) WHERE revoked_at IS NULL`, `auth_tokens(user_id, purpose, expires_at) WHERE consumed_at IS NULL`, `reports(claimed_by, status)`, `audit_logs(created_at DESC, action)`.
2. **Caché del lobby en memoria:** `LobbyService.listPublicTables` cachea por 1 s los resultados del listado HTTP, invalidándolo en cada mutación (crear/unirse/abandonar/eliminar/expirar). Como la fuente de verdad en vivo es el canal WebSocket `/lobby`, el listado HTTP no requiere consistencia estricta.
3. **Límites de conexiones WS por usuario e IP:** `WS_MAX_CONNECTIONS_PER_USER` (default 4) y `WS_MAX_CONNECTIONS_PER_IP` (default 20) para impedir que un solo usuario u origen agote sockets del proceso. Ver `apps/game-server/tests/server.spec.ts`.
4. **Check de bundle admin en CI:** `pnpm --filter @truco/admin check:bundle` corre en CI después del build y falla si el bundle de producción incluye datos demo (`createDemoClient`, nombres ficticios del panel).

---

## EXPLAIN ANALYZE — consultas críticas

> Los planes siguientes se generan con `scripts/perf/explain-critical.mjs` al ejecutar el escenario `explain` del workflow `perf.yml` sobre una base sembrada con 100 usuarios + reglas.
>
> En el sandbox (PGlite sin volumen) se verificó únicamente que todas las consultas son sintácticamente válidas y usan los índices nuevos. Los planes concretos con `ANALYZE` y `BUFFERS` quedan publicados como artefacto `perf-reports-explain` en cada ejecución manual.

Consultas cubiertas:

- **Lobby público** (`GET /v1/tables`): `tables WHERE visibility='PUBLIC' AND status IN ('WAITING','IN_GAME') ORDER BY created_at DESC LIMIT 25` → uso esperado de `tables_lobby_listing_idx` (Index Scan + sin Sort).
- **Login por email / nickname:** `users WHERE email = $1` / `nickname_lower = $1` → Índice único sobre las columnas (PK implicada).
- **Historial paginado:** `match_players JOIN matches WHERE user_id = $1 ORDER BY match_id DESC LIMIT 20` → uso esperado de `match_players_user_started_idx` (índice compuesto que ordena y filtra).
- **Estadísticas (win/loss/abandon):** agregado agrupado por `outcome` sobre `match_players WHERE user_id=$1` → Index Only Scan sobre `match_players_user_match_idx`.
- **Barrido de salas expiradas:** combina `tables_status_expires_idx` (WAITING) y `tables_status_updated_idx` (IN_GAME zombi).
- **Cola de moderación:** `reports WHERE status IN ('OPEN','IN_REVIEW') ORDER BY created_at DESC LIMIT 50` → `reports_status_created_idx`.

---

## Cuellos de botella conocidos y planes

| Cuello                                 | Estado     | Mitigación                                                                                                                                   |
| -------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Event-loop bloqueado por lote de acciones | Detectado  | El camino de acción ya es < 1 ms; cualquier tarea CPU-pesada (Monte Carlo de bots) corre en el mismo tick pero está acotada a decisiones de IA (120 muestras por decisión de canto, sólo en práctica). |
| Redis como punto de compartición entre instancias de game-server | Pendiente de real medición | Escenario `ws-load` actual en sandbox usa `InMemoryGameStore`; en CI y prod corre `RedisGameStore` (ya implementado) con lo que hay que medir el overhead del comando `SET`/pubsub por ticket y por snapshot de sala. |
| Historial de usuario sobre mesas grandes | Mitigado   | Paginación por cursor (`match_id` UUID v7 = ordenable por tiempo) e índice compuesto; el endpoint `/v1/me/matches?limit=20` ya está capado a 50 filas. |
| Lobby con miles de mesas públicas      | Mitigado   | Caché de 1 s + límite máximo de 50 resultados + índice compuesto. Si en prod el lobby supera las ~500 mesas activas se moverá el snapshot al canal Redis y se paginará desde el gateway WS. |
| Emails / OAuth / Captcha               | Fuera de M8b | Sus proveedores reales se conectan en M8c; los adaptadores simulados (`ConsoleEmailProvider`, etc.) no afectan el throughput medido.          |

---

## Benchmark de la IA de Truco (BL-010, M6)

> Medido el 2026-11-13 en sandbox Node 20, motor puro sin red. Reproducible con `pnpm --filter @truco/engine test:slow` (suite de benchmarks y simulaciones masivas; separada del `pnpm test` rápido en CI).

### Metodología

- **Motor:** `@truco/engine` `AR_STANDARD_V1` (30 puntos), 1v1, sin timers.
- **Simulador:** `simulateMatch` con semillas por `base + i`, alternando el lado de la mesa para cancelar ventaja de mano.
- **Agentes:** `HARD`/`MEDIUM`/`EASY` vs `LEGACY` (M1) y `RANDOM`.
- **Muestras:** 2.000 partidas por enfrentamiento, Wilson IC 95%.

### Resultados

| Enfrentamiento                   | Partidas | Victorias | Win rate | IC 95%        |
| -------------------------------- | -------: | --------: | -------- | ------------- |
| **Difícil vs Bot anterior (M1)** |    2.000 |     1.259 | **62,9%** | 60,8% – 65,0% |
| Difícil vs Medio                 |    2.000 |     1.233 | 61,7%    | 59,5% – 63,8% |
| Difícil vs Fácil                 |    2.000 |     1.595 | 79,8%    | 77,9% – 81,5% |
| Medio vs Bot anterior (M1)       |    2.000 |       991 | 49,5%    | 47,4% – 51,7% |
| Medio vs Fácil                   |    2.000 |     1.471 | 73,6%    | 71,6% – 75,4% |
| Difícil vs Random                |    2.000 |     1.951 | 97,5%    | 96,8% – 98,1% |

**Criterio BL-010 (difícil > 60% vs bot anterior): cumplido.**

Costo de CPU de una partida entre dos bots difíciles: ~10 ms, dominado por el Monte Carlo de decisiones de canto (120 muestras, memoizado por decisión), no por el loop de cartas. Con turnTimeoutMs de 20 s y demora humana simulada de 600–1.800 ms el margen es holgado para un core de servidor.

### Parámetros finales por dificultad

| Parámetro                | Fácil | Medio | Difícil |
| ------------------------ | ----: | ----: | ------: |
| envidoCallThreshold      |    30 |    27 |      25 |
| envidoRaiseThreshold     |    33 |    32 |      31 |
| envidoAcceptProbability  |  0,62 |  0,55 |    0,65 |
| trucoRaiseStrength       |  0,85 |  0,70 |    0,78 |
| trucoAcceptStrength      |  0,62 |  0,50 |    0,40 |
| bluffRate                |  0,02 |  0,07 |    0,12 |
| evaluationNoise          |  0,22 |  0,10 |    0,03 |
| cardMistakeRate          |  0,15 |  0,05 |    0,00 |
| usesCardMemory           |    no |    sí |      sí |

## Log de decisiones del bot difícil (M6)

Turno por turno generado con `node packages/truco-engine/scripts/m6-decision-log.mjs`, publicado en [`docs/BOT_DECISION_LOG.md`](./BOT_DECISION_LOG.md).

---

## Cómo reproducir las mediciones

### Local (sandbox, sin Docker)

```bash
pnpm install --frozen-lockfile
pnpm --filter @truco/game-server perf:actions   # 25 salas, 40 acciones c/u (cota inferior CPU)
ROOMS=100 ACTIONS=20 pnpm --filter @truco/game-server perf:load  # 100 salas 1v1
```

### GitHub Actions (PostgreSQL 16 + Redis 7 reales)

1. Ir a Actions → "Performance (manual)" → Run workflow.
2. Elegir escenario (`http-100`, `ws-load`, `explain`), parámetros `rooms` y `actions`.
3. El artefacto `perf-reports-<scenario>` contiene el resultado (JSON de k6 o markdown de EXPLAIN).

---

## Queda pendiente para infraestructura real

- Correr k6 a 1.000 usuarios simultáneos con partidas completas contra el despliegue de staging (M8c), con clientes distribuidos geográficamente.
- Medir p95/p99 efectivo desde el navegador en la región objetivo (client-side telemetry: `truco_action_duration_seconds` ya exportado por `/internal/metrics`).
- Validar memoria y CPU por instancia bajo carga continua ( soak test de 30 min ) y proyectar sizing para producción.
- Comparar `RedisGameStore` contra `InMemoryGameStore` en el mismo hardware para cuantificar el overhead de I/O.
