# Registro de Decisiones de Arquitectura (ADR)

Este documento registra las decisiones arquitectónicas y tecnológicas del proyecto **"Mesa de Truco"** siguiendo el formato estándar: **Estado**, **Contexto**, **Decisión**, **Alternativas consideradas** y **Consecuencias**.

---

## ADR-001: Monorepo TypeScript Estricto y Arquitectura de Monolito Modular con Game Server Separado

- **Fecha:** 2026-11-13
- **Estado:** Aceptado
- **Contexto:** La plataforma abarca PWA de jugador (`apps/web`), panel administrativo (`apps/admin`), API HTTP (`apps/api`), servidor de partidas en tiempo real (`apps/game-server`) y librerías compartidas (`truco-engine`, `shared`, `ui`, `config`). Se requiere escalar desde 100 hasta 50.000+ usuarios simultáneos sin reescritura ni sobrecarga operativa prematura de microservicios.
- **Decisión:**
  1. Usar **TypeScript con `strict: true`** (`noUncheckedIndexedAccess`, `noImplicitOverride`) en todo el repositorio.
  2. Estructurar un monorepo con **pnpm workspaces** y **Turborepo** para caché de compilación, linting, chequeo de tipos y tests.
  3. Adoptar el principio de **monolito modular** para `apps/api` (módulos desacoplados por dominio), ejecutando `apps/game-server` como **proceso separado desde el día 1** dentro del mismo repositorio.
- **Alternativas consideradas:**
  - _Microservicios distribuidos desde el inicio_: descartado por complejidad operativa, trazabilidad costosa y latencia entre servicios sin beneficio en MVP.
  - _Un único proceso mezclando API REST y partidas WebSocket_: descartado porque el estado vivo en memoria y el drenaje elegante (graceful drain) de salas activas requieren ciclo de vida y escalado horizontal independientes del tráfico HTTP.
  - _Repositorios múltiples (polyrepo)_: descartado por fricción al sincronizar contratos Zod, tipos y reglas del motor.
- **Consecuencias:**
  - Compartición inmediata y tipada de esquemas, reglas y componentes UI sin publicar paquetes externos.
  - Escalado independiente del `game-server` con afinidad `roomId -> serverId` en Redis sin reescribir el dominio HTTP.

---

## ADR-002: Contratos Compartidos y Validación Universal con Zod (`packages/shared`)

- **Fecha:** 2026-11-13
- **Estado:** Aceptado
- **Contexto:** Todo mensaje externo (requests/responses REST, envelopes WebSocket, variables de entorno y configuraciones de `RuleSet`) es potencialmente malicioso o malformado. Duplicar esquemas entre cliente y servidor introduce deriva de contratos.
- **Decisión:** Centralizar todos los esquemas de validación, DTOs, códigos de error, constantes parametrizables y envelopes de protocolo en `packages/shared` usando **Zod**, reutilizado tanto en runtime como para inferencia estática de tipos TypeScript en cliente y servidor, incluyendo validación fail-fast de variables de entorno al arranque.
- **Alternativas consideradas:**
  - _`class-validator` + decoradores exclusivos de NestJS_: descartado porque acopla esquemas al backend, requiere reflexión en cliente y no valida limpiamente envelopes WebSocket puros.
  - _JSON Schema + generación de código_: descartado por mayor fricción de desarrollo frente a inferencia nativa `z.infer`.
- **Consecuencias:**
  - Única fuente de verdad para contratos REST (`/v1`), protocolo WS y configuración de entorno.
  - Rechazo determinístico y uniforme (`{ error: { code, message, details } }`) ante entradas inválidas.

---

## ADR-003: Stack de Frontend para PWA del Jugador y Panel Administrativo

- **Fecha:** 2026-11-13
- **Estado:** Aceptado
- **Contexto:** La experiencia principal es mobile-first (360 px a 1200 px), instalable como PWA, con animaciones fluidas en dispositivos de gama media (< 200 KB JS crítico comprimido), respeto a `prefers-reduced-motion` y contraste AA bajo la identidad visual "mesa de bar contemporánea". El panel administrativo requiere aislamiento de bundle y superficie de ataque respecto del cliente jugador.
- **Decisión:**
  - Construir `apps/web` y `apps/admin` como aplicaciones separadas sobre **React 18 + Vite + Tailwind CSS**.
  - Gestionar estado remoto HTTP con **TanStack Query** y estado local/tiempo real de mesa con **Zustand**.
  - Implementar microinteracciones con **Framer Motion** respetando `prefers-reduced-motion`.
  - Empaquetar `apps/web` como PWA mediante **`vite-plugin-pwa`** y centralizar tokens/componentes accesibles + SVGs propios en `packages/ui`.
