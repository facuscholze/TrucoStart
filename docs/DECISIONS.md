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

---

## ADR-011: Persistencia Dual `GameStore` (`InMemory` + `Redis`) y Salas _Single-Writer_ con Lease

- **Fecha:** 2026-11-13
- **Estado:** Aceptado
- **Contexto:** `apps/game-server` requiere persistencia efímera tras cada acción (snapshot + log secuenciado de eventos), bloqueo de una única sala activa por usuario y recuperación transparente ante caída del proceso. Además, el entorno local/sandbox no dispone de demonio Docker (`ISS-001`), mientras que CI y producción cuentan con Redis 7 real.
- **Decisión:**
  1. Definir el puerto explícito `GameStore` con operaciones atómicas (`claimRoomOwner`, `releaseRoomOwner`, `saveRoomStateAndEvents`, `loadRoomSnapshot`, `loadRoomEventsAfter`, `getUserActiveRoom`, `setUserActiveRoom`, `clearUserActiveRoom`).
  2. Proveer dos adaptadores verificados por la misma suite contractual (`game-store.contract.spec.ts`): `InMemoryGameStore` (desarrollo/tests sin Docker) y `RedisGameStore` con `ioredis` (`SET NX PX` para lease de propietario, scripts Lua para renovación/liberación segura y `MULTI/EXEC` para persistencia atómica de snapshot + eventos con TTL de 24 h), activado automáticamente en tests cuando `REDIS_URL` está definido (p. ej. GitHub Actions CI).
  3. Implementar `RoomActor` con cola de ejecución serie (`enqueue`) garantizando un único escritor por sala (_single-writer_) sin condiciones de carrera entre comandos de socket y temporizadores de turno/abandono.
- **Alternativas consideradas:**
  - _Mocks ad-hoc de `ioredis` en tests_: descartado por ocultar divergencias de semántica atómica y violar la regla de diseño de interfaces explícitas.
  - _Locks distribuidos por cada mensaje individual_: descartado por latencia innecesaria frente a afinidad de sala en memoria respaldada por lease renovable (`claimRoomOwner`) y recuperación perezosa desde `PersistedRoomSnapshot`.
- **Consecuencias:**
  - Cero condiciones de carrera intra-sala, recuperación exacta ante caída abrupta del proceso (`simulateCrash`) cuando vence el lease del nodo caído y paridad contractual verificada entre memoria y Redis 7.

---

## ADR-012: Commit-Reveal Criptográfico, Semilla Cifrada en Reposo y Frontera WebSocket sin Fugas

- **Fecha:** 2026-11-13
- **Estado:** Aceptado
- **Contexto:** Un servidor de Truco competitivo debe demostrar a los jugadores que el mazo no fue manipulado durante la partida (_fair play_), impedir que un volcado de Redis exponga la semilla activa antes del cierre de la partida y garantizar que ningún mensaje WebSocket filtre cartas o señas privadas.
- **Decisión:**
  1. **Commit-Reveal verificable:** al iniciar la partida (`game.started`), el servidor genera 32 bytes CSPRNG (`seedHex` de 256 bits) y publica `seedCommitment = SHA-256("truco-v1:" + seedHex)`. El `Rng` inyectado a `createGame` deriva flotantes uniformes de 53 bits vía `HMAC-SHA256(seedHex, counter_be64)`. Recién al emitir `game.ended` se publica `seedReveal = seedHex`.
  2. **Cifrado autenticado en reposo:** mientras la partida está `IN_GAME`, `PersistedRoomSnapshot` guarda únicamente `encryptedSeed` cifrado con **AES-256-GCM** (IV aleatorio de 96 bits + auth tag de 128 bits derivado de `SEED_ENCRYPTION_KEY`) y mantiene `revealedSeed: null`, permitiendo que otro nodo recupere y revele la semilla tras un crash sin exponerla en texto plano en Redis.
  3. **Proyección obligatoria y audiencia tipada:** cada evento persistido declara su `EventAudience` (`ALL`, `SEAT`, `TEAM`); todas las vistas salen exclusivamente de `viewFor(state, seat)` y las señas se validan con `projectEventsForSeat`, tanto en emisión en vivo como en reenvío incremental (`game.rejoin` con `lastSeq`) y resincronización completa (`game.resync`).
- **Alternativas consideradas:**
  - _Persistir `seedHex` en claro en Redis hasta el final de la partida_: descartado porque cualquier lectura operativa de claves activas comprometería el mazo futuro.
  - _Filtrar campos sensibles manualmente en el controlador Socket.IO_: descartado por propensión a errores; centralizar la proyección en `event-projector.ts` sobre `viewFor` + `projectEventsForSeat` hace imposible emitir el `GameState` crudo.
- **Consecuencias:**
  - Auditoría matemática de baraja reproducible extremo a extremo por cualquier cliente y verificación automatizada sobre el 100 % de los sobres en partidas 1v1 y 2v2 con cero fugas de información.

---

## ADR-013: Motor Dual PostgreSQL 16 (`pg.Pool`) + PGlite (`@electric-sql/pglite`) con Migraciones SQL Idénticas

- **Fecha:** 2026-11-13
- **Estado:** Aceptado
- **Contexto:** `apps/api` requiere persistencia relacional real con `UUIDv7`, `jsonb`, claves foráneas `ON DELETE CASCADE` e índices únicos (`nickname_lower`, `email`, `refresh_hash`) mediante Drizzle ORM. En el entorno sandbox local no existe demonio Docker (`ISSUE-001`), mientras que en CI (GitHub Actions) y producción se dispone de PostgreSQL 16 real.
- **Decisión:**
  1. Generar las migraciones SQL oficiales con `drizzle-kit generate` en `apps/api/drizzle/*.sql`.
  2. Implementar un proveedor adaptativo (`database.provider.ts`) que ejecuta **exactamente las mismas migraciones SQL**:
     - Cuando `DATABASE_URL` está definido (producción y GitHub Actions CI): conecta vía `pg.Pool` contra PostgreSQL 16 real. En suites de pruebas paralelas crea una base de datos efímera aislada (`CREATE DATABASE "truco_test_<id>"`) sobre el esquema real `public` —evitando colisiones con calificadores explícitos `"public"."users"` emitidos por `drizzle-kit generate`— y la elimina (`DROP DATABASE ... WITH (FORCE)`) al cerrar.
     - Cuando `DATABASE_URL` no está definido (desarrollo en sandbox sin Docker): carga dinámicamente `@electric-sql/pglite` (PostgreSQL real compilado a WASM en memoria), evitando que `PGlite` sea siquiera importado en despliegues productivos.
  3. Añadir aserción explícita en Vitest garantizando que cuando `CI=true` jamás se omita `DATABASE_URL`.
- **Consecuencias:**
  - Paridad SQL real entre sandbox local y PostgreSQL 16 en CI sin mocks frágiles ni repositorios falsos ad-hoc.

---

## ADR-014: Cookies Duales `HttpOnly`, Familia de Refresh Rotativos y Separación de Dominio para `ws-ticket`

