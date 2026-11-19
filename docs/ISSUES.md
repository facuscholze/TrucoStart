# Problemas, Riesgos y Deuda Técnica (`ISSUES.md`)

---

## Restricciones de entorno y riesgos operativos actuales

### ISSUE-001: Ausencia de demonio Docker dentro del contenedor sandbox de desarrollo

- **Severidad:** Media (solo en el sandbox efímero actual; no afecta máquinas locales ni GitHub Actions CI).
- **Estado:** Mitigado y documentado.
- **Detalle:** El entorno de ejecución actual es un contenedor Linux sin binario ni demonio `docker` instalado y con salida de red restringida a registros de código/paquetes (`npmjs.org`, `github.com`, `pypi.org`). Por ello, `docker compose up` no puede iniciar contenedores dentro de este sandbox específico.
- **Mitigación:**
  1. Se provee `docker-compose.yml` completo en la raíz (referenciando `infra/docker-compose.yml`) con PostgreSQL 16 y Redis 7, healthchecks, volúmenes persistentes y variables alineadas con `.env.example`.
  2. Una suite automatizada en Vitest valida sintaxis YAML, servicios, puertos, healthchecks, volúmenes y paridad con `.env.example` y `.github/workflows/ci.yml`.
  3. En CI (GitHub Actions) se definen `services` reales de PostgreSQL 16 y Redis 7 para las pruebas de integración.
  4. En **M2 (`apps/game-server`)** se implementó la interfaz limpia `GameStore` (`apps/game-server/src/store/game-store.interface.ts`) con dos adaptadores de producción/testing: `InMemoryGameStore` (clonado profundo para tests locales sin Docker) y `RedisGameStore` (transacciones atómicas `MULTI/EXEC` y scripts Lua sobre `ioredis`). La suite compartida de contrato `apps/game-server/tests/game-store.contract.spec.ts` corre siempre contra `InMemoryGameStore` y se ejecuta automáticamente contra `RedisGameStore` real cada vez que `REDIS_URL` está definido en el entorno (como en `.github/workflows/ci.yml`).
  5. En **M3 (`apps/api`)** se implementó un conector adaptativo (`createAdaptiveTestDatabase` en `apps/api/src/db/database.provider.ts`) que ejecuta **exactamente las mismas migraciones SQL de Drizzle (`apps/api/drizzle/*.sql`)**:
     - En desarrollo local / sandbox sin Docker: sobre **PGlite (`@electric-sql/pglite`)**, motor PostgreSQL real compilado a WASM en memoria (con soporte completo de `uuid`, `jsonb`, `timestamptz`, claves foráneas `ON DELETE CASCADE` e índices únicos).
     - En CI / entornos con `DATABASE_URL` definido: sobre **PostgreSQL 16 real (`pg.Pool`)**, aislando cada suite en un esquema dedicado (`CREATE SCHEMA test_<id>` + `search_path`) para ejecución paralela determinista y verificando que `CI=true` jamás omita `DATABASE_URL`.

### ISSUE-002: Cumplimiento normativo Ley 25.326 (Protección de Datos Personales — Argentina)

- **Severidad:** Media (bloqueante antes de producción pública, no bloqueante en desarrollo MVP).
- **Estado:** Abierto (`STATE-09`).
- **Detalle:** La recopilación mínima de datos (email, IP en `audit_logs`, historial de sanciones y exportación/supresión de cuenta) requiere validación jurídica formal de textos legales, plazos de retención e inscripción/cumplimiento ante la AAIP.

### ISSUE-003: Presupuesto de bundle crítico (< 200 KB comprimido en `apps/web`)

- **Severidad:** Baja (riesgo preventivo para M5).
- **Estado:** En seguimiento.
- **Detalle:** Framer Motion, Socket.IO client y librerías de UI pueden superar los 200 KB gzip si no se aplica code-splitting por ruta (`LazyMotion`, carga diferida de pantallas secundarias como tutorial/replay). Se verificará en el build de M5 y M8.

### ISSUE-004: El control de edad mínima es declarativo, no verificable

- **Severidad:** Media (bloqueante si el abogado exige verificación real; no bloqueante si acepta declaración).
- **Estado:** Abierto — abierto durante M8d, con las decisiones de `docs/LEGAL_CHECKLIST.md`.
- **Detalle:** `LEGAL_MIN_AGE` bloquea el alta si la edad **declarada** no alcanza el mínimo, pero no hay verificación documental ni estimación. Una persona puede escribir la edad que quiera. El sistema tampoco tiene un flujo para el caso de una cuenta detectada como de menor de edad sin autorización, ni pide consentimiento del responsable parental si se baja el mínimo por debajo de 18.
- **Mitigación:** El mínimo por defecto es 18 (CCyC arts. 25 y 26), la opción más conservadora. Cualquier verificación real es desarrollo nuevo y debe decidirse con el abogado antes de publicar.

### ISSUE-005: No hay plazos de conservación ni borrado automático

- **Severidad:** Media (la Ley 25.326 exige no conservar más de lo necesario).
- **Estado:** Abierto.
- **Detalle:** `sessions`, `auth_tokens` y `audit_logs` tienen vencimiento lógico, pero `reports`, `sanctions`, `match_events` y `match_players` no tienen política de purga. Tampoco hay un trabajo programado que borre datos vencidos. El inventario completo está en `docs/LEGAL_CHECKLIST.md` §6.
- **Mitigación:** La tabla de retención está escrita y solo falta definir los plazos con el abogado e implementar el job de purga.

### ISSUE-006: El smoke test y los criterios de rendimiento no se corrieron contra el entorno real

- **Severidad:** Baja (el código está verificado; falta el entorno).
- **Estado:** Abierto — requiere infraestructura.
- **Detalle:** `scripts/smoke-staging.mjs` pasó 23/23 contra API, game-server y SPA **reales levantados localmente**, pero no contra el despliegue (necesita DNS y TLS). Del mismo modo, p95 < 150 ms y las 100 partidas simultáneas están medidos en loopback y en el sandbox, no con red real ni contra Postgres/Redis reales en staging. `docs/STATE.md` § «M8 — criterios de salida del MVP» marca exactamente qué falta.
- **Mitigación:** Una vez desplegado, el smoke test es un comando; los escenarios de carga ya están escritos en `perf.yml` y `infra/`.
