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

### ISSUE-002: Cumplimiento normativo Ley 25.326 (Protección de Datos Personales — Argentina)

- **Severidad:** Media (bloqueante antes de producción pública, no bloqueante en desarrollo MVP).
- **Estado:** Abierto (`STATE-09`).
- **Detalle:** La recopilación mínima de datos (email, IP en `audit_logs`, historial de sanciones y exportación/supresión de cuenta) requiere validación jurídica formal de textos legales, plazos de retención e inscripción/cumplimiento ante la AAIP.

### ISSUE-003: Presupuesto de bundle crítico (< 200 KB comprimido en `apps/web`)

- **Severidad:** Baja (riesgo preventivo para M5).
- **Estado:** En seguimiento.
- **Detalle:** Framer Motion, Socket.IO client y librerías de UI pueden superar los 200 KB gzip si no se aplica code-splitting por ruta (`LazyMotion`, carga diferida de pantallas secundarias como tutorial/replay). Se verificará en el build de M5 y M8.