- **Fecha:** 2026-11-13
- **Estado:** Aceptado
- **Contexto:** La plataforma necesita sesiones web resistentes a XSS/CSRF, detección inmediata de robo de refresh tokens, promoción transparente de cuentas invitadas sin perder historial y autenticación ligera para handshakes Socket.IO en `apps/game-server`.
- **Decisión:**
  1. **Cookies `HttpOnly; Secure; SameSite=Lax`:** `truco_access` (`Path=/`, 15 min) firmada con HMAC-SHA256 bajo prefijo de dominio `access-v1:` y validada contra estado vivo de sesión/usuario en DB (revocación instantánea); `truco_refresh` (`Path=/v1/auth`, 30 días) opaca CSPRNG de 256 bits almacenando únicamente `SHA-256(token)` en `sessions.refresh_hash`.
  2. **Familias de sesión y detección de reúso:** cada login inaugura un `family_id`. Rotar un refresh token marca el eslabón previo con `revoked_reason = 'ROTATED'`. Si un token ya rotado vuelve a presentarse, el servidor revoca de inmediato **todos los miembros activos de ese `family_id`** (`REUSE_DETECTED`) y registra la intrusión en `audit_logs`.
  3. **Separación criptográfica HTTP vs WS y ticket de un solo uso (`jti`):** `POST /v1/auth/ws-ticket` emite un ticket firmado de 60 s con identificador único `jti` compatible con `verifyWsAuthTicket` de `@truco/game-server`. En el primer handshake Socket.IO, `apps/game-server` consume atómicamente `jti` en `GameStore` (`SET NX PX` con TTL restante) rechazando cualquier intento de reutilización. Al usar claves/prefijos distintos al de `truco_access`, una cookie HTTP jamás puede reutilizarse directamente como ticket WebSocket ni viceversa.
  4. **Promoción in-place de invitados:** `POST /v1/auth/promote-guest` actualiza la fila existente en `users` conservando intacto `users.id`, `profiles` (nivel/XP/ajustes) y `match_players`.
- **Consecuencias:**
  - Mitigación robusta frente a robo de tokens, replay de tickets WS y enumeración de cuentas, verificada end-to-end contra `apps/game-server`.

---

## ADR-015: `RateLimitStore` Dual (`InMemory` + `Redis`), Lockout Progresivo por `(Cuenta + IP)` y Escalado a Captcha por Cuenta

- **Fecha:** 2026-11-13
- **Estado:** Aceptado
- **Contexto:**
  1. Un limitador de tasa exclusivamente en memoria local pierde efectividad al escalar `apps/api` a múltiples réplicas detrás de un balanceador.
  2. Aplicar bloqueo progresivo (`423 ACCOUNT_LOCKED`) de forma global sobre el correo electrónico (`users.locked_until`) introduce una vulnerabilidad clásica de **denegación de servicio (DoS) contra cuentas de terceros**: cualquier atacante que conozca el email de un jugador competitivo (o de un moderador/streamer) puede enviar 5 contraseñas erróneas rotando direcciones IP cada pocos minutos y dejar al propietario legítimo permanentemente fuera de su cuenta, incluso cuando ingresa su contraseña real desde su dispositivo habitual.
- **Decisión:**
  1. **Puerto `RateLimitStore` con adaptadores `InMemoryRateLimitStore` y `RedisRateLimitStore`:** siguiendo el mismo patrón contractual que `GameStore`, todas las cuotas de ventana deslizante (`consumeWindow`), bloqueos progresivos (`getLockoutState` / `recordLockoutFailure`) y contadores de fallos (`incrementFailureCounter`) se abstraen detrás de `RateLimitStore`, usando scripts Lua atómicos sobre `ZSET` y `HASH` en Redis 7 y verificándose con una suite de contrato compartida (`rate-limit-store.contract.spec.ts`).
  2. **Lockout progresivo acotado a `(cuenta + IP)`:** el bloqueo escalonado (`60s -> 300s -> 900s -> 3600s` a partir de 5 fallos) actúa únicamente sobre la tupla normalizada `(emailLower + ip)`, frenando fuerza bruta desde un origen concreto sin bloquear jamás otros orígenes legítimos. De igual modo, la cuota HTTP de `POST /v1/auth/login` se aplica por `IP` y por `(cuenta + IP)`, nunca como bloqueo duro global por cuenta.
  3. **Umbral por cuenta con escalado a Captcha (`LOGIN_ACCOUNT_CAPTCHA_THRESHOLD = 3`):** cuando una cuenta acumula `>= 3` intentos fallidos dentro de la ventana activa (`15 min`) desde cualquier conjunto de IPs (p. ej. credential stuffing distribuido), `POST /v1/auth/login` exige resolver un `captchaToken` válido antes de evaluar credenciales (`400 CAPTCHA_FAILED` con `details.captchaRequired = true`), aplicando la misma regla tanto a emails registrados como inexistentes para preservar anti-enumeración.
- **Alternativas consideradas:**
  - _Mantener bloqueo global por cuenta con tiempos más cortos_: descartado porque un script automatizado trivial puede renovar el bloqueo indefinidamente e impedir que un jugador reconecte a un torneo o partida activa.
  - _Confiar únicamente en rate limit por IP sin umbral por cuenta_: descartado porque una botnet con miles de IPs residenciales probaría 1-2 contraseñas por IP sin activar ni el límite por IP ni el lockout `(cuenta + IP)`.
- **Consecuencias:**
  - Ningún tercero puede bloquear la cuenta de otro jugador conociendo su email: el dueño legítimo siempre puede iniciar sesión presentando su contraseña real junto con el desafío Captcha.
  - Consistencia horizontal entre múltiples instancias de `apps/api` respaldada por Redis 7 en producción y CI.

---

## ADR-016: Topología de Despliegue _Same-Site_ (`eTLD+1`) para Cookies `SameSite=Lax` entre `web`, `admin` y `api`

- **Fecha:** 2026-11-13
- **Estado:** Aceptado
- **Contexto:** Las cookies de sesión (`truco_access` y `truco_refresh`) se emiten con `HttpOnly; Secure; SameSite=Lax` para mitigar CSRF en peticiones sub-recurso (`fetch`/`XHR`) originadas desde terceros maliciosos. En los navegadores modernos, la clasificación _same-site_ frente a _cross-site_ se evalúa sobre el **sitio registrable (`scheme + eTLD+1`)** conforme a la Public Suffix List:
  - Si `apps/web` y `apps/api` se desplegaran bajo dominios registrables distintos (por ejemplo `truco-web.vercel.app` y `truco-api.fly.dev`, ambos sufijos públicos independientes), toda petición `fetch('https://.../v1/...', { credentials: 'include' })` sería tratada como **cross-site** y el navegador **omitiría las cookies `SameSite=Lax`** en `POST`/`PATCH`/`DELETE` e incluso en `GET` de sub-recursos tras redirecciones cross-site.
- **Decisión:**
  1. Establecer como **invariante obligatoria de despliegue** en staging y producción que `apps/web`, `apps/admin` y `apps/api` compartan el mismo **sitio registrable (`eTLD+1`)** —p. ej. `app.truco.ar`, `admin.truco.ar` y `api.truco.ar` configurando `COOKIE_DOMAIN=.truco.ar`— o bien enrutar `/v1/*` mediante reverse-proxy/CDN bajo el mismo origen exacto (`https://truco.ar/v1/*`).
  2. Para `apps/game-server` (que puede residir en otro subdominio o incluso en otro borde regional), mantener la autenticación del handshake WebSocket desacoplada de cookies mediante el ticket efímero de un solo uso `POST /v1/auth/ws-ticket` enviado explícitamente en `socket.auth.token`.