- **Alternativas consideradas:**
  - _SSR pesado (Next.js) para la mesa de juego_: descartado porque la mesa en tiempo real y el panel admin son aplicaciones altamente interactivas autenticadas donde un bundle SPA/PWA ligero con Vite optimiza tiempos de carga y simplicidad de despliegue en CDN.
  - _Incluir rutas `/admin` dentro de `apps/web`_: descartado para no exponer código administrativo en el bundle público ni mezclar políticas de CSP/2FA.
- **Consecuencias:**
  - Separación estricta entre activos públicos de jugador y herramientas internas de moderación/soporte.
  - Reutilización visual consistente mediante `packages/ui`.

---

## ADR-004: Backend HTTP en NestJS sobre Adaptador Fastify

- **Fecha:** 2026-11-13
- **Estado:** Aceptado
- **Contexto:** El API REST (`/v1`) concentra autenticación, usuarios, lobby, moderación, administración, salud/métricas y futuros dominios (social, rankings, torneos, economía virtual), exigiendo estructura modular estricta (`controller`, `service`, `repository`, `dto/schemas`, `tests`), inyección de dependencias para proveedores externos (email, OAuth, captcha) y baja sobrecarga por request.
- **Decisión:** Implementar `apps/api` con **NestJS** utilizando **`@nestjs/platform-fastify`** (Fastify adapter), organizado en módulos por dominio sin mezclar transporte HTTP, lógica de negocio ni consultas de persistencia.
- **Alternativas consideradas:**
  - _NestJS sobre Express_: descartado por menor rendimiento de serialización/throughput frente a Fastify.
  - _Fastify crudo sin framework modular_: descartado para un equipo grande/creciente donde convenciones uniformes de DI, guards RBAC e interceptores de auditoría aceleran mantenimiento y testing.
- **Consecuencias:**
  - Alto rendimiento HTTP con arquitectura limpia, testeable con Supertest/`inject` de Fastify y documentación OpenAPI consistente.

---

## ADR-005: Tiempo Real con Socket.IO, Estado Vivo en Redis 7 y Trabajos Asíncronos con BullMQ

- **Fecha:** 2026-11-13
- **Estado:** Aceptado
- **Contexto:** El truco online requiere latencia p95 < 150 ms, reconexión móvil transparente (cambios Wi-Fi/4G con ventana de gracia de 45 s), orden garantizado por secuencia (`seq`), idempotencia (`eventId`), escritor único por sala (single-writer) y recuperación ante caída de proceso sin perder partidas en curso.
- **Decisión:**
  1. Usar **Socket.IO** sobre WebSockets con handshake autenticado y **envelope propio validado con Zod** (`{ eventId, seq?, ts, type, payload }`).
  2. Mantener cada partida activa en memoria en un único proceso (`single-writer`) de `apps/game-server` y persistir en **Redis 7** el snapshot + log de eventos tras cada acción, además de presencia, directorio `roomId -> serverId`, rate limiting y pub/sub.
  3. Ejecutar tareas fuera del camino crítico (cálculo post-partida, limpieza, rankings futuros, notificaciones) con **BullMQ** sobre Redis.
- **Alternativas consideradas:**
  - _WebSocket nativo (`ws`) sin capa de rooms/reconexión_: descartado porque habría que reimplementar heartbeats, transporte fallback, reconexión con backoff y gestión de rooms.
  - _Persistir cada acción síncronamente en PostgreSQL_: descartado en el camino crítico de turno por latencia e impacto de contención; PostgreSQL recibe la transacción consolidada al cierre de partida (`matches`, `match_players`, `match_events`).
- **Consecuencias:**
  - Reconexión rápida mediante `game.rejoin { lastSeq }` o `game.resync` filtrado siempre por `viewFor`.
  - Tolerancia a fallos de nodo de `game-server` reconstruyendo el estado desde Redis.