- **Alternativas consideradas:**
  - _Relajar las cookies a `SameSite=None; Secure`_: descartado porque expone todas las mutaciones autenticadas a envío automático cross-site y queda sujeto al bloqueo progresivo de cookies de terceros (3PCD / CHIPS) en Safari, Firefox y Chrome.
- **Consecuencias:**
  - Protección CSRF nativa de `SameSite=Lax` intacta sin degradación por políticas de privacidad de navegadores, con requisito explícito de DNS/enrutamiento documentado para infraestructura.

---

## ADR-017: Contrato `apps/api` ↔ `apps/game-server` — Aprovisionamiento Autoritativo de Salas y Persistencia Transaccional Post-Partida vía BullMQ

- **Fecha:** 2026-11-13
- **Estado:** Aceptado
- **Contexto:** `apps/api` y `apps/game-server` corren como procesos separados (ADR-001). Para implementar Lobby, Mesas y Matchmaking (M4) sin acoplamiento a base de datos compartida ni deriva de reglas:
  1. `apps/api` debe ser la única fuente de verdad relacional (`tables`, `table_seats`, `rulesets`, `matches`, `match_players`, `match_events` en PostgreSQL 16).
  2. `apps/game-server` **jamás debe escribir ni conectarse a PostgreSQL**, pero necesita instanciar cada sala en tiempo real con exactamente los mismos parámetros elegidos en la mesa (modo `1v1`/`2v2`, `RuleSet` completo validado, puntaje objetivo `15`/`30`, `flor`, visibilidad `PUBLIC`/`PRIVATE` y `turnTimeoutMs`) sin duplicar lógica de derivación de reglas ni permitir que el cliente sobrescriba esos parámetros en `table.join`.
  3. Al concluir una partida, el resultado, puntajes por jugador y log secuenciado auditable deben persistirse atómicamente en PostgreSQL.
- **Decisión:**
  1. **Aprovisionamiento unidireccional firmado (`apps/api -> apps/game-server`):** al crear una mesa (`POST /v1/tables` o matchmaking), `apps/api` construye y valida el `RuleSet` canónico de `@truco/engine`, persiste `tables` + `table_seats` en PostgreSQL e invoca el puerto `GameRoomProvisioner.provisionRoom(RoomProvisionSpec)`. En transporte HTTP (`POST /internal/rooms` y `DELETE /internal/rooms/:roomId`), el cuerpo viaja firmado con HMAC-SHA256 con separación de dominio (`internal-rpc-v1:<SECRET>`). `game-server` valida `RoomProvisionSpecSchema` + `validateRuleSet`, reclama el lease en `GameStore` e hidrata el `PersistedRoomSnapshot` usando `roomId === tables.id` y el objeto `RuleSet` recibido directamente (en producción `allowAdHocRooms = false`, impidiendo salas huérfanas fuera del lobby).
  2. **Eventos asíncronos de ciclo de vida y cierre (`apps/game-server -> BullMQ -> apps/api`):** `game-server` publica eventos tipados `MatchLifecycleEventSchema` (`match.started`, `table.seatVacated` y `match.completed`) a través del puerto `MatchLifecyclePublisher` (`BullMqMatchLifecyclePublisher` sobre la cola `truco-match-lifecycle` en Redis 7 con `jobId` determinístico por `matchId`, e `InMemoryMatchLifecycleBus` para tests sin Redis).
  3. **Persistencia transaccional idempotente en `apps/api`:** `MatchPersistenceService` consume `match.completed` y ejecuta **una única transacción PostgreSQL (`db.transaction`)** que verifica idempotencia sobre `matches.id`, libera asientos activos e inserta `matches`, `match_players` y `match_events`. Las mesas normales pasan a `tables.status = 'FINISHED'`; las mesas de práctica persisten el resultado para progresión reducida sin cambiar el estado de la mesa privada, de modo que siga disponible para revancha.
  4. **Práctica y bots:** una práctica terminada emite `match.completed` con `practice: true`; el evento puede incluir sólo los participantes humanos (`players` admite mínimo uno). Si una partida queda enteramente automatizada, `game-server` no publica un resultado humano. Práctica/bots nunca califican para rating competitivo; los topes de M9c los aplica la API.
- **Alternativas consideradas:**
  - _Compartir credenciales de PostgreSQL en `apps/game-server`_: descartado porque rompe fronteras de dominio, acopla migraciones entre despliegues y mete latencia SQL en el bucle de eventos de partidas en vivo.
  - _Reconstruir reglas en `game-server` a partir de flags sueltos enviados por clientes WS_: descartado porque duplica lógica de negocio y abre vectores donde un cliente manipula `rulesetCode` o `turnTimeoutMs` al hacer `table.join`.
- **Consecuencias:**
  - Cero duplicación de estado o reglas: `tables.id === roomId` y el `RuleSet` nace una sola vez en `apps/api`.
  - Escritura ACID garantizada de `matches` + `match_players` + `match_events` con tolerancia a reintentos (at-least-once) de BullMQ.

---

## ADR-018: Listado de Lobby con Paginación y Caché de 1 Segundo

- **Fecha:** 2026-11-18
- **Estado:** Aceptado
- **Contexto:** El endpoint `GET /v1/tables` es consultado por cada cliente en el ingreso al lobby, cada reconexión y cada vez que el WS `/lobby` se reconecta. El lobby en vivo se sincroniza por WebSocket pero la carga HTTP inicial puede generar picos cuando miles de usuarios abren la app simultáneamente (hora pico, viralidad, notificación push). Una consulta por request sin caché ejecuta repetidamente el mismo plan sobre PostgreSQL sin beneficio alguno.
- **Decisión:**
  1. Paginación estricta por defecto (25 resultados, máximo 50, rechazando valores mayores) ordenados por `created_at DESC` sobre el índice compuesto `tables(visibility, status, mode, created_at DESC)`.
  2. Caché en proceso de 1 segundo claveada por los filtros de consulta (`visibility=PUBLIC`, `status`, `mode`, `targetScore`, `flor`, `rulesetCode`, `limit`). La TTL baja (1 s) es imperceptible para un jugador que recibe diffs por WebSocket y absorbe ráfagas de refresco (F5, tabs múltiples).
  3. Invalidación estricta: toda mutación que modifica la lista pública (create/join/leave/delete/expire) limpia el caché por completo.
- **Alternativas:** caché en Redis (agrega latencia de red para un TTL tan corto), ETag por cliente (no evita ejecutar la consulta), o incrementar el TTL (riesgo de mostrar mesas ya cerradas durante varios segundos).
- **Consecuencias:** El QPS sobre PostgreSQL por lecturas de lobby en caliente se reduce aproximadamente `TTL * QPS` veces; la lista que ve un usuario por HTTP está como máximo 1s desfasada de la que recibe por WS.

---

## ADR-019: Límites de Conexiones WebSocket por Usuario e IP

- **Fecha:** 2026-11-18
- **Estado:** Aceptado
- **Contexto:** Un solo cliente (por bug, abuso o script) podría abrir miles de conexiones WebSocket contra el `game-server` y agotar sockets o memoria del proceso. A la inversa, un límite muy estricto por IP (p. ej. 5) rompe el uso legítimo desde redes NAT/CGNAT móviles o cibers.
- **Decisión:**
  1. `WS_MAX_CONNECTIONS_PER_USER = 4` por defecto: dos dispositivos + pestaña lobby + margen suficiente para dos partidas simultáneas. El límite se aplica en el middleware `io.use` antes de consumir el ticket WS (rechazo con `TOO_MANY_CONNECTIONS`).
  2. `WS_MAX_CONNECTIONS_PER_IP = 60` por defecto, suficiente para 4-5 hogares o un aula compartiendo un ISP.
  3. Los contadores se decrementan en el evento `disconnect`; se limpian exhaustivamente (no se admiten leaks por sockets huérfanos).
  4. Ambos valores son sobre-escribibles por variables de entorno para ambientes de prueba (`perf:load` los eleva a 1.000/10.000).
- **Alternativas:** sin límite (DoS trivial), límite por IP de 10 (rompe CGNAT), límite global compartido user+ip (no protege de abuso distribuido).
- **Consecuencias:** Un atacante con un solo userId o IP no puede agotar sockets; el jugador normal con varios dispositivos o un aula no percibe el límite.

---

## ADR-020: Resolución de IP del Cliente Sólo Desde Proxies Confiables

- **Fecha:** 2026-11-18
- **Estado:** Aceptado
- **Contexto:** Para aplicar límites por IP, rate limiting y auditoría se necesita la IP real del cliente. Si la app se despliega detrás de Nginx/Cloudflare, la IP del socket es la del proxy y la IP real viene en `X-Forwarded-For` o `CF-Connecting-IP`. Pero cualquier cliente puede falsificar esas cabeceras si el servidor las acepta ciegamente, burlando límites por IP.
- **Decisión:**
  1. `TRUSTED_PROXY_CIDRS` (lista de CIDRs IPv4): la cabecera `TRUSTED_PROXY_HEADER` (default `x-forwarded-for`, configurable a `cf-connecting-ip` para Cloudflare) **sólo** se consulta si la IP remota del socket pertenece a uno de estos rangos; en caso contrario se ignora y se usa la IP del socket directamente.
  2. La misma lógica se aplica en Fastify (`trustProxy` como función) para que `request.ip` y los logs correlacionados siempre muestren la IP correcta y no una IP spoofeada.
  3. El default es **ningún proxy confiable** (desarrollo local); en producción se configura explícitamente los rangos de Cloudflare y/o del balanceador propio. La configuración se valida al arrancar.
  4. Soportamos IPv4 e IPv4-mapped-IPv6; soporte completo de IPv6 nativo se agrega cuando la infra lo requiera.
- **Alternativas:** `trustProxy = true` ciego (spoofing trivial de IP para evadir bans); IP basada únicamente en `CF-Connecting-IP` sin verificar origen (acopla al proveedor y sigue siendo spoofeable si Cloudflare no está delante).
- **Consecuencias:** La IP usada para auditoría, rate limiting y límites de conexiones es correcta tanto en desarrollo (directo) como detrás de proxy; no hay forma de que un cliente fuera de los CIDRs confiables falsifique su origen.

---

## ADR-021: Estrategia de despliegue (Docker multi-stage + docker-compose staging + aprobación manual)

- **Fecha:** 2026-11-18
- **Estado:** Aceptado
- **Contexto:** MVP necesita salir a un VPS económico con un camino repetible de despliegue, sin abonar Kubernetes orquestado todavía. Las migraciones de esquema y el drenaje graceful del game-server son operaciones críticas que deben ser auditable y no ocurrir automáticamente a cada push.
- **Decisión:**
  1. Dockerfiles multi-stage (deps → build → runner) con usuario `truco` (uid 1001) sin privilegios, `dumb-init` como PID 1 para la correcta entrega de SIGTERM y healthchecks con `wget` en `/v1/health` (API), `/health` (game-server liveness) y `/ready` (game-server readiness: 503 mientras `roomManager.isDraining()`).
  2. `infra/docker-compose.staging.yml` con servicios `postgres`, `redis`, `api`, `game-server`, `web`, `admin` y un job efímero `migrate` que corre `pnpm drizzle-kit migrate` (entrypoint `node dist/db/migrate.js`) y sale antes de levantar la API.
  3. Workflow `.github/workflows/deploy-staging.yml` con tres jobs: (a) build + lint/typecheck + `docker compose config -q` + smoke-test local (levanta el stack completo y espera healthchecks); (b) aprobación manual vía GitHub Environments `staging` con reviewers requeridos; (c) deploy vía rsync + SSH que corre migraciones y hace rolling restart de los contenedores, verificando health tras el restart.
  4. TRUSTED_PROXY_CIDRS se setea en la red interna de compose (`172.16.0.0/12`) y se documenta en DEPLOY.md cómo configurarlo con los rangos oficiales de Cloudflare cuando se ponga el CDN delante.
- **Alternativas:** K8s/ECS/Fly.io con releases automáticos a cada push (sobredimensionado para MVP, aumenta superficie de error en migraciones); Heroku/Render (caros para la región de Argentina).
- **Consecuencias:** Un push a main no despliega sin aprobación; si las migraciones fallan se aborta antes de tocar la API nueva; el game-server se reinicia con `stop_grace_period: 45s` durante el cual `/ready` devuelve 503 y el balanceador/Cloudflare le quita tráfico sin cortar partidas en curso.

---

## ADR-022: Perímetro con Caddy, Firewall en `DOCKER-USER` y Reescritura de la IP Real en el Borde