---

## ADR-006: Persistencia Relacional con PostgreSQL 16 y Drizzle ORM

- **Fecha:** 2026-11-13
- **Estado:** Aceptado
- **Contexto:** Los datos persistentes (usuarios, sesiones, perfiles, rulesets, mesas, partidas, eventos auditables de partida, reportes, sanciones, `audit_logs` inmutables y futuro libro mayor de monedas virtuales) requieren integridad transaccional ACID, consultas SQL predecibles verificables con `EXPLAIN`, soporte nativo `jsonb`, particionado futuro de `match_events` y migraciones versionadas seguras.
- **Decisión:** Utilizar **PostgreSQL 16** como base de datos relacional primaria junto con **Drizzle ORM** y **`drizzle-kit`** para esquemas tipados en TypeScript y migraciones SQL versionadas, empleando **UUID v7** ordenables temporalmente y columnas `created_at`/`updated_at`.
- **Alternativas consideradas:**
  - _Prisma ORM_: descartado por abstracción de motor binario adicional y menor control directo sobre SQL complejo, particionado y tuning fino de consultas.
  - _TypeORM_: descartado por historial de debilidades de tipado estricto y magia de decoradores/ActiveRecord.
- **Consecuencias:**
  - Consultas SQL transparentes, tipado estricto de extremo a extremo, migraciones auditables en Git e índices explícitos optimizados para cursores y lecturas frecuentes.

---

## ADR-007: Autenticación Segura con Sesiones Web en Cookies HttpOnly, Argon2id y Google OAuth

- **Fecha:** 2026-11-13
- **Estado:** Aceptado
- **Contexto:** La plataforma debe permitir entrada sin fricción como invitado (promovible a cuenta permanente sin perder progreso), registro/login clásico y Google OAuth, protegiendo cuentas frente a robo de tokens XSS, fuerza bruta, reutilización de refresh tokens y accesos administrativos no autorizados.
- **Decisión:**
  1. Emitir sesiones web mediante **cookies `HttpOnly`, `Secure`, `SameSite`** con **refresh token rotativo** almacenado como hash en `sessions` y detección de reutilización (revocación de familia de sesión), más protección CSRF.
  2. Hashear contraseñas exclusivamente con **Argon2id**.
  3. Soportar cuentas de invitado efímeras promovibles (`/v1/auth/promote-guest`) y **OAuth 2.0 con Google** detrás de interfaces explícitas, así como proveedor de email desacoplado (`ConsoleEmailProvider` en desarrollo).
  4. Exigir RBAC estricto y **2FA obligatorio** para roles administrativos en `apps/admin`.
- **Alternativas consideradas:**
  - _JWT stateless en `localStorage`_: descartado por exposición directa ante XSS e imposibilidad de revocación inmediata sin lista negra estatal.
  - _`bcrypt`_: descartado en favor de Argon2id por resistencia superior frente a ataques con GPU/ASIC.
- **Consecuencias:**
  - Control total de sesiones por dispositivo, revocación inmediata ante sospecha de compromiso y transición fluida de jugador invitado a registrado.

---

## ADR-008: Estrategia Integral de Calidad, Testing, Contenedores, CI/CD y Observabilidad

- **Fecha:** 2026-11-13
- **Estado:** Aceptado
- **Contexto:** Un juego multijugador competitivo exige cero regresiones en reglas de truco, ausencia comprobada de fugas de cartas privadas, builds reproducibles y visibilidad completa en producción.
- **Decisión:**
  1. **Calidad estática y flujo Git:** ESLint, Prettier, Husky, `lint-staged` y `commitlint` (Conventional Commits).
  2. **Pirámide de tests:** **Vitest** para unitarios/contratos, **fast-check** para property-based testing del motor (cobertura >= 95%), **Supertest** + **Testcontainers** (PostgreSQL/Redis reales) para integración, **Playwright** para flujos E2E móvil/escritorio y **k6** para pruebas de carga (100 y 1.000 concurrentes).
  3. **Infraestructura y CI:** **Docker multi-stage** para artefactos de producción, **`docker-compose`** para desarrollo local (PostgreSQL 16 + Redis 7) y **GitHub Actions** bloqueando merges ante fallos de lint, tipos, tests o auditoría.
  4. **Observabilidad:** logs estructurados JSON con **pino** y `correlationId`, trazas con **OpenTelemetry**, captura de excepciones con **Sentry** y endpoint `/v1/metrics` compatible con **Prometheus**.