- **Fecha:** 2026-11-19
- **Estado:** Aceptado
- **Contexto:** El diseño de ADR-021 usaba nginx como terminador TLS escuchando en el puerto 8443, y confiaba en `TRUSTED_PROXY_CIDRS` para la IP real. Al revisar el primer despliegue aparecieron tres problemas: (a) `docker` inserta reglas DNAT/ACCEPT en `iptables` que se evalúan antes que las de `ufw`, así que publicar un puerto equivale a exponerlo sin importar lo que diga `ufw`; (b) si el proxy **appendea** a `X-Forwarded-For` que envió el cliente y la API toma la primera IP de la lista, la IP real es falsificable; (c) el terminador en 8443 obligaba a abrir un puerto no estándar que ninguna regla perimetral protegía.
- **Decisión:**
  1. **Caddy** reemplaza a nginx como terminador perimetral, escuchando en **80/443** con certificados ACME automáticos. Es el único servicio del compose de staging con `ports:`; `api`, `game-server`, `web`, `admin`, `postgres` y `redis` no publican puertos y sólo son alcanzables por la red interna `truco-net`. La verificación es automatizada (`scripts/check-caddyfile.mjs` en CI).
  2. **Firewall en dos capas.** La defensa principal es el **security group del proveedor** (sólo 22 desde la IP del operador y 80/443). La segunda capa son reglas en la cadena **`DOCKER-USER`** —la única que Docker respeta y no sobrescribe— que aceptan `tcp 80,443` y `udp 443` **sólo** desde los rangos de Cloudflare y descartan el resto (`infra/firewall/docker-user-cloudflare.rules`, regenerable en vivo con `scripts/cloudflare-ufw.sh`). `ufw` queda como capa documental/administrativa, no como control de los puertos publicados.
  3. **IP real en el borde.** Caddy configura `trusted_proxies static {$TRUSTED_PROXY_CIDRS}` (rangos de Cloudflare), `trusted_proxies_strict` y `client_ip_headers CF-Connecting-IP`: sólo acepta `CF-Connecting-IP` cuando el par TCP es un edge de Cloudflare. Además **reescribe** `X-Forwarded-For` con `{client_ip}` (`header_up X-Forwarded-For {client_ip}`) en los cuatro upstreams, en vez de appendear. La API y el game-server siguen confiando en `x-forwarded-for` sólo desde la red interna (`172.16.0.0/12`), con `TRUSTED_PROXY_HEADER=x-forwarded-for`.
  4. **Parseo uniforme de derecha a izquierda.** `resolveClientIp` de `@truco/shared` recorre `X-Forwarded-For` de derecha a izquierda y se detiene en el primer salto que no es un proxy confiable, igual que Fastify y que Caddy con `trusted_proxies_strict`. Antes tomaba la primera IP válida, lo que hacía que game-server y API interpretaran la misma cabecera de forma distinta.
  5. **Evidencia ejecutable.** `/v1/health` publica `clientIp` (la IP resuelta por el servidor, nunca el valor crudo del cliente). `scripts/test-client-ip-spoofing.mjs` envía cabeceras falsificadas contra el compose en CI y falla si la IP cambia; se verificó su capacidad de fallar con un servidor mal configurado (`0.0.0.0/0`), donde efectivamente devuelve exit 1.
- **Alternativas:** `ufw` como único control (no filtra puertos publicados por Docker); `trust_proxy=true` ciego (spoofing trivial); confiar sólo en `CF-Connecting-IP` sin validar el par (acopla al proveedor y es spoofeable si Cloudflare no está delante); nginx en 8443 (`ADR-021`, reemplazado).
- **Consecuencias:** El servidor no expone ningún puerto de aplicación; un atacante que llegue por la IP directa es descartado en `DOCKER-USER` y, si aun así llegara, la API usaría la IP del socket. Cuesta dos capas de configuración mantener (security group + DOCKER-USER) y los rangos de Cloudflare deben refrescarse cuando el proveedor los cambie (`scripts/cloudflare-ufw.sh apply`). Caddy ocupa 80, lo que impide correr otro terminador TLS en el mismo host.

---

## ADR-023: Consentimiento Legal Explícito, Edad Mínima Configurable y Regla 13 Ejecutable

- **Fecha:** 2026-11-19
- **Estado:** Aceptado
- **Contexto:** El producto recolecta datos personales (correo, apodo, IP, user agent, historial de partidas) y no tenía ningún mecanismo de consentimiento: el alta creaba la cuenta sin registrar qué aceptaba la persona ni cuándo. Para la Ley 25.326 el consentimiento debe ser expreso, y sin constancia no hay forma de acreditarlo. Además, la regla 13 («producto sin dinero real») se cumplía por disciplina del equipo: no había ningún control automático que impidiera que un PR futuro introdujera una pasarela de pago o un saldo.
- **Decisión:**
  1. **Aceptación obligatoria y literal.** `RegisterRequestSchema` y `PromoteGuestRequestSchema` exigen un objeto `legal` con `accepted: z.literal(true)`. No es un booleano opcional que el backend pudiera interpretar como aceptado por omisión: si falta, la API responde 400 y **no crea el usuario**. La validación ocurre **antes** de tocar la base.
  2. **Constancia persistida.** Se agregan `terms_version`, `privacy_version`, `legal_accepted_at` y `legal_min_age` a `users` (migración `0006`), más un evento `AUTH_REGISTERED` / `AUTH_GUEST_PROMOTED` en `audit_logs` con las versiones aceptadas. Se guarda la edad mínima vigente en ese momento porque el valor es configurable y cambia con el tiempo.
  3. **La edad declarada no se almacena.** `legal.age` se usa sólo para el control de edad mínima y se descarta. Guardar la edad sin necesidad violaría el principio de finalidad y minimización.
  4. **Edad mínima configurable con default conservador.** `LEGAL_MIN_AGE` (rango 13–21). Sin configurar, rige **18** por la regla 11 de `CLAUDE.md`: en Argentina la plena capacidad para contratar se adquiere a los 18 (CCyC arts. 25 y 26), así que es la opción más restrictiva disponible. Bajarla es una decisión legal del titular, no técnica.
  5. **Documentos como borrador estructural.** Los cuatro textos viven en `apps/web/src/features/legal/legal-content.ts`. El aviso «BORRADOR, PENDIENTE DE REVISIÓN LEGAL» no es una prop con default: `DraftBanner` lo renderiza siempre en el índice, en cada documento y en el pie, y un test verifica que esté presente en los cuatro. El copy no afirma nada como definitivo y marca explícitamente lo que falta decidir.
  6. **Regla 13 ejecutable.** `scripts/check-no-real-money.mjs` corre en CI y busca **mecanismos**, no palabras: pasarelas de pago, columnas de saldo/billetera/libro contable, endpoints de depósito/retiro y copy que prometa dinero. Excluye explícitamente el vocabulario del truco («Real Envido», «gana la baza») y los archivos que nombran dinero para negarlo o para detectar claves filtradas. Se verificó que falla ante las cuatro clases de violación.
- **Alternativas:** Aceptación implícita por el mero uso (no acreditable, y la ley exige consentimiento expreso); guardar sólo un booleano `accepted_terms` (no permite saber qué texto se aceptó); edad mínima fija en código (obliga a un deploy para cambiarla y no permite decidir por jurisdicción); revisar la regla 13 a mano en cada PR (no protege contra el próximo contribuyente).
- **Consecuencias:** El alta pasa a tener un paso más y una migración; cualquier cliente nuevo **debe** enviar `legal` o recibe 400. Cambiar el texto de un documento obliga a bumpear su versión en `LEGAL_DOCUMENT_VERSIONS`, y un cliente con la versión vieja recibe 409 en vez de aceptar términos obsoletos. Los textos **no** pueden publicarse como definitivos hasta que se cierre `docs/LEGAL_CHECKLIST.md`: el código impide crear cuentas sin consentimiento, pero no garantiza que el contenido del consentimiento sea jurídicamente correcto.

---

## ADR-024: Grafo social M9a y políticas independientes de privacidad

- **Fecha:** 2026-11-19
- **Estado:** Aceptado
- **Contexto:** La etapa social necesita amistades, bloqueos, invitaciones, notificaciones, presencia y consulta de historial/estadísticas sin mezclar sus controles de exposición. El canal de tiempo real del lobby también transporta presencia y no debe filtrar snapshots públicos a una conexión social. Un bloqueo tiene que prevalecer aunque el perfil elija visibilidad `ALL`.
- **Decisión:**
  1. Persistir amistades, bloqueos, invitaciones y notificaciones en PostgreSQL; canonicalizar los pares de amistad y usar constraints únicos/transactions para solicitudes cruzadas e idempotencia. Las notificaciones HTTP persistidas son la fuente de verdad; Socket.IO sólo señala cambios por la sala privada `user:<userId>`.
  2. Mantener `historyVisibility`, `statsVisibility` y `presenceVisibility` separadas en los ajustes de perfil (`ALL`, `FRIENDS`, `NOBODY`), con default técnico `FRIENDS`. Un PATCH modifica únicamente los campos enviados; los defaults de la respuesta no deben reescribir ajustes omitidos.
  3. Denegar historial, estadísticas y presencia en cualquiera de las dos direcciones cuando existe un bloqueo, aun si el valor configurado es `ALL`. Al cambiar elegibilidad se puede emitir `OFFLINE` con `visible: false` para borrar una caché anterior; nunca se publica estado `ONLINE`/`IN_GAME` al bloqueado.
  4. Mantener presencia en un store efímero (lease de 45 s, heartbeat cada 15 s), derivar el estado de conexión/juego en servidor y mantener el socket social autenticado y aislado de los snapshots/eventos de mesas del lobby.
  5. El historial y las estadísticas son lecturas derivadas de partidas persistidas, pero su autorización es independiente. No se agregan rankings, Glicko-2, XP, logros, misiones ni otra gamificación en M9a.
- **Alternativas consideradas:** Un único `historyVisibility` para estadísticas e historial (acopla decisiones distintas); estado de presencia persistido como actividad histórica (retiene más datos personales de los necesarios); publicar notificaciones en un room global del lobby (expone relaciones y actividad social); permitir que `ALL` supere un bloqueo (contradice el límite de seguridad entre cuentas).
- **Consecuencias:** Se incorpora una migración social y cambios de contratos/API/web; la privacidad requiere validar tanto acceso REST como audiencia WebSocket. Los defaults y controles técnicos no resuelven finalidad, base legal ni retención: esos puntos siguen sujetos a revisión legal en `docs/LEGAL_CHECKLIST.md`.

---

## ADR-025: Rating competitivo Glicko-2, temporadas y revisión humana M9b

- **Fecha:** 2026-11-19
- **Estado:** Aceptado
- **Contexto:** M9a habilitó relaciones, privacidad e historial; el siguiente hito necesita rankings competitivos por modalidad sin convertir partidas de práctica ni partidas con bots en puntuación, además de revisar anomalías sin castigos algorítmicos.
- **Decisión:**
  1. Mantener ratings Glicko-2 independientes para `1v1` y `2v2`, dentro de temporadas persistidas. Los defaults de Glicko-2 son rating 1500, desviación 350, volatilidad 0.06 y `tau=0.5`. En 2v2, cada jugador recibe el mismo resultado de equipo en dos comparaciones separadas, una contra cada rival; ambas aportan como observaciones Glicko-2 independientes y no se divide ni se copia un delta de equipo entre compañeros.
  2. Sólo la cola competitiva humana marca la mesa; la temporada se captura al iniciar la partida y se copia a la fila durable de `matches`. El trabajo post-partida se ejecuta después del commit durable y persiste rating, variación por jugador, agregados y clave idempotente dentro de una transacción.
  3. PostgreSQL es la fuente de verdad. Redis guarda proyecciones reconstruibles de ranking; el outbox durable permite reintentar si Redis no está disponible sin perder la actualización.
  4. Publicar rankings globales, semanales y mensuales por modo, sólo para perfiles `statsVisibility=ALL` que satisfacen mínimos de partidas y rivales distintos. Las lecturas de perfil propio/público aplican el mismo control de estadísticas y bloqueos que M9a.
  5. Señales de rivales repetidos, partidas demasiado cortas, abandonos coordinados y posible alimentación de cuentas nuevas sólo documentan evidencia en una cola administrativa. Tomar y resolver casos requiere `competitive:review`, versión optimista y `audit_logs`; las señales no afectan rating, acceso a la cola ni sanciones automáticamente. Una sanción es un flujo humano separado.
  6. El cierre y la rotación siguen las garantías transaccionales de ADR-026: no se cierra con mesas activas ni ratings pendientes; los puestos elegibles se congelan y el rating se reinicia suavemente.
- **Alternativas consideradas:** Elo simple (no modela incertidumbre ni inactividad); puntuar prácticas/bots (inflaría/desvirtuaría clasificaciones); bloquear ratings o sancionar por heurística (alto riesgo de falsos positivos); Redis como fuente de verdad (pérdida ante fallos y acoplamiento entre cálculo y caché).
- **Consecuencias:** M9b agrega migraciones de ratings y temporada, separación explícita de colas, endpoints de ranking/perfil y una vista de revisión. Para ver el ranking público se exige visibilidad estadística pública; las decisiones disciplinarias no se automatizan.

---

## ADR-026: Cierre transaccional e idempotente de temporadas competitivas

- **Fecha:** 2026-11-19
- **Estado:** Aceptado
- **Contexto:** Una temporada no debe rotar mientras una partida competitiva todavía usa su identificador o mientras un resultado durable aún no actualizó ratings. A la vez, fallos parciales no deben dejar cero o dos temporadas activas, snapshots incompletos ni perfiles reiniciados a medias.
- **Decisión:**
  1. Cada mesa competitiva captura `competitive_season_id` al iniciar. El cierre se difiere mientras exista una mesa `IN_GAME` asociada a esa temporada o una partida competitiva persistida sin su fila `rating_jobs`.
  2. En una sola transacción PostgreSQL, bloquear la temporada activa, congelar perfiles que cumplen los mínimos, marcar la temporada anterior `CLOSED`, crear exactamente una temporada siguiente, copiar perfiles con reinicio suave y registrar `rating_season_audits` y `audit_logs`.
  3. El ranking congelado conserva por modo la posición, rating, desviación, partidas, rivales, victorias y división de cada perfil elegible. El nuevo perfil reinicia contadores; conserva `1500 + (rating_anterior - 1500) × 0,75`, aumenta la desviación según `sqrt(old² + 70²)` con tope 350, y conserva la volatilidad.
  4. Una restricción única permite una sola temporada activa. `rating_season_audits.season_id` fija el resultado del cierre: la repetición devuelve el mismo `nextSeasonId` sin duplicar snapshots, perfiles ni auditorías. Cualquier error antes del commit revierte toda la rotación y permite reintentar.
  5. El mantenedor de ratings comprueba temporadas vencidas cada 30 segundos; una temporada diferida vuelve a evaluarse después, sin forzar el cierre de partidas en curso.
- **Alternativas consideradas:** rotar aunque haya partidas vivas (asigna resultados a una temporada distinta o perdida); cerrar con varios commits (deja estados intermedios); reset completo (descarta continuidad y aumenta incertidumbre más de lo necesario).
- **Consecuencias:** las temporadas mantienen su historial congelado y el rating activo tiene reinicios previsibles. La prueba de fallo intermedio inyecta una restricción SQL, verifica rollback integral y reintento; la ejecución contra PostgreSQL real debe comprobarse también en CI.