- **Alternativas consideradas:**
  - _Jest_: descartado frente a Vitest por menor velocidad e integración más compleja con ESM/Vite/TypeScript moderno.
  - _Mocks en memoria exclusivamente para tests de base de datos_: descartado para pruebas de integración críticas porque oculta errores reales de constraints, índices y concurrencia de PostgreSQL/Redis.
- **Consecuencias:**
  - Verificación automatizada continua desde reglas puras hasta flujos multijugador completos y métricas operativas listas para SLOs.

---

## ADR-009: Gestión de Ramas en Sesiones del Entorno de Ejecución Actual

- **Fecha:** 2026-11-13
- **Estado:** Aceptado
- **Contexto:** La especificación general sugiere ramas por módulo (`feat/m1-engine`, etc.), mientras que el entorno de ejecución de sesión actual vincula el seguimiento del repositorio a una única rama de trabajo fija (`arena/bfe4d4d2-trucostart`) y prohíbe crear o cambiar a otras ramas durante la sesión.
- **Decisión:** Mantener todos los commits incrementales (con formato estricto **Conventional Commits** e identificadores de módulo claros como `chore(m0): ...`, `feat(m1-engine): ...`) sobre la rama activa de la sesión (`arena/bfe4d4d2-trucostart`). En despliegues fuera de este entorno o por desarrolladores humanos, se mantiene la convención de ramas `feat/mX-*` vía Pull Request hacia `main`.
- **Alternativas consideradas:**
  - _Crear ramas locales secundarias_: descartado porque desvincula el trabajo del sistema de seguimiento del entorno actual.
- **Consecuencias:**
  - Historial Git limpio, atómico y trazable por módulo mediante scopes de Conventional Commits sin romper la integración del entorno.

---

## ADR-010: Diseño Nativo N-Asientos, PRNG Serializable entre Manos e IA sin Trampa en `@truco/engine`

- **Fecha:** 2026-11-13
- **Estado:** Aceptado
- **Contexto:** `packages/truco-engine` debe mantener una firma funcional 100 % pura (`applyAction(state, action)`) sin I/O ni clausuras mutables, soportar partidas multi-mano completas para 2, 4 y 6+ jugadores, impedir toda filtración de cartas privadas o señas rivales hacia clientes y garantizar que la IA heurística jamás pueda hacer trampa.
- **Decisión:**
  1. **Generalidad nativa de $N$ asientos ($2 \le N \le 13$):** toda rotación de turno, reparto antihorario (`(seat + 1) % N`), evaluación de pardas y desempate de Envido/Flor se calcula mediante distancia relativa a la mano `seatHandOrder(seat, manoSeat, N) = (seat - manoSeat + N) % N`.
  2. **Estado PRNG puro y serializable (`sfc32`):** `createGame(ruleset, players, rng)` mezcla la Mano #1 con el `Rng` inyectado y deriva una tupla inmutable `internalPrngState` de 4 enteros `uint32` para barajar determinísticamente la Mano #2+ dentro de `applyAction` manteniendo serialización JSON exacta (Redis/snapshots) y ocultando siempre `internalPrngState` en `viewFor`.
  3. **Frontera estricta de proyección e IA:** `viewFor(state, seat)` y `projectEventsForSeat(events, seats, seat)` constituyen la única salida hacia clientes, verificada con `fast-check`; `chooseBotAction(view: PlayerView)` acepta únicamente `PlayerView` sin importar jamás `GameState`.
- **Alternativas consideradas:**
  - _Almacenar una instancia `Rng` con clausura en `GameState`_: descartado porque rompe inmutabilidad (`applyAction` mutaría el generador compartido) e impide serializar `GameState` en Redis.
  - _Codificar lógica separada para 1v1 y 2v2_: descartado por duplicar reglas y dificultar 3v3 (_pica-pica_ en Etapa 2).
- **Consecuencias:**
  - Determinismo matemático exacto en replays, cobertura del motor `97.93%` líneas / `100%` funciones y simulaciones de miles de partidas completas en pocos segundos sin fugas de información.