---

## ADR-027: Progresión M9c y moneda virtual estrictamente simbólica

- **Fecha:** 2026-11-19
- **Estado:** Aceptado
- **Contexto:** Después de M9b, XP, logros, misiones y economía virtual seguían pendientes. El producto necesita recompensas de progreso sin apuestas, monetización, transferencias ni ventaja competitiva. La regla 13 de ADR-023 prohibía dinero real, no una unidad virtual no económica; M9c precisa esa frontera.
- **Decisión:**
  1. Persistir XP, logros, misiones, notificaciones y economía en PostgreSQL. La API deriva progreso de partidas/eventos completados y lecciones tutoriales validadas; el cliente no puede enviar importes ni contadores de progreso. Recibos idempotentes, topes diarios por clase de origen y transacciones serializan reintentos y reclamaciones.
  2. Permitir sólo la unidad `VIRTUAL_COIN`, con `has_economic_value=false`, transferencias deshabilitadas y compras monetarias deshabilitadas. La moneda se gana por actividad, no se compra y sólo se canjea por cosméticos; no tiene conversión, depósitos ni retiros. Constraints SQL y tests protegen estas invariantes.
  3. Derivar el saldo de `wallet_transactions`; los asientos son inmutables, se rechazan saldos negativos y una corrección admin agrega una compensación vinculada al crédito original. Configurar recompensas o revertir créditos requiere `gamification:configure`, motivo, actor/sesión/IP y `audit_logs` en la misma transacción.
  4. Cosméticos tienen precio positivo y `affects_rules=false`/`affects_matchmaking=false`. Práctica y partidas con bots pueden conceder progreso reducido con topes separados, pero no afectan rating ni estadísticas públicas; no se introduce evento WS público de progresión.
  5. Actualizar OpenAPI, avisos/datos de privacidad en borrador y checklist legal; estas afirmaciones técnicas no son una determinación jurídica y siguen sujetas a revisión profesional.
- **Alternativas consideradas:** no incorporar moneda (descartado porque la economía simbólica es alcance M9c); mantener un contador de saldo mutable (rechazado por falta de trazabilidad); permitir transferencias, compras con dinero o premios de valor (prohibido); dejar que progreso enviado por cliente determine recompensas (rechazado por abuso y duplicación).
- **Consecuencias:** el control de dinero real admite esta excepción virtual estrecha, respaldada por flags/constraints, tests y revisión del escáner `scripts/check-no-real-money.mjs`. El saldo y el historial de progreso son datos vinculados a cuenta cuya finalidad y retención siguen pendientes ante el asesor legal (`docs/LEGAL_CHECKLIST.md`).

---

## ADR-028: Pulido UX de la tanda M0–M9c — jerarquía de acción, señales de navegación y medición reproducible

- **Fecha:** 2026-11-26
- **Estado:** Aceptado
- **Contexto:** `docs/UX_AUDIT_M0-M9C.md` priorizó nueve oportunidades de experiencia sobre la base M0–M9c. Cinco se aprobaron para implementar sin más consulta (1, 2, 3, 6, 7 y 9), dos quedaron explícitamente diferidas para medirlas con jugadores reales (5 y 8, registradas en `docs/BACKLOG.md`), la 4 ya venía resuelta en la tanda anterior. El riesgo de una tanda de pulido es "arreglar" sin evidencia: cambiar layout y declarar mejora sin medir.
- **Decisión:**
  1. **Acción primaria móvil (1):** en Inicio, "Jugar ahora" (partida rápida contra una persona) es el CTA principal; practicar contra la máquina es secundario y se ofrece automáticamente cuando la espera por un rival supera un umbral configurable (30 s por defecto, `ux-config.ts`). La práctica nunca se presenta como partida entre personas: los bots se identifican en la mesa.
  2. **Navegación inferior (2):** la barra móvil conserva todos los destinos desplazables y agrega una señal de continuidad (degradado + chevron) más una descripción para lectores de pantalla; la señal se retira al llegar al final. La sección activa se revela una vez y el bootstrap de sesión no vuelve a mover la barra si la persona ya la desplazó.
  3. **Encabezado de escritorio (3):** navegación y controles comparten una sola fila de 61 px a 1024–1440 px en lugar de dos filas de 117 px, sin scroll horizontal ni destinos ocultos.
  4. **Notificaciones (6) y ranking móvil (7):** la acción de notificación va en su propia fila con nombre accesible completo, y los metadatos del ranking suben de 11 px a 12/14 px conservando los tres datos. Legibilidad sin recortar información.
  5. **Administración (9):** cabecera de caso fija con estado y próxima acción orientativa, y asas cortas legibles (`P-019A7E40`) junto al UUID íntegro. Las asas son de lectura: la evidencia, la auditoría y las acciones sensibles siguen usando el identificador completo, con confirmación y registro.
  6. **Medición reproducible:** `apps/web/scripts/measure-ux-signals.mjs` (`pnpm --filter @truco/web measure:ux`) mide barra inferior, encabezado y CLS contra una línea base registrada, tomando medianas de tres cargas y esperando a que la barra se estabilice. Una mejora de UX de esta tanda no se declara sin ese gate en verde.
- **Alternativas consideradas:** dar por buenas las capturas antes/después sin medir CLS (descartado: la tanda anterior tenía una regresión real de 0.0554 a 0.09 que las capturas no mostraban); resolver el CLS con `scrollbar-gutter: stable` (descartado: no movía la aguja; la causa era el fallback del chunk diferido, ahora con altura reservada); acortar el texto de la acción de notificación para que entrara (rechazado: se perdía el nombre accesible, se mantuvo el texto largo como nombre y una etiqueta visible corta); reordenar Perfil/Social/Progreso e Inicio sin datos (rechazado por indicación explícita: primero medir con jugadores reales).
- **Consecuencias:** la tanda queda verificada por medición propia (CLS por ruta y ancho, filas de encabezado, pista de la barra) además de axe WCAG 2.2 A/AA sin hallazgos y las auditorías responsive/perf existentes. La línea base de CLS es sintética (Chromium headless en CI local); no sustituye RUM ni datos de dispositivos reales, y por eso las mejoras 5 y 8 siguen en el backlog con ese criterio de apertura.

---

## ADR-029: Torneos de eliminación simple y doble sin _bracket reset_

- **Fecha:** 2026-11-26
- **Estado:** Aceptado
- **Contexto:** M10a pide torneos de eliminación simple y doble, en 1v1 y 2v2, con cupos configurables que no siempre son potencia de 2. La eliminación doble admite dos convenciones para la final: (a) la final se juega a partido único entre el campeón de la llave de ganadores y el de la de perdedores, o (b) si gana el de perdedores se juega una segunda final (_bracket reset_), porque ambos tendrían una derrota. La opción (b) es la más justa para el campeón invicto de ganadores, pero agrega un cruce condicional: un partido que existe o no según el resultado del anterior.
- **Decisión:**
  1. La final se juega **a partido único**, sin _bracket reset_. Quien llega desde la llave de perdedores ya perdió una vez y no tiene revancha en la final; el segundo tropiezo lo deja afuera, igual que a cualquier otro. Se documenta la regla en la pantalla del torneo y en `docs/RULES.md`.
  2. La topología se calcula como una función pura y determinista en `packages/shared/src/tournaments/topology.ts`, con el mismo módulo para el servidor, las pruebas y la explicación del cuadro en la web. Nada de estados "que dependen de un resultado" para decidir si un partido existe.
  3. Los pases libres (BYE) se reparten a las mejores siembras y se propagan en cadena: un cruce con un lado estructuralmente vacío no se juega y el rival avanza sin jugar. Un lado **pendiente** —porque la ronda anterior todavía no se jugó— no es un pase libre y no le da el triunfo a nadie; confundir ambos casos regalaba una ronda de ventaja, y fue el error que encontró la prueba de 7 jugadores.
  4. El avance es automático al terminar la partida e idempotente por `matchId`: reprocesar el mismo resultado no duplica el avance, y un evento con otro `matchId` sobre un cruce ya cerrado tampoco.
- **Alternativas consideradas:** implementar _bracket reset_ (descartado para esta tanda: agrega un cruce condicional, complica el contrato del cuadro que consume la web y necesita su propio criterio de desempate; queda como decisión abierta si el formato se vuelve competitivo); dejar que el segundo de la llave de perdedores herede el título si el de ganadores no se presenta (rechazado: el título se define jugando, y una incomparecencia multiplicada por dos convenciones distintas es terreno de disputa); calcular la topología en el cliente (rechazado: el servidor debe ser autoridad sobre quién juega con quién).
- **Consecuencias:** el cuadro es una estructura estática, lo que hace barato explicarlo en la interfaz y verificarlo con propiedades sobre 2..64 participantes. La final de la doble eliminación no es exactamente equivalente a la convención más difundida en esports, y eso se informa en la pantalla. Si más adelante se decide que los torneos sean competitivos, la regla debe revisarse junto con ADR-030.

---

## ADR-030: Los torneos no alteran el rating competitivo

- **Fecha:** 2026-11-26
- **Estado:** Aceptado
- **Contexto:** Los torneos usan el Glicko-2 del jugador **para sembrar** el cuadro, y sus partidas se juegan en salas aprovisionadas por el mismo flujo que una partida competitiva. Eso abre la pregunta de si un cruce de torneo debe también actualizar el rating. Hay dos presiones en contra: (a) el rating competitivo se calcula sobre partidas parejas que el matchmaking eligió por habilidad, mientras un torneo arma cruces por siembra, y una diferencia grande de rating en un cruce temprano produce deltas poco informativos; (b) la revisión humana de integridad (M9b) hoy cubre la cola competitiva y no tiene un flujo equivalente para torneos, de modo que un resultado manipulado en un torneo contaminaría una clasificación que sí es pública y sí se usa para emparejar.
- **Decisión:**
  1. Las partidas de torneo se persisten con `is_competitive = false`. Pasan por el mismo ciclo durable `match.completed` (para guardar la partida, los eventos y el resultado), pero **no** disparan `RatingsService.processMatch` ni escriben en `rating_profiles`, `rating_redis_outbox` o los rankings.
  2. La siembra lee el rating vigente como dato de entrada. Leer el rating no lo modifica: el sembrado de un torneo no altera su posición en el ranking.
  3. Un cruce de torneo nunca cuenta como partida con bots ni se completa con bots. Si un jugador no se presenta, el cruce se cierra por incomparecencia con motivo, no simulado.
  4. Esta decisión queda registrada en el contrato, el servicio y este ADR antes de abrir torneos oficiales, para que no se decida implícitamente por código.
- **Alternativas consideradas:** contabilizar los torneos en el ranking (descartado en esta tanda por las razones de arriba; requeriría, como mínimo, un criterio de revisión humana equivalente a la cola competitiva y decidir si un torneo es un entorno donde el rating significa lo mismo); ponderar el delta por tamaño del torneo (rechazado: agrega complejidad de calibración sin resolver el problema de integridad); sacar el rating de la siembra y sembrar al azar (rechazado: los cuadros de un torneo se disfrutan más cuando los mejores no se cruzan en la primera ronda).
- **Consecuencias:** un jugador puede ganar un torneo de 64 sin moverse un punto en el ranking, y la interfaz debe decirlo sin ambigüedad para que nadie se sienta defraudado. El torneo conserva valor simbólico propio (posición, premio cosmético y monedas virtuales sin valor económico). Revisar esta decisión es un cambio de contrato: incluye actualizar `docs/API.md`, `docs/EVENTS.md`, la pantalla del torneo y las pruebas de `is_competitive`.

---

## ADR-031: El cierre del cruce viaja por un puente, no por un ciclo de módulos

- **Fecha:** 2026-11-26
- **Estado:** Aceptado
- **Contexto:** El lobby sabe cuándo termina una partida (consume `match.completed`); los torneos saben qué hacer con ese resultado (cerrar el cruce y avanzar la llave). La primera versión inyectó `TournamentsService` dentro de `MatchPersistenceService` con `forwardRef` en ambos módulos, porque torneos ya importa el lobby para aprovisionar la sala de cada cruce. No funcionó: `TournamentsModule` es **dinámico** (`register()`), así que `forwardRef(() => TournamentsModule)` apunta a los metadatos estáticos vacíos y `TournamentsService` no existe en ese contexto. Nest fallaba al arrancar la API, y sólo se veía al levantar la aplicación completa: los tests de servicio construían las clases a mano y pasaban.
- **Decisión:**
  1. El lobby define la interfaz `MatchCompletionBridge` (`apps/api/src/modules/lobby/ports/match-completion-bridge.ts`) y la exporta como provider de su módulo.
  2. El módulo de torneos la inyecta y, al arrancar (`onApplicationBootstrap`), se anota con su manejador. El lobby sólo conoce la interfaz: no importa torneos y no hay ciclo.
  3. `MatchPersistenceService` avisa por el puente después de persistir el resultado; el cierre del cruce es idempotente por `matchId` y un fallo no pierde el resultado de la partida (se registra y el barrido o el panel lo resuelven).
  4. Regla general: **entre módulos dinámicos no se usa `forwardRef`**. Si hace falta una vuelta atrás, va por una interfaz en el módulo del que se depende.
- **Alternativas consideradas:** hacer estático `TournamentsModule` (rechazado: pierde la configuración por opciones que usa el resto del proyecto); mover el cierre del cruce al torneo consumiendo él mismo los eventos de partida (rechazado: duplicaría el consumidor de BullMQ y la persistencia de la partida); emitir un evento del dominio por `EventEmitter` (rechazado para esta tanda: agrega una pieza nueva sin ganar nada sobre una interfaz tipada y explícita); llamar por HTTP interno al endpoint de staff (rechazado: mete red y autorización en un camino que ya está dentro del proceso).
- **Consecuencias:** el grafo de dependencias queda en una dirección (torneos → lobby) y el arranque de la API es el que valida el cableado. Cualquier módulo futuro que necesite "avisar hacia arriba" debe repetir el patrón del puente. El costo es que el puente acepta un solo manejador; si aparece un segundo interesado, se convierte en una lista.
